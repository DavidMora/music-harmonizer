'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { AudioUploader } from '@/components/AudioUploader';
import { ProcessingStatus } from '@/components/ProcessingStatus';
import { ScoreDisplay } from '@/components/ScoreDisplay';
import { ScoreToolbar } from '@/components/ScoreToolbar';
import { PlaybackControls } from '@/components/PlaybackControls';
import { useAudioAnalysis } from '@/hooks/useAudioAnalysis';
import { usePlayback } from '@/hooks/usePlayback';
import { useAudioContext } from '@/context/AudioContextProvider';
import { quantizeNotes, groupIntoMeasures } from '@/lib/notation/quantizer';
import { loadInstrument } from '@/lib/playback/soundfontPlayer';
import { downloadMidi, downloadMidiWithHarmony } from '@/lib/midi/midiExporter';
import { parseMidiFile } from '@/lib/midi/midiImporter';
import { generateHarmony, combineVoicesForPlayback, HARMONY_STYLES } from '@/lib/harmony/harmonizer';
import type { HarmonyStyle, HarmonyVoice } from '@/lib/harmony/harmonizer';
import { HarmonyPanel } from '@/components/HarmonyPanel';
import { ChordTrack } from '@/components/ChordTrack';
import type { NoteEvent, QuantizedNote, NoteDuration, ChordEvent } from '@/types/music';
import { midiToNoteName } from '@/types/music';
import { suggestChords, chordToNoteEvents } from '@/lib/harmony/chords';
import type Soundfont from 'soundfont-player';

const QUANTIZATION_OPTIONS: { value: NoteDuration; label: string }[] = [
  { value: 'whole', label: 'Whole' },
  { value: 'half', label: 'Half' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'eighth', label: 'Eighth' },
  { value: 'sixteenth', label: 'Sixteenth' },
];

const KEY_SIGNATURES = [
  { value: 'C', label: 'C Major / A minor' },
  { value: 'G', label: 'G Major / E minor' },
  { value: 'D', label: 'D Major / B minor' },
  { value: 'A', label: 'A Major / F# minor' },
  { value: 'E', label: 'E Major / C# minor' },
  { value: 'B', label: 'B Major / G# minor' },
  { value: 'F#', label: 'F# Major / D# minor' },
  { value: 'F', label: 'F Major / D minor' },
  { value: 'Bb', label: 'Bb Major / G minor' },
  { value: 'Eb', label: 'Eb Major / C minor' },
  { value: 'Ab', label: 'Ab Major / F minor' },
  { value: 'Db', label: 'Db Major / Bb minor' },
];

// Duration values in beats
const DURATION_BEATS: Record<NoteDuration, number> = {
  'whole-dotted': 6,
  'whole': 4,
  'half-dotted': 3,
  'half': 2,
  'quarter-dotted': 1.5,
  'quarter': 1,
  'eighth-dotted': 0.75,
  'eighth': 0.5,
  'sixteenth': 0.25,
};

// Major scale intervals (semitones from root): 0, 2, 4, 5, 7, 9, 11
const MAJOR_SCALE_INTERVALS = [0, 2, 4, 5, 7, 9, 11];

// Root note MIDI offsets (C=0, C#=1, D=2, etc.)
const KEY_ROOTS: Record<string, number> = {
  'C': 0, 'G': 7, 'D': 2, 'A': 9, 'E': 4, 'B': 11, 'F#': 6,
  'F': 5, 'Bb': 10, 'Eb': 3, 'Ab': 8, 'Db': 1,
};

function getScaleNotes(key: string): Set<number> {
  const root = KEY_ROOTS[key] ?? 0;
  const scaleNotes = new Set<number>();
  for (const interval of MAJOR_SCALE_INTERVALS) {
    scaleNotes.add((root + interval) % 12);
  }
  return scaleNotes;
}

// Find the note index that is playing at a given time
function findNoteIndexAtTime(notes: NoteEvent[], currentTime: number): number {
  if (notes.length === 0 || currentTime < 0) return -1;

  for (let i = notes.length - 1; i >= 0; i--) {
    const note = notes[i];
    if (currentTime >= note.startTime && currentTime < note.startTime + note.duration) {
      return i;
    }
    // If we've passed this note, check if we're between notes
    if (currentTime >= note.startTime + note.duration) {
      // Return the last note that has started
      for (let j = i; j < notes.length; j++) {
        if (notes[j].startTime <= currentTime) {
          return j;
        }
      }
      return i;
    }
  }

  return -1;
}

