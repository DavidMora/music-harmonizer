/**
 * Chord Library
 *
 * Provides chord definitions, interval calculations, and chord suggestion logic.
 */

import type {
  ChordEvent,
  TriadQuality,
  SeventhType,
  ChordExtension,
  ChordAlteration,
  NoteEvent,
} from '@/types/music';

// Note name to semitone offset from C
const NOTE_TO_SEMITONE: Record<string, number> = {
  'C': 0, 'C#': 1, 'Db': 1,
  'D': 2, 'D#': 3, 'Eb': 3,
  'E': 4, 'Fb': 4, 'E#': 5,
  'F': 5, 'F#': 6, 'Gb': 6,
  'G': 7, 'G#': 8, 'Ab': 8,
  'A': 9, 'A#': 10, 'Bb': 10,
  'B': 11, 'Cb': 11, 'B#': 0,
};

// Semitone to note name (using sharps)
const SEMITONE_TO_NOTE_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const SEMITONE_TO_NOTE_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

// Triad intervals (semitones from root)
const TRIAD_INTERVALS: Record<TriadQuality, number[]> = {
  'major': [0, 4, 7],
  'minor': [0, 3, 7],
  'diminished': [0, 3, 6],
  'augmented': [0, 4, 8],
  'sus2': [0, 2, 7],
  'sus4': [0, 5, 7],
  'power': [0, 7],
};

// Seventh intervals (added to triad)
const SEVENTH_INTERVALS: Record<NonNullable<SeventhType>, number> = {
  'major7': 11,
  'minor7': 10,
  'dominant7': 10,
  'diminished7': 9,
};

// Extension intervals
const EXTENSION_INTERVALS: Record<ChordExtension, number> = {
  'add9': 14,   // 2 + 12
  'add11': 17,  // 5 + 12
  'add13': 21,  // 9 + 12
  '9': 14,
  '11': 17,
  '13': 21,
};

// Alteration modifications (offset from natural interval)
const ALTERATION_BASE: Record<ChordAlteration, { base: number; offset: number }> = {
  'b5': { base: 7, offset: -1 },   // Flat fifth
  '#5': { base: 7, offset: 1 },    // Sharp fifth
  'b9': { base: 14, offset: -1 },  // Flat ninth
  '#9': { base: 14, offset: 1 },   // Sharp ninth
  '#11': { base: 17, offset: 1 },  // Sharp eleventh
  'b13': { base: 21, offset: -1 }, // Flat thirteenth
};

/**
 * Get all intervals for a chord
 */
export function getChordIntervals(chord: ChordEvent): number[] {
  const intervals = new Set<number>();

  // Add triad intervals
  for (const interval of TRIAD_INTERVALS[chord.triad]) {
    intervals.add(interval);
  }

  // Add seventh if present
  if (chord.seventh) {
    intervals.add(SEVENTH_INTERVALS[chord.seventh]);
  }

  // Add extensions
  if (chord.extensions) {
    for (const ext of chord.extensions) {
      intervals.add(EXTENSION_INTERVALS[ext]);

      // For full extensions (9, 11, 13), include lower extensions and seventh
      if (ext === '9' || ext === '11' || ext === '13') {
        if (!chord.seventh) {
          intervals.add(10); // Add dominant 7 by default
        }
      }
      if (ext === '11' || ext === '13') {
        intervals.add(14); // Add 9
      }
      if (ext === '13') {
        intervals.add(17); // Add 11
      }
    }
  }

  // Apply alterations
  if (chord.alterations) {
    for (const alt of chord.alterations) {
      const { base, offset } = ALTERATION_BASE[alt];
      intervals.delete(base);
      intervals.add(base + offset);
    }
  }

  return Array.from(intervals).sort((a, b) => a - b);
}

/**
 * Convert chord to MIDI notes
 */
export function chordToMidi(chord: ChordEvent, baseOctave: number = 3): number[] {
  const rootSemitone = NOTE_TO_SEMITONE[chord.root];
  if (rootSemitone === undefined) {
    console.warn(`Unknown root note: ${chord.root}`);
    return [];
  }

  const baseMidi = 12 + (baseOctave * 12) + rootSemitone; // C0 = 12
  const intervals = getChordIntervals(chord);

  let midiNotes = intervals.map(interval => baseMidi + interval);

  // Apply inversion
  if (chord.inversion && chord.inversion > 0) {
    for (let i = 0; i < chord.inversion && i < midiNotes.length - 1; i++) {
      midiNotes[i] += 12; // Move note up an octave
    }
    midiNotes.sort((a, b) => a - b);
  }

  // Handle slash chord bass note
  if (chord.bassNote) {
    const bassSemitone = NOTE_TO_SEMITONE[chord.bassNote];
    if (bassSemitone !== undefined) {
      const bassMidi = 12 + ((baseOctave - 1) * 12) + bassSemitone;
      // Remove any notes that would conflict, add bass
      midiNotes = midiNotes.filter(m => m > bassMidi + 2);
      midiNotes.unshift(bassMidi);
    }
  }

  return midiNotes;
}

