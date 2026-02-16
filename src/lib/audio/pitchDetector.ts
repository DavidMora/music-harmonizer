/**
 * Pitch Detection using McLeod Pitch Method (MPM)
 *
 * Optimized for vocal pitch detection with:
 * - No aggressive auto-tuning (preserves expression)
 * - Confidence-based filtering
 * - Expression data (cents deviation, vibrato)
 */

import { PitchDetector as Pitchy } from 'pitchy';
import { frequencyToMidi, isValidMidiNote } from './midiConverter';

export interface PitchDetectorOptions {
  sampleRate: number;
  windowSize?: number;
  hopSize?: number;
  minFrequency?: number;
  maxFrequency?: number;
  clarityThreshold?: number;  // Minimum clarity for valid pitch (0-1)
}

export interface PitchFrame {
  time: number;
  frequency: number | null;
  clarity: number;
  midi: number;
  centsDeviation: number;    // Deviation from nearest semitone
}

export interface PitchContour {
  frames: PitchFrame[];
  sampleRate: number;
  hopSize: number;
}

/**
 * Detect pitch contour from audio using McLeod Pitch Method
 * Returns raw pitch data with confidence, without auto-tuning
 */
export function detectPitchContour(
  audioData: Float32Array,
  options: PitchDetectorOptions
): PitchContour {
  const {
    sampleRate,
    windowSize = 2048,
    hopSize = 512,
    minFrequency = 80,      // Low bass
    maxFrequency = 1100,    // High soprano
    clarityThreshold = 0.5, // Lower threshold - pitchy clarity is often lower
  } = options;

  const detector = Pitchy.forFloat32Array(windowSize);
  const frames: PitchFrame[] = [];

  // Process audio in overlapping windows
  for (let i = 0; i + windowSize <= audioData.length; i += hopSize) {
    const window = audioData.slice(i, i + windowSize);
    const time = i / sampleRate;

    // Check if window has enough energy
    const energy = calculateEnergy(window);
    if (energy < 0.002) {
      frames.push({
        time,
        frequency: null,
        clarity: 0,
        midi: -1,
        centsDeviation: 0,
      });
      continue;
    }

    // Detect pitch using MPM
    const [frequency, clarity] = detector.findPitch(window, sampleRate);

    // Validate pitch
    if (
      frequency >= minFrequency &&
      frequency <= maxFrequency &&
      clarity >= clarityThreshold
    ) {
      const midi = frequencyToMidi(frequency);
      const roundedMidi = Math.round(midi);
      const centsDeviation = (midi - roundedMidi) * 100;

      frames.push({
        time,
        frequency,
        clarity,
        midi: roundedMidi,
        centsDeviation,
      });
    } else {
      frames.push({
        time,
        frequency: null,
        clarity,
        midi: -1,
        centsDeviation: 0,
      });
    }
  }

  // Apply post-processing to remove isolated detections and octave errors
  const processedFrames = postProcessFrames(frames);

  return { frames: processedFrames, sampleRate, hopSize };
}

/**
 * Post-process pitch frames to fix common issues
 */
function postProcessFrames(frames: PitchFrame[]): PitchFrame[] {
  const result = [...frames];

  // Pass 1: Remove isolated pitch detections (likely noise)
  for (let i = 0; i < result.length; i++) {
    if (result[i].frequency === null) continue;

    let neighbors = 0;
    const currentMidi = result[i].midi;

    // Count nearby frames with similar pitch (within 2 semitones)
    for (let j = Math.max(0, i - 3); j <= Math.min(result.length - 1, i + 3); j++) {
      if (j !== i && result[j].frequency !== null) {
        if (Math.abs(result[j].midi - currentMidi) <= 2) {
          neighbors++;
        }
      }
    }

    // Need at least 2 neighbors
    if (neighbors < 2) {
      result[i] = { ...result[i], frequency: null, midi: -1, centsDeviation: 0 };
    }
  }

  // Pass 2: Fix octave errors by looking at local context
  for (let i = 0; i < result.length; i++) {
    if (result[i].frequency === null) continue;

    // Collect nearby valid pitches
    const nearbyMidi: number[] = [];
    for (let j = Math.max(0, i - 5); j <= Math.min(result.length - 1, i + 5); j++) {
      if (j !== i && result[j].frequency !== null) {
        nearbyMidi.push(result[j].midi);
      }
    }

    if (nearbyMidi.length >= 3) {
      // Calculate median of neighbors
      nearbyMidi.sort((a, b) => a - b);
      const medianMidi = nearbyMidi[Math.floor(nearbyMidi.length / 2)];

      // Check if current pitch is an octave off
      const diff = result[i].midi - medianMidi;
      if (Math.abs(diff - 12) <= 2) {
        // Likely an octave too high
        const newMidi = result[i].midi - 12;
        const newFreq = result[i].frequency! / 2;
        result[i] = { ...result[i], midi: newMidi, frequency: newFreq };
      } else if (Math.abs(diff + 12) <= 2) {
        // Likely an octave too low
        const newMidi = result[i].midi + 12;
        const newFreq = result[i].frequency! * 2;
        result[i] = { ...result[i], midi: newMidi, frequency: newFreq };
      }
    }
  }

  return result;
}