function snapToKey(midi: number, key: string): number {
  const scaleNotes = getScaleNotes(key);
  const noteInOctave = midi % 12;

  if (scaleNotes.has(noteInOctave)) {
    return midi; // Already in key
  }

  // Find nearest note in key
  for (let offset = 1; offset <= 6; offset++) {
    if (scaleNotes.has((noteInOctave + offset) % 12)) {
      return midi + offset;
    }
    if (scaleNotes.has((noteInOctave - offset + 12) % 12)) {
      return midi - offset;
    }
  }

  return midi;
}

export default function Home() {
  const [notes, setNotes] = useState<NoteEvent[]>([]);
  const [measures, setMeasures] = useState<QuantizedNote[][]>([]);
  const [fileName, setFileName] = useState<string>('');
  const [tempo, setTempo] = useState(120);
  const [minQuantization, setMinQuantization] = useState<NoteDuration>('eighth');
  const [beatsPerMeasure, setBeatsPerMeasure] = useState(4);
  const [keySignature, setKeySignature] = useState('C');
  const [snapToKeyEnabled, setSnapToKeyEnabled] = useState(false);

  // Composition state
  const [editMode, setEditMode] = useState<'select' | 'add'>('select');
  const [selectedNoteIndex, setSelectedNoteIndex] = useState<number | null>(null);
  const [inputDuration, setInputDuration] = useState<NoteDuration>('quarter');

  // Harmony state
  const [harmonyStyle, setHarmonyStyle] = useState<HarmonyStyle | null>(null);
  const [harmonyVoices, setHarmonyVoices] = useState<HarmonyVoice[]>([]);
  const [harmonyMeasures, setHarmonyMeasures] = useState<QuantizedNote[][][]>([]); // measures per voice
  const [voiceEnabled, setVoiceEnabled] = useState<boolean[]>([]);
  const [isMinorKey, setIsMinorKey] = useState(false);
  const [leadVoiceEnabled, setLeadVoiceEnabled] = useState(true);

  // Chord track state
  const [chords, setChords] = useState<ChordEvent[]>([]);
  const [chordsEnabled, setChordsEnabled] = useState(true);

  // Generate harmony when style, notes, key, minor mode, or chords change
  useEffect(() => {
    if (!harmonyStyle || notes.length === 0) {
      setHarmonyVoices([]);
      setHarmonyMeasures([]);
      setVoiceEnabled([]);
      return;
    }

    // Pass chords to harmony generation for chord-based styles
    const result = generateHarmony(notes, harmonyStyle, keySignature, isMinorKey, chords, tempo);
    setHarmonyVoices(result.voices);
    setVoiceEnabled(result.voices.map(() => true)); // Enable all voices by default

    // Quantize each harmony voice into measures
    const voiceMeasures = result.voices.map(voice => {
      const quantized = quantizeNotes(voice.notes, { tempo, minQuantization, keySignature });
      return groupIntoMeasures(quantized, beatsPerMeasure);
    });
    setHarmonyMeasures(voiceMeasures);
  }, [harmonyStyle, notes, keySignature, isMinorKey, tempo, minQuantization, beatsPerMeasure, chords]);

  // Combine melody with enabled harmony voices and chords for playback
  const playbackNotes = useMemo(() => {
    const enabledVoices = harmonyVoices.filter((_, i) => voiceEnabled[i]);
    let combined = combineVoicesForPlayback(
      leadVoiceEnabled ? notes : [],
      enabledVoices,
      leadVoiceEnabled
    );

    // Add chord notes if enabled
    if (chordsEnabled && chords.length > 0) {
      const chordNotes = chords.flatMap(chord =>
        chordToNoteEvents(chord, tempo, 3, 60) // octave 3, velocity 60
      );
      combined = [...combined, ...chordNotes].sort((a, b) => a.startTime - b.startTime);
    }

    return combined;
  }, [notes, harmonyVoices, voiceEnabled, leadVoiceEnabled, chords, chordsEnabled, tempo]);

  const { analyze, isAnalyzing, progress, error } = useAudioAnalysis();
  const { play, playFrom, stop, toggle, setTempo: setPlaybackTempo, setCursorPosition, playbackState, cursorPosition, isLoading } = usePlayback(playbackNotes);
  const { getAudioContext, resumeContext } = useAudioContext();

  const previewInstrumentRef = useRef<Soundfont.Player | null>(null);
  const previewNodeRef = useRef<Soundfont.Player | null>(null);

  const requantize = useCallback((
    noteList: NoteEvent[],
    bpm: number,
    quantization: NoteDuration,
    beats: number,
    key: string,
    snapToScale: boolean
  ) => {
    if (noteList.length === 0) {
      setMeasures([]);
      return;
    }

    // Optionally snap notes to key
    const processedNotes = snapToScale
      ? noteList.map(note => ({
          ...note,
          midi: snapToKey(note.midi, key),
        }))
      : noteList;

    const quantized = quantizeNotes(processedNotes, { tempo: bpm, minQuantization: quantization, keySignature: key });
    const grouped = groupIntoMeasures(quantized, beats);
    setMeasures(grouped);
  }, []);

  const handleFileSelect = useCallback(
    async (file: File) => {
      setFileName(file.name);
      setNotes([]);
      setMeasures([]);
      setSelectedNoteIndex(null);

      try {
        const result = await analyze(file);

        if (result.notes.length === 0) {
          return;
        }

        // Use detected tempo if confidence is good
        const effectiveTempo = result.tempoConfidence >= 0.3 ? result.detectedTempo : tempo;
        if (result.tempoConfidence >= 0.3 && result.detectedTempo !== tempo) {
          console.log(`Using detected tempo: ${result.detectedTempo} BPM (confidence: ${(result.tempoConfidence * 100).toFixed(0)}%)`);
          setTempo(result.detectedTempo);
          setPlaybackTempo(result.detectedTempo);
        }

        setNotes(result.notes);
        requantize(result.notes, effectiveTempo, minQuantization, beatsPerMeasure, keySignature, snapToKeyEnabled);
      } catch (err) {
        console.error('Analysis failed:', err);
      }
    },
    [analyze, tempo, minQuantization, beatsPerMeasure, keySignature, snapToKeyEnabled, requantize, setPlaybackTempo]
  );

  const handleMidiSelect = useCallback(
    async (file: File) => {
      setFileName(file.name);
      setNotes([]);
      setMeasures([]);
      setSelectedNoteIndex(null);

      try {
        const result = await parseMidiFile(file);

        if (result.notes.length === 0) {
          console.log('No notes found in MIDI file');
          return;
        }

        // Update tempo from MIDI file
        setTempo(result.tempo);
        setPlaybackTempo(result.tempo);

        setNotes(result.notes);
        requantize(result.notes, result.tempo, minQuantization, beatsPerMeasure, keySignature, snapToKeyEnabled);

        console.log(`Loaded ${result.notes.length} notes from MIDI at ${result.tempo} BPM`);
      } catch (err) {
        console.error('MIDI import failed:', err);
      }
    },
    [minQuantization, beatsPerMeasure, keySignature, snapToKeyEnabled, requantize, setPlaybackTempo]
  );

  const handleTempoChange = useCallback(
    (newTempo: number) => {
      setTempo(newTempo);
      setPlaybackTempo(newTempo);
      requantize(notes, newTempo, minQuantization, beatsPerMeasure, keySignature, snapToKeyEnabled);
    },
    [notes, minQuantization, beatsPerMeasure, keySignature, snapToKeyEnabled, setPlaybackTempo, requantize]
  );

  const handleQuantizationChange = useCallback(
    (newQuantization: NoteDuration) => {
      setMinQuantization(newQuantization);
      requantize(notes, tempo, newQuantization, beatsPerMeasure, keySignature, snapToKeyEnabled);
    },
    [notes, tempo, beatsPerMeasure, keySignature, snapToKeyEnabled, requantize]
  );

  const handleBeatsPerMeasureChange = useCallback(
    (newBeats: number) => {
      setBeatsPerMeasure(newBeats);
      requantize(notes, tempo, minQuantization, newBeats, keySignature, snapToKeyEnabled);
    },
    [notes, tempo, minQuantization, keySignature, snapToKeyEnabled, requantize]
  );

  const playPreviewNote = useCallback(async (midi: number) => {
    try {
      await resumeContext();
      const audioContext = getAudioContext();

      if (!previewInstrumentRef.current) {
        previewInstrumentRef.current = await loadInstrument(audioContext);
      }

      if (previewNodeRef.current) {
        try {
          previewNodeRef.current.stop();
        } catch (e) {
          // Ignore
        }
      }

      const noteNames = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
      const octave = Math.floor(midi / 12) - 1;
      const noteName = `${noteNames[midi % 12]}${octave}`;

      previewNodeRef.current = previewInstrumentRef.current.play(noteName, audioContext.currentTime, {
        duration: 2,
        gain: 1.5,
      });
    } catch (err) {
      console.error('Error playing preview note:', err);
    }
  }, [getAudioContext, resumeContext]);

  const stopPreviewNote = useCallback(() => {
    if (previewNodeRef.current) {
      try {
        previewNodeRef.current.stop();
      } catch (e) {
        // Ignore
      }
      previewNodeRef.current = null;
    }
  }, []);

  // Handle seeking to a note position
  const handleSeek = useCallback((noteIndex: number) => {
    setCursorPosition(noteIndex);
  }, [setCursorPosition]);

  // Handle note selection
  const handleNoteSelect = useCallback((noteIndex: number | null) => {
    setSelectedNoteIndex(noteIndex);
  }, []);

  // Handle adding a new note
  const handleNoteAdd = useCallback((midi: number, beat: number) => {
    // Snap to key if enabled
    const finalMidi = snapToKeyEnabled ? snapToKey(midi, keySignature) : midi;

    // Calculate duration in seconds
    const secondsPerBeat = 60 / tempo;
    const durationBeats = DURATION_BEATS[inputDuration] || 1;
    const durationSeconds = durationBeats * secondsPerBeat;

    // Calculate start time in seconds
    const startTime = beat * secondsPerBeat;

    const newNote: NoteEvent = {
      midi: finalMidi,
      frequency: 440 * Math.pow(2, (finalMidi - 69) / 12),
      startTime,
      duration: durationSeconds,
      velocity: 80,
    };

    // Insert note in sorted order by start time
    const updatedNotes = [...notes, newNote].sort((a, b) => a.startTime - b.startTime);
    setNotes(updatedNotes);

    // Find the index of the new note and select it
    const newIndex = updatedNotes.findIndex(n => n === newNote);
    setSelectedNoteIndex(newIndex);

    // Requantize
    requantize(updatedNotes, tempo, minQuantization, beatsPerMeasure, keySignature, snapToKeyEnabled);
  }, [notes, tempo, inputDuration, keySignature, snapToKeyEnabled, minQuantization, beatsPerMeasure, requantize]);

  // Handle deleting a note
  const handleDeleteNote = useCallback(() => {
    if (selectedNoteIndex === null || selectedNoteIndex < 0 || selectedNoteIndex >= notes.length) {
      return;
    }

    const updatedNotes = notes.filter((_, i) => i !== selectedNoteIndex);
    setNotes(updatedNotes);
    setSelectedNoteIndex(null);

    requantize(updatedNotes, tempo, minQuantization, beatsPerMeasure, keySignature, snapToKeyEnabled);
  }, [selectedNoteIndex, notes, tempo, minQuantization, beatsPerMeasure, keySignature, snapToKeyEnabled, requantize]);

  // Handle clearing all notes
  const handleClearAll = useCallback(() => {
    if (confirm('Are you sure you want to clear all notes?')) {
      setNotes([]);
      setMeasures([]);
      setSelectedNoteIndex(null);
    }
  }, []);

  // Handle MIDI download
  const handleDownloadMidi = useCallback(() => {
    if (notes.length === 0) return;
    const filename = fileName ? fileName.replace(/\.[^/.]+$/, '.mid') : 'composition.mid';
    downloadMidi(notes, tempo, filename);
  }, [notes, tempo, fileName]);

  // Handle harmony style change
  const handleHarmonyStyleChange = useCallback((style: HarmonyStyle | null) => {
    setHarmonyStyle(style);
  }, []);

  // Handle toggling harmony voices
  const handleToggleVoice = useCallback((index: number) => {
    setVoiceEnabled(prev => {
      const updated = [...prev];
      updated[index] = !updated[index];
      return updated;
    });
  }, []);

  // Handle harmony MIDI download
  const handleDownloadHarmony = useCallback(() => {
    if (notes.length === 0 || harmonyVoices.length === 0) return;

    // Filter to only enabled voices
    const enabledVoices = harmonyVoices.filter((_, i) => voiceEnabled[i]);
    if (enabledVoices.length === 0) return;

    const filename = fileName
      ? fileName.replace(/\.[^/.]+$/, '_harmony.mid')
      : 'harmony.mid';
    downloadMidiWithHarmony(notes, enabledVoices, tempo, filename);
  }, [notes, harmonyVoices, voiceEnabled, tempo, fileName]);

  // Calculate total beats for chord track
  const totalBeats = useMemo(() => {
    if (notes.length === 0) return beatsPerMeasure * 4; // Default 4 measures
    const lastNote = notes[notes.length - 1];
    const totalSeconds = lastNote.startTime + lastNote.duration;
    const secondsPerBeat = 60 / tempo;
    return Math.ceil(totalSeconds / secondsPerBeat);
  }, [notes, tempo, beatsPerMeasure]);

  // Recalculate chord durations so each extends until the next chord
  const recalculateChordDurations = useCallback((chordList: ChordEvent[]): ChordEvent[] => {
    if (chordList.length === 0) return chordList;
    const sorted = [...chordList].sort((a, b) => a.startBeat - b.startBeat);
    return sorted.map((chord, index) => {
      const nextChordStart = index < sorted.length - 1
        ? sorted[index + 1].startBeat
        : Math.max(totalBeats, chord.startBeat + beatsPerMeasure);
      return { ...chord, durationBeats: nextChordStart - chord.startBeat };
    });
  }, [totalBeats, beatsPerMeasure]);

  // Handle chord suggestion
  const handleSuggestChords = useCallback(() => {
    if (notes.length === 0) return;
    const suggested = suggestChords(notes, keySignature, isMinorKey, beatsPerMeasure, tempo);
    // Recalculate durations so each chord extends until the next
    const processed = recalculateChordDurations(suggested);
    setChords(processed);
  }, [notes, keySignature, isMinorKey, beatsPerMeasure, tempo, recalculateChordDurations]);

  // Handle transpose (change key)
  const handleTranspose = useCallback((semitones: number) => {
    if (notes.length === 0) return;

    const transposedNotes = notes.map(note => ({
      ...note,
      midi: Math.max(21, Math.min(108, note.midi + semitones)),
      frequency: 440 * Math.pow(2, (note.midi + semitones - 69) / 12),
    }));

    setNotes(transposedNotes);
    requantize(transposedNotes, tempo, minQuantization, beatsPerMeasure, keySignature, snapToKeyEnabled);
  }, [notes, tempo, minQuantization, beatsPerMeasure, keySignature, snapToKeyEnabled, requantize]);

  // Handle changing duration of selected note
  const handleSelectedNoteDurationChange = useCallback((newDuration: NoteDuration) => {
    setInputDuration(newDuration);

    // If a note is selected, update its duration
    if (selectedNoteIndex !== null && selectedNoteIndex >= 0 && selectedNoteIndex < notes.length) {
      const secondsPerBeat = 60 / tempo;
      const durationBeats = DURATION_BEATS[newDuration] || 1;
      const durationSeconds = durationBeats * secondsPerBeat;

      const updatedNotes = [...notes];
      updatedNotes[selectedNoteIndex] = {
        ...updatedNotes[selectedNoteIndex],
        duration: durationSeconds,
      };
      setNotes(updatedNotes);
      requantize(updatedNotes, tempo, minQuantization, beatsPerMeasure, keySignature, snapToKeyEnabled);
    }
  }, [selectedNoteIndex, notes, tempo, minQuantization, beatsPerMeasure, keySignature, snapToKeyEnabled, requantize]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input
      if (e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLTextAreaElement ||
          e.target instanceof HTMLSelectElement) {
        return;
      }

      // Space bar for play/pause
      if (e.code === 'Space') {
        e.preventDefault();
        if (notes.length > 0) {
          toggle();
        }
      }

      // Delete/Backspace to delete selected note
      if ((e.code === 'Delete' || e.code === 'Backspace') && selectedNoteIndex !== null) {
        e.preventDefault();
        handleDeleteNote();
      }

      // Number keys for durations
      const durationKeys: Record<string, NoteDuration> = {
        '1': 'whole',
        '2': 'half',
        '3': 'quarter',
        '4': 'eighth',
        '5': 'sixteenth',
      };
      if (durationKeys[e.key]) {
        setInputDuration(durationKeys[e.key]);
      }

      // 'A' to toggle add mode
      if (e.key === 'a' || e.key === 'A') {
        setEditMode(prev => prev === 'add' ? 'select' : 'add');
      }

      // Escape to deselect
      if (e.code === 'Escape') {
        setSelectedNoteIndex(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [notes.length, toggle, selectedNoteIndex, handleDeleteNote]);

  const handleNoteChange = useCallback(
    (noteIndex: number, newMidi: number) => {
      // Snap to key if enabled
      const finalMidi = snapToKeyEnabled ? snapToKey(newMidi, keySignature) : newMidi;

      // Update the raw notes
      const updatedNotes = [...notes];
      if (noteIndex >= 0 && noteIndex < updatedNotes.length) {
        updatedNotes[noteIndex] = {
          ...updatedNotes[noteIndex],
          midi: finalMidi,
          frequency: 440 * Math.pow(2, (finalMidi - 69) / 12),
        };
        setNotes(updatedNotes);

        // Re-quantize with updated notes
        requantize(updatedNotes, tempo, minQuantization, beatsPerMeasure, keySignature, snapToKeyEnabled);
      }
    },
    [notes, tempo, minQuantization, beatsPerMeasure, keySignature, snapToKeyEnabled, requantize]
  );

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-zinc-900 dark:text-white mb-2">
            Harmonizer
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            Convert audio melodies to sheet music or compose from scratch
          </p>
        </div>

        {/* Settings Panel */}
        <section className="mb-6 p-4 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-700">
          <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-3">Settings</h2>
          <div className="flex flex-wrap gap-6">
            {/* BPM Input */}
            <div className="flex items-center gap-2">
              <label className="text-sm text-zinc-600 dark:text-zinc-400">BPM:</label>
              <input
                type="number"
                min="40"
                max="240"
                value={tempo}
                onChange={(e) => handleTempoChange(Number(e.target.value) || 120)}
                className="w-20 px-2 py-1 text-sm border border-zinc-300 dark:border-zinc-600 rounded bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white"
              />
            </div>

            {/* Quantization Select */}
            <div className="flex items-center gap-2">
              <label className="text-sm text-zinc-600 dark:text-zinc-400">Min Note:</label>
              <select
                value={minQuantization}
                onChange={(e) => handleQuantizationChange(e.target.value as NoteDuration)}
                className="px-2 py-1 text-sm border border-zinc-300 dark:border-zinc-600 rounded bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white"
              >
                {QUANTIZATION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Beats Per Measure */}
            <div className="flex items-center gap-2">
              <label className="text-sm text-zinc-600 dark:text-zinc-400">Time Sig:</label>
              <select
                value={beatsPerMeasure}
                onChange={(e) => handleBeatsPerMeasureChange(Number(e.target.value))}
                className="px-2 py-1 text-sm border border-zinc-300 dark:border-zinc-600 rounded bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white"
              >
                <option value={2}>2/4</option>
                <option value={3}>3/4</option>
                <option value={4}>4/4</option>
                <option value={6}>6/4</option>
              </select>
            </div>

            {/* Key Signature */}
            <div className="flex items-center gap-2">
              <label className="text-sm text-zinc-600 dark:text-zinc-400">Key:</label>
              <select
                value={keySignature}
                onChange={(e) => {
                  const newKey = e.target.value;
                  setKeySignature(newKey);
                  requantize(notes, tempo, minQuantization, beatsPerMeasure, newKey, snapToKeyEnabled);
                }}
                className="px-2 py-1 text-sm border border-zinc-300 dark:border-zinc-600 rounded bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white"
              >
                {KEY_SIGNATURES.map((key) => (
                  <option key={key.value} value={key.value}>
                    {key.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Snap to Key */}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="snapToKey"
                checked={snapToKeyEnabled}
                onChange={(e) => {
                  const enabled = e.target.checked;
                  setSnapToKeyEnabled(enabled);
                  requantize(notes, tempo, minQuantization, beatsPerMeasure, keySignature, enabled);
                }}
                className="w-4 h-4 rounded border-zinc-300 dark:border-zinc-600"
              />
              <label htmlFor="snapToKey" className="text-sm text-zinc-600 dark:text-zinc-400">
                Snap to key
              </label>
            </div>

            {/* Transpose */}
            {notes.length > 0 && (
              <div className="flex items-center gap-2">
                <label className="text-sm text-zinc-600 dark:text-zinc-400">Transpose:</label>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleTranspose(-12)}
                    className="px-2 py-1 text-xs bg-zinc-200 dark:bg-zinc-700 rounded hover:bg-zinc-300 dark:hover:bg-zinc-600"
                    title="Down octave"
                  >
                    -8va
                  </button>
                  <button
                    onClick={() => handleTranspose(-1)}
                    className="px-2 py-1 text-xs bg-zinc-200 dark:bg-zinc-700 rounded hover:bg-zinc-300 dark:hover:bg-zinc-600"
                    title="Down semitone"
                  >
                    -1
                  </button>
                  <button
                    onClick={() => handleTranspose(1)}
                    className="px-2 py-1 text-xs bg-zinc-200 dark:bg-zinc-700 rounded hover:bg-zinc-300 dark:hover:bg-zinc-600"
                    title="Up semitone"
                  >
                    +1
                  </button>
                  <button
                    onClick={() => handleTranspose(12)}
                    className="px-2 py-1 text-xs bg-zinc-200 dark:bg-zinc-700 rounded hover:bg-zinc-300 dark:hover:bg-zinc-600"
                    title="Up octave"
                  >
                    +8va
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Harmony Panel */}
        <HarmonyPanel
          harmonyStyle={harmonyStyle}
          onStyleChange={handleHarmonyStyleChange}
          harmonyVoices={harmonyVoices}
          onToggleVoice={handleToggleVoice}
          voiceEnabled={voiceEnabled}
          onDownloadHarmony={handleDownloadHarmony}
          hasNotes={notes.length > 0}
          hasChords={chords.length > 0}
          isMinor={isMinorKey}
          onMinorChange={setIsMinorKey}
          leadVoiceEnabled={leadVoiceEnabled}
          onLeadVoiceToggle={() => setLeadVoiceEnabled(!leadVoiceEnabled)}
        />

        {/* Upload Section */}
        <section className="mb-6">
          <AudioUploader onFileSelect={handleFileSelect} onMidiSelect={handleMidiSelect} disabled={isAnalyzing} />
        </section>

        {/* Processing Status */}
        <section className="mb-6">
          <ProcessingStatus
            isProcessing={isAnalyzing}
            progress={progress}
            error={error}
            fileName={fileName}
          />
        </section>

        {/* Score Toolbar */}
        <section className="mb-2">
          <ScoreToolbar
            selectedDuration={inputDuration}
            onDurationChange={handleSelectedNoteDurationChange}
            editMode={editMode}
            onEditModeChange={setEditMode}
            selectedNoteIndex={selectedNoteIndex}
            onDeleteNote={handleDeleteNote}
            onClearAll={handleClearAll}
            onDownloadMidi={handleDownloadMidi}
            hasNotes={notes.length > 0}
          />
        </section>

        {/* DAW-Style Multi-Track Score Display */}
        <section className="mb-6">
          <div className="rounded-lg border border-zinc-300 dark:border-zinc-600 overflow-hidden">
            {/* Track container with horizontal scrolling */}
            <div className="overflow-x-auto bg-white">
              {/* All tracks stacked vertically */}
              <div className="min-w-max">
                {/* Lead Voice Track */}
                {leadVoiceEnabled && (
                  <div className="flex border-b border-zinc-200">
                    <div className="w-28 flex-shrink-0 bg-zinc-50 p-2 flex items-center gap-2 border-r border-zinc-200">
                      <span className="w-3 h-3 rounded-full bg-blue-500" />
                      <span className="text-xs font-medium text-zinc-700 truncate">Lead Voice</span>
                    </div>
                    <div className="flex-1 bg-white">
                      <ScoreDisplay
                        measures={measures}
                        currentNoteIndex={
                          playbackState.isPlaying
                            ? findNoteIndexAtTime(notes, playbackState.currentTime)
                            : cursorPosition
                        }
                        isPlaying={playbackState.isPlaying}
                        selectedNoteIndex={selectedNoteIndex}
                        editMode={editMode}
                        inputDuration={inputDuration}
                        onNoteChange={handleNoteChange}
                        onNoteSelect={handleNoteSelect}
                        onNoteAdd={handleNoteAdd}
                        onPlayNote={playPreviewNote}
                        onStopNote={stopPreviewNote}
                        beatsPerMeasure={beatsPerMeasure}
                        keySignature={keySignature}
                        onSeek={handleSeek}
                        singleLine={true}
                        compactHeight={true}
                      />
                    </div>
                  </div>
                )}

                {/* Harmony Voice Tracks */}
                {harmonyVoices.map((voice, index) => {
                  if (!voiceEnabled[index] || !harmonyMeasures[index]) return null;
                  const voiceMeasures = harmonyMeasures[index];
                  const voiceNotes = voice.notes;
                  return (
                    <div key={`harmony-${index}`} className="flex border-b border-zinc-200 last:border-b-0">
                      <div className="w-28 flex-shrink-0 bg-zinc-50 p-2 flex items-center gap-2 border-r border-zinc-200">
                        <span className="w-3 h-3 rounded-full" style={{ backgroundColor: voice.color }} />
                        <span className="text-xs font-medium text-zinc-700 truncate">{voice.name}</span>
                      </div>
                      <div className="flex-1 bg-white">
                        <ScoreDisplay
                          measures={voiceMeasures}
                          currentNoteIndex={
                            playbackState.isPlaying
                              ? findNoteIndexAtTime(voiceNotes, playbackState.currentTime)
                              : -1
                          }
                          isPlaying={playbackState.isPlaying}
                          selectedNoteIndex={null}
                          editMode="select"
                          inputDuration={inputDuration}
                          onNoteChange={() => {}}
                          onNoteSelect={() => {}}
                          onNoteAdd={() => {}}
                          onPlayNote={playPreviewNote}
                          onStopNote={stopPreviewNote}
                          beatsPerMeasure={beatsPerMeasure}
                          keySignature={keySignature}
                          onSeek={() => {}}
                          singleLine={true}
                          compactHeight={true}
                        />
                      </div>
                    </div>
                  );
                })}

                {/* Chord Track */}
                <div className="flex border-b border-zinc-200 last:border-b-0">
                  <div className="w-28 flex-shrink-0 bg-zinc-50 p-2 flex items-center gap-2 border-r border-zinc-200">
                    <input
                      type="checkbox"
                      checked={chordsEnabled}
                      onChange={(e) => setChordsEnabled(e.target.checked)}
                      className="w-3 h-3"
                    />
                    <span className="w-3 h-3 rounded-full bg-indigo-500" />
                    <span className="text-xs font-medium text-zinc-700 truncate">Chords</span>
                  </div>
                  <div className="flex-1 bg-white p-2">
                    <ChordTrack
                      chords={chords}
                      onChordsChange={setChords}
                      totalBeats={totalBeats}
                      beatsPerMeasure={beatsPerMeasure}
                      keySignature={keySignature}
                      isMinor={isMinorKey}
                      onSuggestChords={notes.length > 0 ? handleSuggestChords : undefined}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>


        {/* Notes Info */}
        {notes.length > 0 && (
          <div className="mb-4 text-center text-sm text-zinc-500 dark:text-zinc-400">
            {notes.length} note{notes.length !== 1 ? 's' : ''}
            {selectedNoteIndex !== null && ` • Note ${selectedNoteIndex + 1} selected`}
          </div>
        )}

        {/* Playback Controls */}
        <section>
          <PlaybackControls
            playbackState={playbackState}
            tempo={tempo}
            onPlay={play}
            onStop={stop}
            onTempoChange={handleTempoChange}
            isLoading={isLoading}
            disabled={notes.length === 0}
          />
        </section>

        {/* Keyboard Shortcuts Help */}
        <section className="mt-6 p-3 bg-zinc-100 dark:bg-zinc-800 rounded-lg text-xs text-zinc-500 dark:text-zinc-400">
          <strong className="text-zinc-700 dark:text-zinc-300">Keyboard shortcuts:</strong>
          <span className="ml-2">Space = Play/Pause</span>
          <span className="ml-2">A = Toggle Add mode</span>
          <span className="ml-2">1-5 = Select duration</span>
          <span className="ml-2">Delete = Remove note</span>
          <span className="ml-2">Esc = Deselect</span>
        </section>

        {/* Footer */}
        <footer className="mt-8 text-center text-sm text-zinc-400 dark:text-zinc-600">
          <p>Upload audio or click Add mode to compose from scratch</p>
        </footer>
      </main>
    </div>
  );
}
