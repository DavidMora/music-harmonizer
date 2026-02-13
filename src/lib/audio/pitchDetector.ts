import { YIN } from 'pitchfinder';
import { frequencyToMidi, isValidMidiNote } from './midiConverter';
import type { NoteEvent, AnalysisResult } from '@/types/music';

interface PitchDetectorOptions {
  sampleRate: number;
  windowSize?: number;
  hopSize?: number;
  minFrequency?: number;
  maxFrequency?: number;
  threshold?: number;
}

// Snap frequency to nearest semitone (aggressive auto-tune)
function snapToSemitone(frequency: number): number {
  // Convert to MIDI, round to nearest integer, convert back to frequency
  const midi = 12 * Math.log2(frequency / 440) + 69;
  const snappedMidi = Math.round(midi);
  return 440 * Math.pow(2, (snappedMidi - 69) / 12);
}

// Get the exact frequency for a MIDI note
function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Correct octave errors by checking spectral content
function correctOctaveError(
  pitch: number,
  samples: Float32Array,
  sampleRate: number
): number {
  // Calculate spectral centroid to estimate actual pitch range
  const fftSize = samples.length;
  const centroid = estimateSpectralCentroid(samples, sampleRate);

  // If detected pitch is much lower than spectral centroid suggests,
  // it's likely an octave error
  if (centroid > 0) {
    const pitchMidi = 12 * Math.log2(pitch / 440) + 69;
    const centroidMidi = 12 * Math.log2(centroid / 440) + 69;

    // If centroid suggests we should be 10+ semitones higher, jump up an octave
    if (centroidMidi - pitchMidi > 10) {
      return pitch * 2; // Jump up one octave
    }
    // If centroid suggests we should be 22+ semitones higher, jump up two octaves
    if (centroidMidi - pitchMidi > 22) {
      return pitch * 4; // Jump up two octaves
    }
  }

  return pitch;
}

// Estimate spectral centroid (center of mass of spectrum)
function estimateSpectralCentroid(samples: Float32Array, sampleRate: number): number {
  const n = samples.length;

  // Simple zero-crossing rate as a proxy for spectral centroid
  // Higher zero-crossing rate = higher frequency content
  let zeroCrossings = 0;
  for (let i = 1; i < n; i++) {
    if ((samples[i] >= 0 && samples[i - 1] < 0) ||
        (samples[i] < 0 && samples[i - 1] >= 0)) {
      zeroCrossings++;
    }
  }

  // Estimate frequency from zero-crossing rate
  const duration = n / sampleRate;
  const estimatedFreq = zeroCrossings / (2 * duration);

  return estimatedFreq;
}

export function detectPitches(
  audioData: Float32Array,
  options: PitchDetectorOptions
): AnalysisResult {
  const {
    sampleRate,
    windowSize = 2048, // Larger window for accurate pitch (prevents octave errors)
    hopSize = 256, // Small hop for good time resolution
    // Vocal range: ~80Hz (bass) to ~1000Hz (soprano high notes)
    minFrequency = 80,
    maxFrequency = 1100,
    // Threshold for pitch detection confidence
    threshold = 0.15,
  } = options;

  const detectPitch = YIN({
    sampleRate,
    threshold,
  });

  const rawPitches: (number | null)[] = [];
  const times: number[] = [];
  const hopDuration = hopSize / sampleRate;

  // Slide window across audio
  for (let i = 0; i + windowSize <= audioData.length; i += hopSize) {
    const window = audioData.slice(i, i + windowSize);

    // Check if window has enough energy (skip quiet/breath sections)
    const energy = getEnergy(window);
    if (energy < 0.002) { // Slightly higher energy threshold
      rawPitches.push(null);
      times.push(i / sampleRate);
      continue;
    }

    let pitch = detectPitch(window);

    if (pitch !== null && pitch >= minFrequency && pitch <= maxFrequency) {
      // Correct potential octave errors
      pitch = correctOctaveError(pitch, window, sampleRate);

      // Verify corrected pitch is still in valid range
      if (pitch >= minFrequency && pitch <= maxFrequency * 2) {
        // AGGRESSIVE AUTO-TUNE: Snap to nearest semitone immediately
        rawPitches.push(snapToSemitone(pitch));
      } else {
        rawPitches.push(null);
      }
    } else {
      rawPitches.push(null);
    }
    times.push(i / sampleRate);
  }

  // Remove isolated pitch detections (likely noise) - reduced for fast notes
  const denoised = removeIsolatedPitches(rawPitches, 2);

  // Lighter median smoothing to preserve fast notes
  const smoothedPitches = medianSmooth(denoised, 7);

  // Convert to MIDI notes (already quantized to semitones)
  const midiNotes = smoothedPitches.map(p => p !== null ? Math.round(frequencyToMidi(p)) : -1);

  // Lighter mode smoothing for fast note detection
  const smoothedMidi = modeSmooth(midiNotes, 9);

  // Apply pitch clustering with smaller segments for fast passages
  const clusteredMidi = clusterPitches(smoothedMidi, times);

  // Segment into notes with faster response
  const notes = segmentNotesForVocals(clusteredMidi, smoothedPitches, times, hopDuration);

  // Merge nearby same-pitch notes (smaller gap for fast notes)
  const mergedNotes = mergeNearbyNotes(notes, 0.08);

  // Remove very short notes (reduced threshold for fast passages)
  // At 120 BPM: sixteenth = 0.125s, at 180 BPM: sixteenth = 0.083s
  const cleanedNotes = mergedNotes.filter(n => n.duration >= 0.05);

  // Final pass: snap all note frequencies to exact semitone frequencies
  const tunedNotes = cleanedNotes.map(note => ({
    ...note,
    frequency: midiToFrequency(note.midi),
  }));

  // Normalize start times
  const normalizedNotes = normalizeStartTimes(tunedNotes);

  console.log(`Detected ${normalizedNotes.length} auto-tuned notes`);

  return {
    notes: normalizedNotes,
    sampleRate,
    duration: normalizedNotes.length > 0
      ? normalizedNotes[normalizedNotes.length - 1].startTime + normalizedNotes[normalizedNotes.length - 1].duration
      : 0,
  };
}