/**
 * Calculate RMS energy of a window
 */
function calculateEnergy(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}

/**
 * Smooth pitch contour to reduce noise while preserving expression
 */
export function smoothPitchContour(contour: PitchContour, windowSize: number = 5): PitchContour {
  const frames = [...contour.frames];
  const halfWindow = Math.floor(windowSize / 2);

  for (let i = 0; i < frames.length; i++) {
    if (frames[i].frequency === null) continue;

    // Collect nearby valid pitches
    const nearbyPitches: number[] = [];
    const nearbyCents: number[] = [];

    for (let j = i - halfWindow; j <= i + halfWindow; j++) {
      if (j >= 0 && j < frames.length && frames[j].frequency !== null) {
        // Only include if within 2 semitones (avoid smoothing across notes)
        if (Math.abs(frames[j].midi - frames[i].midi) <= 2) {
          nearbyPitches.push(frames[j].frequency!);
          nearbyCents.push(frames[j].centsDeviation);
        }
      }
    }

    if (nearbyPitches.length >= 3) {
      // Use median for robust smoothing
      nearbyPitches.sort((a, b) => a - b);
      nearbyCents.sort((a, b) => a - b);

      const medianIdx = Math.floor(nearbyPitches.length / 2);
      frames[i] = {
        ...frames[i],
        frequency: nearbyPitches[medianIdx],
        centsDeviation: nearbyCents[medianIdx],
      };
    }
  }

  return { ...contour, frames };
}

/**
 * Detect vibrato in pitch contour
 */
export function detectVibrato(
  contour: PitchContour,
  startFrame: number,
  endFrame: number
): { rate: number; depth: number } | null {
  const frames = contour.frames.slice(startFrame, endFrame);
  const validFrames = frames.filter(f => f.frequency !== null);

  if (validFrames.length < 10) {
    return null;
  }

  // Get cents deviations
  const cents = validFrames.map(f => f.centsDeviation);

  // Calculate mean and remove DC offset
  const mean = cents.reduce((a, b) => a + b, 0) / cents.length;
  const centered = cents.map(c => c - mean);

  // Find zero crossings to estimate rate
  let zeroCrossings = 0;
  for (let i = 1; i < centered.length; i++) {
    if ((centered[i] >= 0 && centered[i - 1] < 0) ||
        (centered[i] < 0 && centered[i - 1] >= 0)) {
      zeroCrossings++;
    }
  }

  // Calculate vibrato rate (Hz)
  const duration = validFrames.length * (contour.hopSize / contour.sampleRate);
  const rate = zeroCrossings / (2 * duration);

  // Typical vibrato is 4-8 Hz
  if (rate < 3 || rate > 12) {
    return null;
  }

  // Calculate depth (max deviation)
  const depth = Math.max(...centered.map(Math.abs));

  // Vibrato should have at least 10 cents deviation
  if (depth < 10) {
    return null;
  }

  return { rate, depth };
}

/**
 * Get the dominant pitch for a segment of the contour
 */
export function getSegmentPitch(
  contour: PitchContour,
  startTime: number,
  endTime: number
): { midi: number; frequency: number; centsDeviation: number; confidence: number } | null {
  const hopDuration = contour.hopSize / contour.sampleRate;
  const startFrame = Math.floor(startTime / hopDuration);
  const endFrame = Math.ceil(endTime / hopDuration);

  const validFrames = contour.frames
    .slice(startFrame, endFrame)
    .filter(f => f.frequency !== null && f.midi > 0);

  if (validFrames.length === 0) {
    return null;
  }

  // Count occurrences of each MIDI note
  const midiCounts = new Map<number, number>();
  for (const frame of validFrames) {
    midiCounts.set(frame.midi, (midiCounts.get(frame.midi) || 0) + 1);
  }

  // Find dominant pitch
  let dominantMidi = -1;
  let maxCount = 0;
  midiCounts.forEach((count, midi) => {
    if (count > maxCount) {
      maxCount = count;
      dominantMidi = midi;
    }
  });

  // Calculate average frequency and cents for dominant pitch
  const dominantFrames = validFrames.filter(f => f.midi === dominantMidi);
  const avgFrequency = dominantFrames.reduce((sum, f) => sum + f.frequency!, 0) / dominantFrames.length;
  const avgCents = dominantFrames.reduce((sum, f) => sum + f.centsDeviation, 0) / dominantFrames.length;
  const avgClarity = dominantFrames.reduce((sum, f) => sum + f.clarity, 0) / dominantFrames.length;

  // Confidence based on consistency
  const confidence = maxCount / validFrames.length;

  return {
    midi: dominantMidi,
    frequency: avgFrequency,
    centsDeviation: avgCents,
    confidence: confidence * avgClarity,
  };
}

// Re-export for backwards compatibility (used by existing code during transition)
export { frequencyToMidi, isValidMidiNote } from './midiConverter';