/**
 * Convert chord to NoteEvents for playback
 */
export function chordToNoteEvents(
  chord: ChordEvent,
  tempo: number,
  baseOctave: number = 3,
  velocity: number = 70
): NoteEvent[] {
  const midiNotes = chordToMidi(chord, baseOctave);
  const secondsPerBeat = 60 / tempo;
  const startTime = chord.startBeat * secondsPerBeat;
  const duration = chord.durationBeats * secondsPerBeat;

  return midiNotes.map(midi => ({
    midi,
    frequency: 440 * Math.pow(2, (midi - 69) / 12),
    startTime,
    duration,
    velocity,
  }));
}

/**
 * Common chord presets for quick selection
 */
export const CHORD_PRESETS: Array<{ name: string; chord: Partial<ChordEvent> }> = [
  // Basic triads
  { name: 'Major', chord: { triad: 'major' } },
  { name: 'Minor', chord: { triad: 'minor' } },
  { name: 'Diminished', chord: { triad: 'diminished' } },
  { name: 'Augmented', chord: { triad: 'augmented' } },
  { name: 'Sus2', chord: { triad: 'sus2' } },
  { name: 'Sus4', chord: { triad: 'sus4' } },
  { name: 'Power', chord: { triad: 'power' } },

  // Sevenths
  { name: 'Major 7', chord: { triad: 'major', seventh: 'major7' } },
  { name: 'Minor 7', chord: { triad: 'minor', seventh: 'minor7' } },
  { name: 'Dominant 7', chord: { triad: 'major', seventh: 'dominant7' } },
  { name: 'Minor 7b5', chord: { triad: 'diminished', seventh: 'minor7' } },
  { name: 'Dim 7', chord: { triad: 'diminished', seventh: 'diminished7' } },

  // Extensions
  { name: 'Add9', chord: { triad: 'major', extensions: ['add9'] } },
  { name: 'Madd9', chord: { triad: 'minor', extensions: ['add9'] } },
  { name: '9', chord: { triad: 'major', seventh: 'dominant7', extensions: ['9'] } },
  { name: 'Maj9', chord: { triad: 'major', seventh: 'major7', extensions: ['9'] } },
  { name: 'Min9', chord: { triad: 'minor', seventh: 'minor7', extensions: ['9'] } },
  { name: '11', chord: { triad: 'major', seventh: 'dominant7', extensions: ['11'] } },
  { name: '13', chord: { triad: 'major', seventh: 'dominant7', extensions: ['13'] } },

  // Altered dominants
  { name: '7#5', chord: { triad: 'major', seventh: 'dominant7', alterations: ['#5'] } },
  { name: '7b5', chord: { triad: 'major', seventh: 'dominant7', alterations: ['b5'] } },
  { name: '7#9', chord: { triad: 'major', seventh: 'dominant7', alterations: ['#9'] } },
  { name: '7b9', chord: { triad: 'major', seventh: 'dominant7', alterations: ['b9'] } },
  { name: '7alt', chord: { triad: 'major', seventh: 'dominant7', alterations: ['b5', '#9'] } },
];

/**
 * Scale degrees for each key (for chord suggestion)
 */
const MAJOR_SCALE_CHORDS: Array<{ degree: number; triad: TriadQuality; seventh?: SeventhType }> = [
  { degree: 0, triad: 'major', seventh: 'major7' },      // I
  { degree: 2, triad: 'minor', seventh: 'minor7' },      // ii
  { degree: 4, triad: 'minor', seventh: 'minor7' },      // iii
  { degree: 5, triad: 'major', seventh: 'major7' },      // IV
  { degree: 7, triad: 'major', seventh: 'dominant7' },   // V
  { degree: 9, triad: 'minor', seventh: 'minor7' },      // vi
  { degree: 11, triad: 'diminished', seventh: 'minor7' }, // vii°
];

