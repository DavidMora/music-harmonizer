'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { ChordEvent, TriadQuality, SeventhType, ChordExtension, ChordAlteration } from '@/types/music';
import { chordToSymbol } from '@/types/music';
import { CHORD_PRESETS } from '@/lib/harmony/chords';

interface ChordTrackProps {
  chords: ChordEvent[];
  onChordsChange: (chords: ChordEvent[]) => void;
  totalBeats: number;
  beatsPerMeasure: number;
  keySignature: string;
  isMinor: boolean;
  onSuggestChords?: () => void;
}

const ROOT_NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const ROOT_NOTES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

// Colors for each root note (using HSL for consistent saturation/lightness)
const ROOT_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  'C':  { bg: 'rgba(239, 68, 68, 0.7)',  border: '#dc2626', text: '#7f1d1d' },   // Red
  'C#': { bg: 'rgba(249, 115, 22, 0.7)', border: '#ea580c', text: '#7c2d12' },  // Orange
  'Db': { bg: 'rgba(249, 115, 22, 0.7)', border: '#ea580c', text: '#7c2d12' },  // Orange
  'D':  { bg: 'rgba(234, 179, 8, 0.7)',  border: '#ca8a04', text: '#713f12' },   // Yellow
  'D#': { bg: 'rgba(132, 204, 22, 0.7)', border: '#65a30d', text: '#365314' },  // Lime
  'Eb': { bg: 'rgba(132, 204, 22, 0.7)', border: '#65a30d', text: '#365314' },  // Lime
  'E':  { bg: 'rgba(34, 197, 94, 0.7)',  border: '#16a34a', text: '#14532d' },   // Green
  'F':  { bg: 'rgba(20, 184, 166, 0.7)', border: '#0d9488', text: '#134e4a' },   // Teal
  'F#': { bg: 'rgba(6, 182, 212, 0.7)',  border: '#0891b2', text: '#164e63' },   // Cyan
  'Gb': { bg: 'rgba(6, 182, 212, 0.7)',  border: '#0891b2', text: '#164e63' },   // Cyan
  'G':  { bg: 'rgba(59, 130, 246, 0.7)', border: '#2563eb', text: '#1e3a8a' },   // Blue
  'G#': { bg: 'rgba(99, 102, 241, 0.7)', border: '#4f46e5', text: '#312e81' },  // Indigo
  'Ab': { bg: 'rgba(99, 102, 241, 0.7)', border: '#4f46e5', text: '#312e81' },  // Indigo
  'A':  { bg: 'rgba(168, 85, 247, 0.7)', border: '#9333ea', text: '#581c87' },   // Purple
  'A#': { bg: 'rgba(236, 72, 153, 0.7)', border: '#db2777', text: '#831843' },  // Pink
  'Bb': { bg: 'rgba(236, 72, 153, 0.7)', border: '#db2777', text: '#831843' },  // Pink
  'B':  { bg: 'rgba(244, 63, 94, 0.7)',  border: '#e11d48', text: '#881337' },   // Rose
};

function getChordColor(root: string): { bg: string; border: string; text: string } {
  return ROOT_COLORS[root] || ROOT_COLORS['C'];
}

const TRIAD_OPTIONS: { value: TriadQuality; label: string }[] = [
  { value: 'major', label: 'Major' },
  { value: 'minor', label: 'Minor' },
  { value: 'diminished', label: 'Dim' },
  { value: 'augmented', label: 'Aug' },
  { value: 'sus2', label: 'Sus2' },
  { value: 'sus4', label: 'Sus4' },
  { value: 'power', label: 'Power' },
];

const SEVENTH_OPTIONS: { value: SeventhType; label: string }[] = [
  { value: null, label: 'None' },
  { value: 'major7', label: 'Maj7' },
  { value: 'minor7', label: 'Min7' },
  { value: 'dominant7', label: '7' },
  { value: 'diminished7', label: 'Dim7' },
];

const EXTENSION_OPTIONS: { value: ChordExtension; label: string }[] = [
  { value: 'add9', label: 'Add9' },
  { value: 'add11', label: 'Add11' },
  { value: 'add13', label: 'Add13' },
  { value: '9', label: '9' },
  { value: '11', label: '11' },
  { value: '13', label: '13' },
];

const ALTERATION_OPTIONS: { value: ChordAlteration; label: string }[] = [
  { value: 'b5', label: 'b5' },
  { value: '#5', label: '#5' },
  { value: 'b9', label: 'b9' },
  { value: '#9', label: '#9' },
  { value: '#11', label: '#11' },
  { value: 'b13', label: 'b13' },
];

