import type { NoteEvent, QuantizedNote, NoteDuration } from '@/types/music';
import { midiToNoteName } from '@/types/music';

export interface QuantizerOptions {
  tempo: number; // BPM
  minQuantization?: NoteDuration; // Minimum note duration
  keySignature?: string; // Key signature for note spelling
}

// Duration values in beats (including dotted notes)
const DURATION_VALUES: Record<NoteDuration, number> = {
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

// Order from longest to shortest
const DURATION_ORDER: NoteDuration[] = [
  'whole-dotted', 'whole', 'half-dotted', 'half',
  'quarter-dotted', 'quarter', 'eighth-dotted', 'eighth', 'sixteenth'
];

// Map base duration to its minimum quantization level
const MIN_QUANT_INDEX: Record<string, number> = {
  'whole': 1,      // whole and whole-dotted
  'half': 3,       // half and half-dotted
  'quarter': 5,    // quarter and quarter-dotted
  'eighth': 7,     // eighth and eighth-dotted
  'sixteenth': 8,  // sixteenth only
};

export function quantizeNotes(
  notes: NoteEvent[],
  options: QuantizerOptions
): QuantizedNote[] {
  const { tempo, minQuantization = 'sixteenth', keySignature } = options;
  const secondsPerBeat = 60 / tempo;

  // Determine minimum quantization level index
  const minQuantBase = minQuantization.replace('-dotted', '') as string;
  const minIndex = MIN_QUANT_INDEX[minQuantBase] ?? 8;

  // Get allowed durations (all durations up to and including min quantization)
  const allowedDurations = DURATION_ORDER.slice(0, minIndex + 1);

  return notes.map((note) => {
    // Convert time to beats
    const startBeat = note.startTime / secondsPerBeat;
    const durationBeats = note.duration / secondsPerBeat;

    // Quantize start time to nearest grid position based on min quantization
    const gridSize = DURATION_VALUES[minQuantization.replace('-dotted', '') as NoteDuration] || 0.25;
    const quantizedStartBeat = Math.round(startBeat / gridSize) * gridSize;

    // Find best matching duration
    const quantizedDuration = findBestDuration(durationBeats, allowedDurations);

    return {
      midi: note.midi,
      noteName: midiToNoteName(note.midi, keySignature),
      duration: quantizedDuration.name,
      durationBeats: quantizedDuration.beats,
      startBeat: quantizedStartBeat,
    };
  });
}

function findBestDuration(
  beats: number,
  allowedDurations: NoteDuration[]
): { name: NoteDuration; beats: number } {
  // Handle very short notes
  if (beats < 0.2) {
    const smallest = allowedDurations[allowedDurations.length - 1];
    return { name: smallest, beats: DURATION_VALUES[smallest] };
  }

  // Handle very long notes (longer than whole-dotted)
  if (beats > 6.5) {
    return { name: 'whole-dotted', beats: 6 };
  }

  // Find the duration that best matches the actual beat length
  // Prefer slightly longer notes over shorter ones (sounds more musical)
  let bestMatch: { name: NoteDuration; beats: number } | null = null;
  let bestScore = Infinity;

  for (const durName of allowedDurations) {
    const durBeats = DURATION_VALUES[durName];

    // Calculate how well this duration matches
    const ratio = beats / durBeats;
    const score = Math.abs(1 - ratio);

    // Prefer durations that are close to the actual length
    // Slight preference for longer durations (penalty for too short)
    const adjustedScore = ratio < 0.7 ? score + 0.3 : score;

    if (adjustedScore < bestScore) {
      bestScore = adjustedScore;
      bestMatch = { name: durName, beats: durBeats };
    }
  }

  // Default fallback
  if (!bestMatch) {
    return { name: 'quarter', beats: 1 };
  }

  return bestMatch;
}

// Group notes into measures
export function groupIntoMeasures(
  notes: QuantizedNote[],
  beatsPerMeasure: number = 4
): QuantizedNote[][] {
  if (notes.length === 0) return [];

  const measures: QuantizedNote[][] = [];
  let currentMeasure: QuantizedNote[] = [];
  let currentMeasureStart = 0;

  for (const note of notes) {
    const measureIndex = Math.floor(note.startBeat / beatsPerMeasure);
    const expectedMeasureStart = measureIndex * beatsPerMeasure;

    // Fill in empty measures if needed
    while (expectedMeasureStart > currentMeasureStart) {
      if (currentMeasure.length > 0) {
        measures.push(currentMeasure);
      }
      currentMeasure = [];
      currentMeasureStart += beatsPerMeasure;
    }

    currentMeasure.push({
      ...note,
      startBeat: note.startBeat - currentMeasureStart,
    });
  }

  if (currentMeasure.length > 0) {
    measures.push(currentMeasure);
  }

  return measures;
}