// Remove isolated pitch detections that don't have neighbors
function removeIsolatedPitches(pitches: (number | null)[], minNeighbors: number): (number | null)[] {
  const result: (number | null)[] = [...pitches];

  for (let i = 0; i < pitches.length; i++) {
    if (pitches[i] === null) continue;

    let neighbors = 0;
    const currentMidi = Math.round(frequencyToMidi(pitches[i]!));

    // Count nearby frames with similar pitch
    for (let j = Math.max(0, i - 3); j <= Math.min(pitches.length - 1, i + 3); j++) {
      if (j !== i && pitches[j] !== null) {
        const otherMidi = Math.round(frequencyToMidi(pitches[j]!));
        if (Math.abs(otherMidi - currentMidi) <= 1) {
          neighbors++;
        }
      }
    }

    if (neighbors < minNeighbors) {
      result[i] = null;
    }
  }

  return result;
}

// Cluster pitches to find dominant note in each segment
function clusterPitches(midiNotes: number[], times: number[]): number[] {
  const result = [...midiNotes];
  const segmentSize = 10; // ~0.2 seconds at typical hop size - smaller for fast notes

  for (let start = 0; start < midiNotes.length; start += segmentSize) {
    const end = Math.min(start + segmentSize, midiNotes.length);

    // Count occurrences of each MIDI note in segment
    const counts = new Map<number, number>();
    for (let i = start; i < end; i++) {
      if (midiNotes[i] > 0) {
        counts.set(midiNotes[i], (counts.get(midiNotes[i]) || 0) + 1);
      }
    }

    // Find dominant pitch
    let maxCount = 0;
    let dominantPitch = -1;
    counts.forEach((count, pitch) => {
      if (count > maxCount) {
        maxCount = count;
        dominantPitch = pitch;
      }
    });

    // Replace all similar pitches with dominant (if dominant is strong enough)
    if (dominantPitch > 0 && maxCount >= (end - start) * 0.3) {
      for (let i = start; i < end; i++) {
        if (midiNotes[i] > 0 && Math.abs(midiNotes[i] - dominantPitch) <= 2) {
          result[i] = dominantPitch;
        }
      }
    }
  }

  return result;
}

function getEnergy(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return sum / samples.length;
}

function medianSmooth(pitches: (number | null)[], windowSize: number): (number | null)[] {
  const result: (number | null)[] = [];
  const halfWindow = Math.floor(windowSize / 2);

  for (let i = 0; i < pitches.length; i++) {
    const values: number[] = [];
    for (let j = i - halfWindow; j <= i + halfWindow; j++) {
      if (j >= 0 && j < pitches.length && pitches[j] !== null) {
        values.push(pitches[j]!);
      }
    }

    if (values.length >= windowSize / 2) {
      values.sort((a, b) => a - b);
      result.push(values[Math.floor(values.length / 2)]);
    } else {
      result.push(null);
    }
  }

  return result;
}

function modeSmooth(midiNotes: number[], windowSize: number): number[] {
  const result: number[] = [];
  const halfWindow = Math.floor(windowSize / 2);

  for (let i = 0; i < midiNotes.length; i++) {
    const counts = new Map<number, number>();

    for (let j = i - halfWindow; j <= i + halfWindow; j++) {
      if (j >= 0 && j < midiNotes.length && midiNotes[j] >= 0) {
        counts.set(midiNotes[j], (counts.get(midiNotes[j]) || 0) + 1);
      }
    }

    if (counts.size > 0) {
      let maxCount = 0;
      let modeNote = -1;
      counts.forEach((count, note) => {
        if (count > maxCount) {
          maxCount = count;
          modeNote = note;
        }
      });
      result.push(modeNote);
    } else {
      result.push(-1);
    }
  }

  return result;
}