interface ChordEditorProps {
  chord: ChordEvent;
  onSave: (chord: ChordEvent) => void;
  onDelete: () => void;
  onClose: () => void;
  useFlats: boolean;
  isNew?: boolean;
}

function ChordEditorModal({ chord, onSave, onDelete, onClose, useFlats, isNew }: ChordEditorProps) {
  const [editedChord, setEditedChord] = useState<ChordEvent>({ ...chord });
  const rootNotes = useFlats ? ROOT_NOTES_FLAT : ROOT_NOTES;
  const modalRef = useRef<HTMLDivElement>(null);

  // Close on escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Delay to avoid immediate close on the click that opened it
    const timeout = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 100);
    return () => {
      clearTimeout(timeout);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  const toggleExtension = (ext: ChordExtension) => {
    const current = editedChord.extensions || [];
    const newExts = current.includes(ext)
      ? current.filter(e => e !== ext)
      : [...current, ext];
    setEditedChord({ ...editedChord, extensions: newExts.length > 0 ? newExts : undefined });
  };

  const toggleAlteration = (alt: ChordAlteration) => {
    const current = editedChord.alterations || [];
    const newAlts = current.includes(alt)
      ? current.filter(a => a !== alt)
      : [...current, alt];
    setEditedChord({ ...editedChord, alterations: newAlts.length > 0 ? newAlts : undefined });
  };

  const applyPreset = (preset: typeof CHORD_PRESETS[0]) => {
    setEditedChord({
      ...editedChord,
      triad: preset.chord.triad || 'major',
      seventh: preset.chord.seventh,
      extensions: preset.chord.extensions,
      alterations: preset.chord.alterations,
    });
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div
        ref={modalRef}
        className="bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded-lg shadow-xl p-4 min-w-72 max-w-md max-h-[90vh] overflow-y-auto"
      >
        <div className="flex justify-between items-center mb-3">
          <h3 className="font-medium text-zinc-900 dark:text-white">
            {isNew ? 'Add Chord' : 'Edit Chord'}
          </h3>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      {/* Root note */}
      <div className="mb-2">
        <label className="text-xs text-zinc-500 block mb-1">Root</label>
        <div className="flex flex-wrap gap-1">
          {rootNotes.map(note => (
            <button
              key={note}
              onClick={() => setEditedChord({ ...editedChord, root: note })}
              className={`px-2 py-1 text-xs rounded ${
                editedChord.root === note
                  ? 'bg-blue-500 text-white'
                  : 'bg-zinc-100 dark:bg-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-600'
              }`}
            >
              {note}
            </button>
          ))}
        </div>
      </div>

      {/* Presets */}
      <div className="mb-2">
        <label className="text-xs text-zinc-500 block mb-1">Presets</label>
        <select
          onChange={(e) => {
            const preset = CHORD_PRESETS.find(p => p.name === e.target.value);
            if (preset) applyPreset(preset);
          }}
          className="w-full px-2 py-1 text-xs border border-zinc-300 dark:border-zinc-600 rounded bg-white dark:bg-zinc-700"
          defaultValue=""
        >
          <option value="" disabled>Select preset...</option>
          {CHORD_PRESETS.map(p => (
            <option key={p.name} value={p.name}>{p.name}</option>
          ))}
        </select>
      </div>

      {/* Triad quality */}
      <div className="mb-2">
        <label className="text-xs text-zinc-500 block mb-1">Quality</label>
        <div className="flex flex-wrap gap-1">
          {TRIAD_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setEditedChord({ ...editedChord, triad: opt.value })}
              className={`px-2 py-1 text-xs rounded ${
                editedChord.triad === opt.value
                  ? 'bg-blue-500 text-white'
                  : 'bg-zinc-100 dark:bg-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-600'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Seventh */}
      <div className="mb-2">
        <label className="text-xs text-zinc-500 block mb-1">7th</label>
        <div className="flex flex-wrap gap-1">
          {SEVENTH_OPTIONS.map(opt => (
            <button
              key={opt.label}
              onClick={() => setEditedChord({ ...editedChord, seventh: opt.value })}
              className={`px-2 py-1 text-xs rounded ${
                editedChord.seventh === opt.value
                  ? 'bg-blue-500 text-white'
                  : 'bg-zinc-100 dark:bg-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-600'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Extensions */}
      <div className="mb-2">
        <label className="text-xs text-zinc-500 block mb-1">Extensions</label>
        <div className="flex flex-wrap gap-1">
          {EXTENSION_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => toggleExtension(opt.value)}
              className={`px-2 py-1 text-xs rounded ${
                editedChord.extensions?.includes(opt.value)
                  ? 'bg-green-500 text-white'
                  : 'bg-zinc-100 dark:bg-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-600'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Alterations */}
      <div className="mb-2">
        <label className="text-xs text-zinc-500 block mb-1">Alterations</label>
        <div className="flex flex-wrap gap-1">
          {ALTERATION_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => toggleAlteration(opt.value)}
              className={`px-2 py-1 text-xs rounded ${
                editedChord.alterations?.includes(opt.value)
                  ? 'bg-orange-500 text-white'
                  : 'bg-zinc-100 dark:bg-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-600'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Bass note (slash chord) */}
      <div className="mb-2">
        <label className="text-xs text-zinc-500 block mb-1">Bass Note (slash chord)</label>
        <select
          value={editedChord.bassNote || ''}
          onChange={(e) => setEditedChord({
            ...editedChord,
            bassNote: e.target.value || undefined
          })}
          className="w-full px-2 py-1 text-xs border border-zinc-300 dark:border-zinc-600 rounded bg-white dark:bg-zinc-700"
        >
          <option value="">Same as root</option>
          {rootNotes.map(note => (
            <option key={note} value={note}>{note}</option>
          ))}
        </select>
      </div>

      {/* Duration */}
      <div className="mb-3">
        <label className="text-xs text-zinc-500 block mb-1">Duration (beats)</label>
        <input
          type="number"
          min="0.5"
          max="16"
          step="0.5"
          value={editedChord.durationBeats}
          onChange={(e) => setEditedChord({
            ...editedChord,
            durationBeats: parseFloat(e.target.value) || 1
          })}
          className="w-20 px-2 py-1 text-xs border border-zinc-300 dark:border-zinc-600 rounded bg-white dark:bg-zinc-700"
        />
      </div>

      {/* Preview */}
      <div className="mb-3 p-2 bg-zinc-100 dark:bg-zinc-700 rounded text-center">
        <span className="text-lg font-bold">{chordToSymbol(editedChord)}</span>
      </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={() => onSave(editedChord)}
            className="flex-1 px-3 py-2 bg-blue-500 text-white text-sm rounded hover:bg-blue-600"
          >
            {isNew ? 'Add' : 'Save'}
          </button>
          <button
            onClick={onClose}
            className="px-3 py-2 bg-zinc-300 dark:bg-zinc-600 text-sm rounded hover:bg-zinc-400 dark:hover:bg-zinc-500"
          >
            Cancel
          </button>
        </div>

        {/* Delete button - separate row for visibility */}
        {!isNew && (
          <button
            onClick={onDelete}
            className="w-full mt-2 px-3 py-2 bg-red-500 text-white text-sm rounded hover:bg-red-600 flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Delete Chord
          </button>
        )}
      </div>
    </div>,
    document.body
  );
}

export function ChordTrack({
  chords,
  onChordsChange,
  totalBeats,
  beatsPerMeasure,
  keySignature,
  isMinor,
  onSuggestChords,
}: ChordTrackProps) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [addingAtBeat, setAddingAtBeat] = useState<number | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const useFlats = ['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb'].includes(keySignature);
  const numMeasures = Math.ceil(totalBeats / beatsPerMeasure) || 4;
  const displayBeats = numMeasures * beatsPerMeasure;
  const beatWidth = 40; // pixels per beat

  const handleTrackClick = useCallback((e: React.MouseEvent) => {
    if (editingIndex !== null || addingAtBeat !== null) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const clickedBeat = Math.floor(x / beatWidth);

    // Always allow adding a chord at the clicked beat
    // (this will split existing chords via duration recalculation)
    setAddingAtBeat(clickedBeat);
  }, [editingIndex, addingAtBeat, beatWidth]);

  const handleChordDoubleClick = useCallback((e: React.MouseEvent, index: number) => {
    e.stopPropagation();
    setEditingIndex(index);
    setAddingAtBeat(null);
  }, []);

  // Recalculate chord durations so each extends until the next chord (or end)
  const recalculateDurations = useCallback((chordList: ChordEvent[]): ChordEvent[] => {
    if (chordList.length === 0) return chordList;

    const sorted = [...chordList].sort((a, b) => a.startBeat - b.startBeat);

    return sorted.map((chord, index) => {
      // Duration extends until next chord or end of piece
      const nextChordStart = index < sorted.length - 1
        ? sorted[index + 1].startBeat
        : Math.max(totalBeats, chord.startBeat + beatsPerMeasure);

      return {
        ...chord,
        durationBeats: nextChordStart - chord.startBeat,
      };
    });
  }, [totalBeats, beatsPerMeasure]);

  const handleSaveChord = useCallback((index: number, chord: ChordEvent) => {
    const newChords = [...chords];
    newChords[index] = chord;
    // Sort and recalculate durations
    const processed = recalculateDurations(newChords);
    onChordsChange(processed);
    setEditingIndex(null);
  }, [chords, onChordsChange, recalculateDurations]);

  const handleDeleteChord = useCallback((index: number) => {
    const newChords = chords.filter((_, i) => i !== index);
    // Recalculate durations after deletion
    const processed = recalculateDurations(newChords);
    onChordsChange(processed);
    setEditingIndex(null);
  }, [chords, onChordsChange, recalculateDurations]);

  const handleAddChord = useCallback((chord: ChordEvent) => {
    const newChords = [...chords, chord];
    // Sort and recalculate durations
    const processed = recalculateDurations(newChords);
    onChordsChange(processed);
    setAddingAtBeat(null);
  }, [chords, onChordsChange, recalculateDurations]);

  return (
    <div ref={trackRef} className="relative">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Chords</span>
        {onSuggestChords && (
          <button
            onClick={onSuggestChords}
            className="px-2 py-0.5 text-xs bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 rounded hover:bg-purple-200 dark:hover:bg-purple-800"
          >
            Auto-suggest
          </button>
        )}
      </div>

      {/* Track grid */}
      <div
        className="relative h-12 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded overflow-hidden cursor-pointer"
        style={{ width: displayBeats * beatWidth }}
        onClick={handleTrackClick}
      >
        {/* Beat grid lines */}
        {Array.from({ length: displayBeats }).map((_, i) => (
          <div
            key={i}
            className={`absolute top-0 bottom-0 w-px ${
              i % beatsPerMeasure === 0
                ? 'bg-zinc-400 dark:bg-zinc-500'
                : 'bg-zinc-200 dark:bg-zinc-700'
            }`}
            style={{ left: i * beatWidth }}
          />
        ))}

        {/* Chord blocks */}
        {chords.map((chord, index) => {
          const colors = getChordColor(chord.root);
          return (
          <div
            key={index}
            className={`absolute top-1 bottom-1 rounded flex items-center justify-center text-xs font-semibold transition-colors border group ${
              editingIndex === index ? 'ring-2 ring-white/50' : ''
            }`}
            style={{
              left: chord.startBeat * beatWidth + 2,
              width: chord.durationBeats * beatWidth - 4,
              pointerEvents: 'none', // Let clicks pass through to track
              backgroundColor: colors.bg,
              borderColor: colors.border,
              color: colors.text,
            }}
          >
            <span
              className="px-1 rounded cursor-pointer hover:bg-white/30 dark:hover:bg-black/30"
              style={{ pointerEvents: 'auto' }} // Only the label is clickable
              onDoubleClick={(e) => handleChordDoubleClick(e, index)}
              title="Double-click to edit"
            >
              {chordToSymbol(chord)}
            </span>
            {/* Delete button */}
            <button
              className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full text-xs leading-none flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-red-600 transition-opacity"
              style={{ pointerEvents: 'auto' }}
              onClick={(e) => {
                e.stopPropagation();
                handleDeleteChord(index);
              }}
              title="Delete chord"
            >
              ×
            </button>
          </div>
        );
        })}

        {/* Add new chord indicator */}
        {addingAtBeat !== null && (
          <div
            className="absolute top-1 bottom-1 w-8 bg-green-200 dark:bg-green-800 rounded opacity-50"
            style={{ left: addingAtBeat * beatWidth + 2 }}
          />
        )}
      </div>

      {/* Chord editor modal */}
      {editingIndex !== null && chords[editingIndex] && (
        <ChordEditorModal
          chord={chords[editingIndex]}
          onSave={(chord) => handleSaveChord(editingIndex, chord)}
          onDelete={() => handleDeleteChord(editingIndex)}
          onClose={() => setEditingIndex(null)}
          useFlats={useFlats}
        />
      )}

      {/* Add chord modal */}
      {addingAtBeat !== null && (
        <ChordEditorModal
          chord={{
            root: keySignature.replace('b', 'b').replace('#', '#'),
            triad: isMinor ? 'minor' : 'major',
            startBeat: addingAtBeat,
            durationBeats: beatsPerMeasure,
          }}
          onSave={handleAddChord}
          onDelete={() => setAddingAtBeat(null)}
          onClose={() => setAddingAtBeat(null)}
          useFlats={useFlats}
          isNew
        />
      )}

      {/* Empty state / Help text */}
      {addingAtBeat === null && editingIndex === null && (
        <div className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
          {chords.length === 0
            ? 'Click anywhere to add chords'
            : 'Click to add chord • Double-click chord to edit'}
        </div>
      )}
    </div>
  );
}
