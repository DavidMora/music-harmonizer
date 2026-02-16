/**
 * Note Segmenter
 *
 * Combines onset detection, pitch detection, and dynamics analysis
 * to produce a clean array of NoteEvent objects.
 */

import type { NoteEvent } from '@/types/music';
import type { PitchContour } from './pitchDetector';
import type { VelocityInfo } from './dynamicsAnalyzer';
import { getSegmentPitch, detectVibrato } from './pitchDetector';

export interface NoteSegmenterOptions {
  minNoteDuration?: number;   // Minimum note duration in seconds
  minGap?: number;            // Minimum gap between notes
  usePitchChanges?: boolean;  // Use pitch changes as secondary boundaries
}

/**
 * Segment audio into notes using onset times as primary boundaries
 */
export function segmentNotes(
  onsets: number[],
  pitchContour: PitchContour,
  velocities: VelocityInfo[],
  duration: number,
  options: NoteSegmenterOptions = {}
): NoteEvent[] {
  const {
    minNoteDuration = 0.05,   // 50ms minimum
    usePitchChanges = true,
  } = options;

  const notes: NoteEvent[] = [];

  if (onsets.length === 0) {
    return notes;
  }

  // Process each onset-bounded segment
  for (let i = 0; i < onsets.length; i++) {
    const startTime = onsets[i];
    const endTime = i < onsets.length - 1 ? onsets[i + 1] : duration;
    const segmentDuration = endTime - startTime;

    // Skip very short segments
    if (segmentDuration < minNoteDuration) {
      continue;
    }

    // Get pitch for this segment
    const pitchInfo = getSegmentPitch(pitchContour, startTime, endTime);

    if (!pitchInfo || pitchInfo.midi <= 0) {
      // No valid pitch detected, skip this segment
      continue;
    }

    // Get velocity for this segment
    const velocity = velocities[i]?.velocity ?? 80;

    // Detect vibrato
    const hopDuration = pitchContour.hopSize / pitchContour.sampleRate;
    const startFrame = Math.floor(startTime / hopDuration);
    const endFrame = Math.ceil(endTime / hopDuration);
    const vibratoInfo = detectVibrato(pitchContour, startFrame, endFrame);

    // Create note event
    const note: NoteEvent = {
      midi: pitchInfo.midi,
      frequency: pitchInfo.frequency,
      startTime,
      duration: segmentDuration,
      velocity,
      centsDeviation: pitchInfo.centsDeviation,
    };

    // Add vibrato info if detected
    if (vibratoInfo) {
      note.vibratoRate = vibratoInfo.rate;
      note.vibratoDepth = vibratoInfo.depth;
    }

    notes.push(note);
  }

  // Optionally split notes at significant pitch changes
  if (usePitchChanges) {
    return splitAtPitchChanges(notes, pitchContour);
  }

  return notes;
}

/**
 * Split notes at significant pitch changes (more than 1 semitone)
 */
function splitAtPitchChanges(
  notes: NoteEvent[],
  pitchContour: PitchContour
): NoteEvent[] {
  const result: NoteEvent[] = [];
  const hopDuration = pitchContour.hopSize / pitchContour.sampleRate;

  for (const note of notes) {
    const startFrame = Math.floor(note.startTime / hopDuration);
    const endFrame = Math.ceil((note.startTime + note.duration) / hopDuration);

    // Look for pitch changes within this note
    const pitchChangeFrames = findPitchChanges(pitchContour, startFrame, endFrame);

    if (pitchChangeFrames.length === 0) {
      // No pitch changes, keep original note
      result.push(note);
    } else {
      // Split at pitch changes
      let currentStart = note.startTime;

      for (const changeFrame of pitchChangeFrames) {
        const changeTime = changeFrame * hopDuration;

        if (changeTime - currentStart >= 0.05) {
          // Get pitch for this sub-segment
          const pitchInfo = getSegmentPitch(pitchContour, currentStart, changeTime);

          if (pitchInfo && pitchInfo.midi > 0) {
            result.push({
              midi: pitchInfo.midi,
              frequency: pitchInfo.frequency,
              startTime: currentStart,
              duration: changeTime - currentStart,
              velocity: note.velocity,
              centsDeviation: pitchInfo.centsDeviation,
            });
          }
        }

        currentStart = changeTime;
      }

      // Add final segment
      const finalEnd = note.startTime + note.duration;
      if (finalEnd - currentStart >= 0.05) {
        const pitchInfo = getSegmentPitch(pitchContour, currentStart, finalEnd);

        if (pitchInfo && pitchInfo.midi > 0) {
          result.push({
            midi: pitchInfo.midi,
            frequency: pitchInfo.frequency,
            startTime: currentStart,
            duration: finalEnd - currentStart,
            velocity: note.velocity,
            centsDeviation: pitchInfo.centsDeviation,
          });
        }
      }
    }
  }

  return result;
}

/**
 * Find frames where pitch changes by more than 1 semitone
 */
function findPitchChanges(
  contour: PitchContour,
  startFrame: number,
  endFrame: number
): number[] {
  const changes: number[] = [];
  let prevMidi = -1;
  let stableCount = 0;
  const minStableFrames = 3;

  for (let i = startFrame; i < endFrame && i < contour.frames.length; i++) {
    const frame = contour.frames[i];

    if (frame.midi <= 0) {
      continue;
    }

    if (prevMidi === -1) {
      prevMidi = frame.midi;
      stableCount = 1;
      continue;
    }

    const diff = Math.abs(frame.midi - prevMidi);

    if (diff > 1) {
      // Significant pitch change
      if (stableCount >= minStableFrames) {
        changes.push(i);
      }
      prevMidi = frame.midi;
      stableCount = 1;
    } else {
      stableCount++;
    }
  }

  return changes;
}

/**
 * Merge consecutive notes with the same pitch
 */
export function mergeConsecutiveNotes(
  notes: NoteEvent[],
  maxGap: number = 0.05
): NoteEvent[] {
  if (notes.length <= 1) {
    return notes;
  }

  const result: NoteEvent[] = [];
  let current = { ...notes[0] };

  for (let i = 1; i < notes.length; i++) {
    const next = notes[i];
    const gap = next.startTime - (current.startTime + current.duration);

    // Merge if same pitch and small gap
    if (next.midi === current.midi && gap < maxGap) {
      // Extend current note
      current.duration = (next.startTime + next.duration) - current.startTime;
      // Average the velocity
      current.velocity = Math.round((current.velocity + next.velocity) / 2);
    } else {
      result.push(current);
      current = { ...next };
    }
  }

  result.push(current);
  return result;
}

/**
 * Remove leading silence by adjusting all start times
 */
export function normalizeStartTimes(notes: NoteEvent[]): NoteEvent[] {
  if (notes.length === 0) {
    return notes;
  }

  const firstStart = notes[0].startTime;
  if (firstStart <= 0) {
    return notes;
  }

  console.log(`Trimming ${firstStart.toFixed(2)}s of silence`);

  return notes.map(note => ({
    ...note,
    startTime: note.startTime - firstStart,
  }));
}

/**
 * Filter out very short notes (likely noise)
 */
export function filterShortNotes(
  notes: NoteEvent[],
  minDuration: number = 0.05
): NoteEvent[] {
  return notes.filter(note => note.duration >= minDuration);
}