// Vocal-optimized segmentation: tolerant of small pitch variations
function segmentNotesForVocals(
  midiNotes: number[],
  pitches: (number | null)[],
  times: number[],
  hopDuration: number
): NoteEvent[] {
  const notes: NoteEvent[] = [];
  const minStableFrames = 2; // Reduced for fast note detection
  const pitchTolerance = 1; // Allow 1 semitone drift within a note (for vibrato)

  let currentMidi = -1;
  let currentStart = 0;
  let currentFrequencies: number[] = [];

  let candidateMidi = -1;
  let candidateCount = 0;

  for (let i = 0; i < midiNotes.length; i++) {
    const midi = midiNotes[i];

    if (midi > 0 && isValidMidiNote(midi)) {
      // Check if this is "same" note (within tolerance)
      const isSameNote = currentMidi > 0 && Math.abs(midi - currentMidi) <= pitchTolerance;

      if (currentMidi === -1) {
        // No current note - build up candidate
        if (midi === candidateMidi || (candidateMidi > 0 && Math.abs(midi - candidateMidi) <= pitchTolerance)) {
          candidateCount++;
          if (candidateCount >= minStableFrames) {
            currentMidi = candidateMidi;
            currentStart = Math.max(0, i - minStableFrames + 1);
            currentFrequencies = [];
            for (let j = currentStart; j <= i; j++) {
              if (j < pitches.length && pitches[j] !== null) {
                currentFrequencies.push(pitches[j]!);
              }
            }
            candidateMidi = -1;
            candidateCount = 0;
          }
        } else {
          candidateMidi = midi;
          candidateCount = 1;
        }
      } else if (isSameNote) {
        // Continue current note
        if (pitches[i] !== null) {
          currentFrequencies.push(pitches[i]!);
        }
        candidateMidi = -1;
        candidateCount = 0;
      } else {
        // Different note - check stability
        if (candidateMidi > 0 && (midi === candidateMidi || Math.abs(midi - candidateMidi) <= pitchTolerance)) {
          candidateCount++;
          if (candidateCount >= minStableFrames) {
            // Save current note
            const endIndex = Math.max(currentStart + 1, i - minStableFrames);
            if (endIndex < times.length && currentFrequencies.length > 0) {
              const duration = times[endIndex] - times[currentStart];
              if (duration > 0) {
                notes.push({
                  midi: currentMidi,
                  frequency: getMedian(currentFrequencies),
                  startTime: times[currentStart],
                  duration,
                  velocity: 80,
                });
              }
            }
            // Start new note
            currentMidi = candidateMidi;
            currentStart = Math.max(0, i - minStableFrames + 1);
            currentFrequencies = [];
            for (let j = currentStart; j <= i; j++) {
              if (j < pitches.length && pitches[j] !== null) {
                currentFrequencies.push(pitches[j]!);
              }
            }
            candidateMidi = -1;
            candidateCount = 0;
          }
        } else {
          // Keep current note, new candidate
          if (pitches[i] !== null) {
            currentFrequencies.push(pitches[i]!);
          }
          candidateMidi = midi;
          candidateCount = 1;
        }
      }
    } else {
      // Silence
      if (currentMidi > 0) {
        candidateCount++;
        if (candidateCount >= minStableFrames) {
          // End current note
          const endIndex = Math.max(currentStart + 1, i - minStableFrames);
          if (endIndex < times.length && currentFrequencies.length > 0) {
            const duration = times[endIndex] - times[currentStart];
            if (duration > 0) {
              notes.push({
                midi: currentMidi,
                frequency: getMedian(currentFrequencies),
                startTime: times[currentStart],
                duration,
                velocity: 80,
              });
            }
          }
          currentMidi = -1;
          currentFrequencies = [];
        }
      }
      candidateMidi = -1;
    }
  }

  // Handle last note
  if (currentMidi > 0 && currentFrequencies.length > 0) {
    const lastTime = times[times.length - 1] + hopDuration;
    const duration = lastTime - times[currentStart];
    if (duration > 0) {
      notes.push({
        midi: currentMidi,
        frequency: getMedian(currentFrequencies),
        startTime: times[currentStart],
        duration,
        velocity: 80,
      });
    }
  }

  return notes;
}

function getMedian(arr: number[]): number {
  if (arr.length === 0) return 440;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function mergeNearbyNotes(notes: NoteEvent[], maxGap: number): NoteEvent[] {
  if (notes.length <= 1) return notes;

  const merged: NoteEvent[] = [];
  let current = { ...notes[0] };

  for (let i = 1; i < notes.length; i++) {
    const next = notes[i];
    const gap = next.startTime - (current.startTime + current.duration);

    // Merge same notes or notes within 1 semitone (handle pitch drift)
    if (Math.abs(next.midi - current.midi) <= 1 && gap < maxGap) {
      current.duration = (next.startTime + next.duration) - current.startTime;
    } else {
      merged.push(current);
      current = { ...next };
    }
  }
  merged.push(current);

  return merged;
}

function normalizeStartTimes(notes: NoteEvent[]): NoteEvent[] {
  if (notes.length === 0) return notes;

  const firstStart = notes[0].startTime;
  if (firstStart === 0) return notes;

  console.log(`Trimming ${firstStart.toFixed(2)}s of silence`);

  return notes.map(note => ({
    ...note,
    startTime: note.startTime - firstStart,
  }));
}
