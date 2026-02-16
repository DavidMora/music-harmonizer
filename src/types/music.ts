export interface NoteEvent {
  midi: number;
  frequency: number;
  startTime: number;
  duration: number;
  velocity: number;           // Dynamic (1-127)
  centsDeviation?: number;    // Pitch deviation from equal temperament
  vibratoRate?: number;       // Detected vibrato speed (Hz)
  vibratoDepth?: number;      // Detected vibrato amount (cents)
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
  detectedTempo: number;      // Detected BPM
  tempoConfidence: number;    // 0-1 confidence
  onsets: number[];           // Onset times in seconds
}

export interface PlaybackState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  currentNoteIndex: number;
}

// Chord types - flexible system supporting alterations and extensions

// Base triad quality
export type TriadQuality = 'major' | 'minor' | 'diminished' | 'augmented' | 'sus2' | 'sus4' | 'power';

// Seventh type
export type SeventhType = 'major7' | 'minor7' | 'dominant7' | 'diminished7' | null;

// Extensions and alterations
export type ChordExtension = 'add9' | 'add11' | 'add13' | '9' | '11' | '13';
export type ChordAlteration = 'b5' | '#5' | 'b9' | '#9' | '#11' | 'b13';

export interface ChordEvent {
  root: string;                    // Root note (C, D, E, F, G, A, B)
  triad: TriadQuality;             // Base triad quality
  seventh?: SeventhType;           // Optional seventh
  extensions?: ChordExtension[];   // Added extensions (9, 11, 13)
  alterations?: ChordAlteration[]; // Alterations (b5, #9, etc.)
  startBeat: number;               // Start position in beats
  durationBeats: number;           // Duration in beats
  inversion?: number;              // 0 = root, 1 = first, 2 = second, 3 = third
  bassNote?: string;               // Slash chord bass (e.g., C/G -> bassNote: 'G')
}

export interface ChordDefinition {
  name: string;              // Display name (e.g., "Major", "Minor 7th")
  symbol: string;            // Short symbol (e.g., "", "m", "7", "m7")
  intervals: number[];       // Semitone intervals from root
}

// Helper to generate chord symbol string
export function chordToSymbol(chord: ChordEvent): string {
  let symbol = chord.root;

  // Triad quality
  switch (chord.triad) {
    case 'minor': symbol += 'm'; break;
    case 'diminished': symbol += 'dim'; break;
    case 'augmented': symbol += 'aug'; break;
    case 'sus2': symbol += 'sus2'; break;
    case 'sus4': symbol += 'sus4'; break;
    case 'power': symbol += '5'; break;
  }

  // Seventh
  if (chord.seventh) {
    switch (chord.seventh) {
      case 'major7': symbol += 'maj7'; break;
      case 'minor7': symbol += '7'; break; // For minor chords, just add 7
      case 'dominant7': symbol += '7'; break;
      case 'diminished7': symbol += 'dim7'; break;
    }
  }

  // Extensions
  if (chord.extensions) {
    for (const ext of chord.extensions) {
      if (ext.startsWith('add')) {
        symbol += `(${ext})`;
      } else {
        symbol += ext;
      }
    }
  }

  // Alterations
  if (chord.alterations && chord.alterations.length > 0) {
    symbol += `(${chord.alterations.join(',')})`;
  }

  // Bass note
  if (chord.bassNote) {
    symbol += `/${chord.bassNote}`;
  }

  return symbol;
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