const MINOR_SCALE_CHORDS: Array<{ degree: number; triad: TriadQuality; seventh?: SeventhType }> = [
  { degree: 0, triad: 'minor', seventh: 'minor7' },      // i
  { degree: 2, triad: 'diminished', seventh: 'minor7' }, // ii°
  { degree: 3, triad: 'major', seventh: 'major7' },      // III
  { degree: 5, triad: 'minor', seventh: 'minor7' },      // iv
  { degree: 7, triad: 'major', seventh: 'dominant7' },   // V (harmonic minor)
  { degree: 8, triad: 'major', seventh: 'major7' },      // VI
  { degree: 10, triad: 'major', seventh: 'dominant7' },  // VII
];

/**
 * Suggest chords based on melody notes and key
 */
export function suggestChords(
  melodyNotes: NoteEvent[],
  keyRoot: string,
  isMinor: boolean,
  beatsPerMeasure: number,
  tempo: number
): ChordEvent[] {
  const keyRootSemitone = NOTE_TO_SEMITONE[keyRoot] ?? 0;
  const scaleChords = isMinor ? MINOR_SCALE_CHORDS : MAJOR_SCALE_CHORDS;
  const suggestions: ChordEvent[] = [];
  const secondsPerBeat = 60 / tempo;

  // Group melody notes by measure/beat
  const totalBeats = melodyNotes.length > 0
    ? Math.ceil((melodyNotes[melodyNotes.length - 1].startTime + melodyNotes[melodyNotes.length - 1].duration) / secondsPerBeat)
    : 0;

  // Suggest one chord per measure (or every 2 beats for faster changes)
  const chordInterval = beatsPerMeasure; // One chord per measure

  for (let beat = 0; beat < totalBeats; beat += chordInterval) {
    const beatStartTime = beat * secondsPerBeat;
    const beatEndTime = (beat + chordInterval) * secondsPerBeat;

    // Find melody notes in this region
    const notesInRegion = melodyNotes.filter(n =>
      n.startTime < beatEndTime && n.startTime + n.duration > beatStartTime
    );

    if (notesInRegion.length === 0) {
      continue;
    }

    // Get the pitch classes present
    const pitchClasses = new Set(notesInRegion.map(n => n.midi % 12));

    // Score each scale chord based on how many melody notes it contains
    let bestChord: { degree: number; triad: TriadQuality; seventh?: SeventhType } | null = null;
    let bestScore = -1;

    for (const scaleChord of scaleChords) {
      const chordRoot = (keyRootSemitone + scaleChord.degree) % 12;
      const chordIntervals = TRIAD_INTERVALS[scaleChord.triad];
      const chordPitches = new Set(chordIntervals.map(i => (chordRoot + i) % 12));

      // Score: count matching pitches
      let score = 0;
      for (const pc of pitchClasses) {
        if (chordPitches.has(pc)) {
          score++;
        }
      }

      // Bonus for root in melody
      if (pitchClasses.has(chordRoot)) {
        score += 0.5;
      }

      if (score > bestScore) {
        bestScore = score;
        bestChord = scaleChord;
      }
    }

    if (bestChord && bestScore > 0) {
      const chordRootSemitone = (keyRootSemitone + bestChord.degree) % 12;
      const chordRootName = SEMITONE_TO_NOTE_SHARP[chordRootSemitone];

      suggestions.push({
        root: chordRootName,
        triad: bestChord.triad,
        seventh: undefined, // Start with triads, user can add 7ths
        startBeat: beat,
        durationBeats: chordInterval,
      });
    }
  }

  return suggestions;
}

/**
 * Get all notes in a key (for validation)
 */
export function getScaleNotes(keyRoot: string, isMinor: boolean): number[] {
  const root = NOTE_TO_SEMITONE[keyRoot] ?? 0;
  const intervals = isMinor
    ? [0, 2, 3, 5, 7, 8, 10] // Natural minor
    : [0, 2, 4, 5, 7, 9, 11]; // Major

  return intervals.map(i => (root + i) % 12);
}

/**
 * Check if a chord fits well in a key
 */
export function chordFitsKey(chord: ChordEvent, keyRoot: string, isMinor: boolean): boolean {
  const scaleNotes = new Set(getScaleNotes(keyRoot, isMinor));
  const chordRoot = NOTE_TO_SEMITONE[chord.root] ?? 0;
  const intervals = getChordIntervals(chord);

  // Check if most chord tones are in the scale
  let inScale = 0;
  for (const interval of intervals.slice(0, 4)) { // Check first 4 notes
    if (scaleNotes.has((chordRoot + interval) % 12)) {
      inScale++;
    }
  }

  return inScale >= Math.min(3, intervals.length);
}
