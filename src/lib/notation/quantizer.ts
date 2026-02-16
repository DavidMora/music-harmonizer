import type { NoteEvent, QuantizedNote, NoteDuration } from '@/types/music';
import { midiToNoteName } from '@/types/music';

export interface QuantizerOptions {
  tempo?: number;              // BPM (uses detected tempo if not provided)
  detectedTempo?: number;      // Auto-detected tempo from analysis
  tempoConfidence?: number;    // Confidence of detected tempo (0-1)
  onsets?: number[];           // Onset times for alignment
  minQuantization?: NoteDuration; // Minimum note duration
  keySignature?: string;       // Key signature for note spelling
  preserveVelocity?: boolean;  // Preserve velocity in output
}

export interface QuantizedNoteWithVelocity extends QuantizedNote {
  velocity?: number;
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

/**
 * Quantize notes to musical notation values
 * Now supports automatic tempo detection and onset-aligned boundaries
 */
export function quantizeNotes(
  notes: NoteEvent[],
  options: QuantizerOptions
): QuantizedNoteWithVelocity[] {
  const {
    tempo,
    detectedTempo,
    tempoConfidence = 0,
    onsets,
    minQuantization = 'sixteenth',
    keySignature,
    preserveVelocity = true,
  } = options;

  // Use detected tempo if available and confident, otherwise use provided tempo or default
  const effectiveTempo = selectTempo(tempo, detectedTempo, tempoConfidence);
  const secondsPerBeat = 60 / effectiveTempo;

  console.log(`Quantizing with tempo: ${effectiveTempo} BPM`);

  // Determine minimum quantization level index
  const minQuantBase = minQuantization.replace('-dotted', '') as string;
  const minIndex = MIN_QUANT_INDEX[minQuantBase] ?? 8;

  // Get allowed durations (all durations up to and including min quantization)
  const allowedDurations = DURATION_ORDER.slice(0, minIndex + 1);

  // Build onset lookup for alignment
  const onsetSet = new Set(onsets?.map(o => Math.round(o * 1000)) ?? []);

  return notes.map((note) => {
    // Convert time to beats
    let startBeat = note.startTime / secondsPerBeat;
    const durationBeats = note.duration / secondsPerBeat;

    // If onsets provided, try to align to onset-detected boundaries
    if (onsets && onsets.length > 0) {
      const alignedStart = alignToOnset(note.startTime, onsets, 0.05);
      if (alignedStart !== null) {
        startBeat = alignedStart / secondsPerBeat;
      }
    }

    // Quantize start time to nearest grid position based on min quantization
    const gridSize = DURATION_VALUES[minQuantization.replace('-dotted', '') as NoteDuration] || 0.25;
    const quantizedStartBeat = Math.round(startBeat / gridSize) * gridSize;

    // Find best matching duration
    const quantizedDuration = findBestDuration(durationBeats, allowedDurations);

    const result: QuantizedNoteWithVelocity = {
      midi: note.midi,
      noteName: midiToNoteName(note.midi, keySignature),
      duration: quantizedDuration.name,
      durationBeats: quantizedDuration.beats,
      startBeat: quantizedStartBeat,
    };

    // Preserve velocity if requested
    if (preserveVelocity && note.velocity !== undefined) {
      result.velocity = note.velocity;
    }

    return result;
  });
}

/**
 * Select the best tempo to use
 */
function selectTempo(
  providedTempo: number | undefined,
  detectedTempo: number | undefined,
  confidence: number
): number {
  // If user provided a specific tempo, use it
  if (providedTempo !== undefined && providedTempo > 0) {
    return providedTempo;
  }

  // If detected tempo has good confidence, use it
  if (detectedTempo !== undefined && detectedTempo > 0 && confidence >= 0.3) {
    return detectedTempo;
  }

  // Fallback to default
  return 120;
}

/**
 * Align a time to the nearest onset within tolerance
 */
function alignToOnset(
  time: number,
  onsets: number[],
  tolerance: number
): number | null {
  let closest: number | null = null;
  let minDist = tolerance;

  for (const onset of onsets) {
    const dist = Math.abs(onset - time);
    if (dist < minDist) {
      minDist = dist;
      closest = onset;
    }
  }

  return closest;
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

/**
 * Estimate tempo from note durations
 * Fallback when onset-based tempo detection isn't available
 */
export function estimateTempoFromNotes(notes: NoteEvent[]): number {
  if (notes.length < 2) {
    return 120;
  }

  // Calculate inter-note intervals
  const intervals: number[] = [];
  for (let i = 1; i < notes.length; i++) {
    const interval = notes[i].startTime - notes[i - 1].startTime;
    if (interval > 0.1 && interval < 2.0) {
      intervals.push(interval);
    }
  }

  if (intervals.length === 0) {
    return 120;
  }

  // Find median interval
  intervals.sort((a, b) => a - b);
  const medianInterval = intervals[Math.floor(intervals.length / 2)];

  // Assume median interval is a beat
  const bpm = 60 / medianInterval;

  // Normalize to reasonable range (60-180 BPM)
  if (bpm < 60) {
    return Math.round(bpm * 2);
  } else if (bpm > 180) {
    return Math.round(bpm / 2);
  }

  return Math.round(bpm);
}
