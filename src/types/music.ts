export interface NoteEvent {
  midi: number;
  frequency: number;
  startTime: number;
  duration: number;
  velocity: number;
}

export interface QuantizedNote {
  midi: number;
  noteName: string;
  duration: NoteDuration;
  durationBeats: number;
  startBeat: number;
}

export type NoteDuration =
  | 'whole' | 'half' | 'quarter' | 'eighth' | 'sixteenth'
  | 'whole-dotted' | 'half-dotted' | 'quarter-dotted' | 'eighth-dotted';

export interface AnalysisResult {
  notes: NoteEvent[];
  sampleRate: number;
  duration: number;
}

export interface PlaybackState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  currentNoteIndex: number;
}

export const NOTE_NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
export const NOTE_NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const;

// For backwards compatibility
export const NOTE_NAMES = NOTE_NAMES_SHARP;

// Keys that use flats
const FLAT_KEYS = ['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb'];

export function midiToNoteName(midi: number, keySignature?: string): string {
  const octave = Math.floor(midi / 12) - 1;
  const noteIndex = midi % 12;

  // Use flats for flat keys, sharps for sharp keys
  const useFlats = keySignature && FLAT_KEYS.includes(keySignature);
  const noteNames = useFlats ? NOTE_NAMES_FLAT : NOTE_NAMES_SHARP;

  return `${noteNames[noteIndex]}${octave}`;
}
