import type { NoteEvent } from '@/types/music';

export type HarmonyStyle =
  | 'thirds-above'
  | 'thirds-below'
  | 'sixths-above'
  | 'sixths-below'
  | 'power-fifths'
  | 'triads'
  | 'four-part'
  | 'octave-double'
  | 'parallel-thirds-sixths';

export interface HarmonyVoice {
  name: string;
  notes: NoteEvent[];
  color: string;
}

export interface HarmonyResult {
  melody: NoteEvent[];
  voices: HarmonyVoice[];
}

export const HARMONY_STYLES: { value: HarmonyStyle; label: string; description: string }[] = [
  { value: 'thirds-above', label: 'Thirds Above', description: 'Diatonic third above melody (pop/folk)' },
  { value: 'thirds-below', label: 'Thirds Below', description: 'Diatonic third below melody' },
  { value: 'sixths-above', label: 'Sixths Above', description: 'Diatonic sixth above melody' },
  { value: 'sixths-below', label: 'Sixths Below', description: 'Diatonic sixth below melody' },
  { value: 'power-fifths', label: 'Power Fifths', description: 'Perfect fifth above (rock/metal)' },
  { value: 'triads', label: 'Triads', description: 'Third and fifth above (full chords)' },
  { value: 'four-part', label: 'Four-Part SATB', description: 'Academic SATB with counterpoint rules' },
  { value: 'octave-double', label: 'Octave Double', description: 'Octave above and below' },
  { value: 'parallel-thirds-sixths', label: 'Thirds + Sixths', description: 'Third above and sixth below' },
];

// ============================================================================
// COUNTERPOINT RULES AND VOICE RANGES
// Based on academic counterpoint principles
// Sources: Open Music Theory, Species Counterpoint Manual
// ============================================================================

// SATB Voice Ranges (MIDI numbers)
// Soprano: C4 (60) to C6 (84)
// Alto: F3 (53) to F5 (77)
// Tenor: C3 (48) to C5 (72)
// Bass: E2 (40) to E4 (64)
const VOICE_RANGES = {
  soprano: { min: 60, max: 84 },
  alto: { min: 53, max: 77 },
  tenor: { min: 48, max: 72 },
  bass: { min: 40, max: 64 },
};

// Scale degrees for each key (semitones from root)
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10]; // Natural minor

// Key roots (C=0, C#=1, D=2, etc.)
const KEY_ROOTS: Record<string, number> = {
  'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3,
  'E': 4, 'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8,
  'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11
};

// Interval types in semitones
const INTERVALS = {
  unison: 0,
  minorSecond: 1,
  majorSecond: 2,
  minorThird: 3,
  majorThird: 4,
  perfectFourth: 5,
  tritone: 6,
  perfectFifth: 7,
  minorSixth: 8,
  majorSixth: 9,
  minorSeventh: 10,
  majorSeventh: 11,
  octave: 12,
};

/**
 * Get the scale notes for a given key
 */
function getScaleNotes(key: string, isMinor: boolean = false): number[] {
  const root = KEY_ROOTS[key] ?? 0;
  const scale = isMinor ? MINOR_SCALE : MAJOR_SCALE;
  return scale.map(interval => (root + interval) % 12);
}

/**
 * Get the scale degree (0-6) of a MIDI note in a given key
 */
function getScaleDegree(midiNote: number, key: string, isMinor: boolean): number {
  const scaleNotes = getScaleNotes(key, isMinor);
  const noteInOctave = midiNote % 12;

  let scaleDegree = scaleNotes.indexOf(noteInOctave);
  if (scaleDegree === -1) {
    // Note not in scale - find nearest
    let minDist = 12;
    for (let i = 0; i < scaleNotes.length; i++) {
      const dist = Math.min(
        Math.abs(noteInOctave - scaleNotes[i]),
        12 - Math.abs(noteInOctave - scaleNotes[i])
      );
      if (dist < minDist) {
        minDist = dist;
        scaleDegree = i;
      }
    }
  }
  return scaleDegree;
}

/**
 * Get the chord tones for a given scale degree (root, third, fifth)
 */
function getChordTones(scaleDegree: number, key: string, isMinor: boolean): number[] {
  const scaleNotes = getScaleNotes(key, isMinor);
  const root = scaleNotes[scaleDegree];
  const third = scaleNotes[(scaleDegree + 2) % 7];
  const fifth = scaleNotes[(scaleDegree + 4) % 7];
  return [root, third, fifth];
}

/**
 * Check if interval is a perfect consonance (unison, fifth, octave)
 */
function isPerfectConsonance(interval: number): boolean {
  const normalized = Math.abs(interval) % 12;
  return normalized === INTERVALS.unison ||
         normalized === INTERVALS.perfectFifth ||
         normalized === INTERVALS.octave % 12;
}

/**
 * Check for parallel fifths or octaves between two voice pairs
 */
function hasParallelPerfect(
  prevNote1: number, currNote1: number,
  prevNote2: number, currNote2: number
): boolean {
  const prevInterval = Math.abs(prevNote1 - prevNote2) % 12;
  const currInterval = Math.abs(currNote1 - currNote2) % 12;

  // Check if both intervals are perfect fifths or octaves
  const prevIsPerfect = prevInterval === 0 || prevInterval === 7 || prevInterval === 5;
  const currIsPerfect = currInterval === 0 || currInterval === 7 || currInterval === 5;

  if (!prevIsPerfect || !currIsPerfect) return false;
  if (prevInterval !== currInterval) return false;

  // Check if voices move in the same direction (parallel motion)
  const direction1 = Math.sign(currNote1 - prevNote1);
  const direction2 = Math.sign(currNote2 - prevNote2);

  return direction1 === direction2 && direction1 !== 0;
}

/**
 * Check for voice crossing between two voices
 */
function hasVoiceCrossing(
  upperVoice: number,
  lowerVoice: number,
  prevUpperVoice: number | null,
  prevLowerVoice: number | null
): boolean {
  // Direct crossing: upper voice goes below lower voice
  if (upperVoice < lowerVoice) return true;

  // Overlapping: voice moves past the previous position of adjacent voice
  if (prevLowerVoice !== null && upperVoice < prevLowerVoice) return true;
  if (prevUpperVoice !== null && lowerVoice > prevUpperVoice) return true;

  return false;
}

/**
 * Check spacing between voices (upper voices should be within an octave)
 */
function hasProperSpacing(soprano: number, alto: number, tenor: number): boolean {
  const sopranoAltoInterval = soprano - alto;
  const altoTenorInterval = alto - tenor;

  // Adjacent upper voices should not exceed an octave
  return sopranoAltoInterval <= 12 && altoTenorInterval <= 12;
}

/**
 * Constrain a note to a voice range
 */
function constrainToRange(
  midi: number,
  range: { min: number; max: number }
): number {
  while (midi < range.min) midi += 12;
  while (midi > range.max) midi -= 12;
  return midi;
}

/**
 * Find the best harmony note that follows counterpoint rules
 */
function findBestHarmonyNote(
  melodyNote: number,
  targetInterval: number, // in scale degrees
  voiceRange: { min: number; max: number },
  prevMelodyNote: number | null,
  prevHarmonyNote: number | null,
  key: string,
  isMinor: boolean,
  preferContraryMotion: boolean = true
): number {
  const scaleNotes = getScaleNotes(key, isMinor);
  const melodyScaleDegree = getScaleDegree(melodyNote, key, isMinor);
  const melodyOctave = Math.floor(melodyNote / 12);

  // Calculate target scale degree
  const targetDegree = ((melodyScaleDegree + targetInterval) % 7 + 7) % 7;
  const octaveShift = Math.floor((melodyScaleDegree + targetInterval) / 7);

  // Get base target note
  const targetNoteInOctave = scaleNotes[targetDegree];
  let targetMidi = (melodyOctave + octaveShift) * 12 + targetNoteInOctave;

  // Constrain to voice range
  targetMidi = constrainToRange(targetMidi, voiceRange);

  // If we have previous notes, check for counterpoint violations
  if (prevMelodyNote !== null && prevHarmonyNote !== null) {
    const candidates: { note: number; score: number }[] = [];

    // Try the target note and octave transpositions
    for (let octaveOffset = -1; octaveOffset <= 1; octaveOffset++) {
      const candidate = targetMidi + (octaveOffset * 12);
      if (candidate < voiceRange.min || candidate > voiceRange.max) continue;

      let score = 100;

      // Penalize parallel fifths/octaves
      if (hasParallelPerfect(prevMelodyNote, melodyNote, prevHarmonyNote, candidate)) {
        score -= 50;
      }

      // Penalize voice crossing
      if (targetInterval < 0 && candidate > melodyNote) {
        score -= 40; // Voice should be below melody
      }
      if (targetInterval > 0 && candidate < melodyNote) {
        score -= 40; // Voice should be above melody
      }

      // Prefer contrary motion
      if (preferContraryMotion) {
        const melodyDirection = Math.sign(melodyNote - prevMelodyNote);
        const harmonyDirection = Math.sign(candidate - prevHarmonyNote);
        if (melodyDirection !== 0 && harmonyDirection !== 0) {
          if (melodyDirection !== harmonyDirection) {
            score += 20; // Reward contrary motion
          } else {
            score -= 10; // Penalize parallel motion
          }
        }
      }

      // Prefer stepwise motion in harmony voice
      const harmonyMotion = Math.abs(candidate - prevHarmonyNote);
      if (harmonyMotion <= 2) {
        score += 15; // Reward stepwise motion
      } else if (harmonyMotion <= 4) {
        score += 5; // Small leap is ok
      } else if (harmonyMotion > 7) {
        score -= 10; // Penalize large leaps
      }

      // Prefer staying closer to the original target
      if (octaveOffset === 0) {
        score += 10;
      }

      candidates.push({ note: candidate, score });
    }

    // Sort by score and return best candidate
    candidates.sort((a, b) => b.score - a.score);
    if (candidates.length > 0) {
      return candidates[0].note;
    }
  }

  return targetMidi;
}

/**
 * Generate a harmony voice with counterpoint rules
 */
function generateVoiceWithCounterpoint(
  melody: NoteEvent[],
  targetInterval: number,
  voiceRange: { min: number; max: number },
  key: string,
  isMinor: boolean
): NoteEvent[] {
  const result: NoteEvent[] = [];

  for (let i = 0; i < melody.length; i++) {
    const note = melody[i];
    const prevMelody = i > 0 ? melody[i - 1].midi : null;
    const prevHarmony = i > 0 ? result[i - 1].midi : null;

    const harmonyMidi = findBestHarmonyNote(
      note.midi,
      targetInterval,
      voiceRange,
      prevMelody,
      prevHarmony,
      key,
      isMinor
    );

    result.push({
      ...note,
      midi: harmonyMidi,
      frequency: 440 * Math.pow(2, (harmonyMidi - 69) / 12),
    });
  }

  return result;
}

/**
 * Generate SATB four-part harmony with full counterpoint rules
 */
function generateSATBHarmony(
  melody: NoteEvent[],
  key: string,
  isMinor: boolean
): HarmonyVoice[] {
  const alto: NoteEvent[] = [];
  const tenor: NoteEvent[] = [];
  const bass: NoteEvent[] = [];

  for (let i = 0; i < melody.length; i++) {
    const sopranoNote = melody[i].midi;
    const prevSoprano = i > 0 ? melody[i - 1].midi : null;
    const prevAlto = i > 0 ? alto[i - 1].midi : null;
    const prevTenor = i > 0 ? tenor[i - 1].midi : null;
    const prevBass = i > 0 ? bass[i - 1].midi : null;

    // Get the chord tones for this melody note
    const scaleDegree = getScaleDegree(sopranoNote, key, isMinor);
    const chordTones = getChordTones(scaleDegree, key, isMinor);

    // Find best alto note (third below soprano, within alto range)
    let altoNote = findBestHarmonyNote(
      sopranoNote,
      -2, // third below
      VOICE_RANGES.alto,
      prevSoprano,
      prevAlto,
      key,
      isMinor
    );

    // Ensure alto doesn't cross soprano
    if (altoNote > sopranoNote) {
      altoNote = constrainToRange(altoNote - 12, VOICE_RANGES.alto);
    }

    // Find best tenor note (fifth below soprano, within tenor range)
    let tenorNote = findBestHarmonyNote(
      sopranoNote,
      -4, // fifth below
      VOICE_RANGES.tenor,
      prevSoprano,
      prevTenor,
      key,
      isMinor
    );

    // Ensure tenor doesn't cross alto
    if (tenorNote > altoNote) {
      tenorNote = constrainToRange(tenorNote - 12, VOICE_RANGES.tenor);
    }

    // Check spacing between alto and tenor (should be within octave)
    if (altoNote - tenorNote > 12) {
      tenorNote = constrainToRange(tenorNote + 12, VOICE_RANGES.tenor);
    }

    // Find bass note (root of the chord, an octave or more below)
    const root = chordTones[0];
    let bassNote = sopranoNote - 12; // Start an octave below
    // Adjust to be the root of the chord
    while ((bassNote % 12) !== root) {
      bassNote--;
    }
    bassNote = constrainToRange(bassNote, VOICE_RANGES.bass);

    // Ensure bass doesn't cross tenor
    if (bassNote > tenorNote) {
      bassNote = constrainToRange(bassNote - 12, VOICE_RANGES.bass);
    }

    // Check for parallel fifths/octaves and adjust if needed
    if (prevBass !== null && prevTenor !== null) {
      if (hasParallelPerfect(prevTenor, tenorNote, prevBass, bassNote)) {
        // Try moving bass by step
        const alternatives = [bassNote + 1, bassNote - 1, bassNote + 2, bassNote - 2];
        for (const alt of alternatives) {
          if (alt >= VOICE_RANGES.bass.min && alt <= VOICE_RANGES.bass.max) {
            if (!hasParallelPerfect(prevTenor, tenorNote, prevBass, alt)) {
              bassNote = alt;
              break;
            }
          }
        }
      }
    }

    alto.push({
      ...melody[i],
      midi: altoNote,
      frequency: 440 * Math.pow(2, (altoNote - 69) / 12),
    });

    tenor.push({
      ...melody[i],
      midi: tenorNote,
      frequency: 440 * Math.pow(2, (tenorNote - 69) / 12),
    });

    bass.push({
      ...melody[i],
      midi: bassNote,
      frequency: 440 * Math.pow(2, (bassNote - 69) / 12),
    });
  }

  return [
    { name: 'Alto', notes: alto, color: '#10b981' },
    { name: 'Tenor', notes: tenor, color: '#f59e0b' },
    { name: 'Bass', notes: bass, color: '#8b5cf6' },
  ];
}

/**
 * Simple interval-based harmony (for non-SATB styles)
 */
function generateSimpleHarmony(
  melody: NoteEvent[],
  interval: number,
  key: string,
  isMinor: boolean
): NoteEvent[] {
  // For simple styles, use the counterpoint-aware generation
  // but with a wider range
  const range = interval > 0
    ? { min: 48, max: 96 } // above melody
    : { min: 36, max: 84 }; // below melody

  return generateVoiceWithCounterpoint(melody, interval, range, key, isMinor);
}

/**
 * Generate a harmony voice with a fixed chromatic interval
 */
function generateVoiceByChromatic(
  melody: NoteEvent[],
  semitones: number
): NoteEvent[] {
  return melody.map(note => {
    const harmonyMidi = note.midi + semitones;
    return {
      ...note,
      midi: harmonyMidi,
      frequency: 440 * Math.pow(2, (harmonyMidi - 69) / 12),
    };
  });
}

/**
 * Main harmonizer function - generates harmony voices based on style
 */
export function generateHarmony(
  melody: NoteEvent[],
  style: HarmonyStyle,
  key: string = 'C',
  isMinor: boolean = false
): HarmonyResult {
  const voices: HarmonyVoice[] = [];

  switch (style) {
    case 'thirds-above':
      voices.push({
        name: 'Voice 2 - Upper Third',
        notes: generateSimpleHarmony(melody, 2, key, isMinor),
        color: '#10b981',
      });
      break;

    case 'thirds-below':
      voices.push({
        name: 'Voice 2 - Lower Third',
        notes: generateSimpleHarmony(melody, -2, key, isMinor),
        color: '#f59e0b',
      });
      break;

    case 'sixths-above':
      voices.push({
        name: 'Voice 2 - Upper Sixth',
        notes: generateSimpleHarmony(melody, 5, key, isMinor),
        color: '#8b5cf6',
      });
      break;

    case 'sixths-below':
      voices.push({
        name: 'Voice 2 - Lower Sixth',
        notes: generateSimpleHarmony(melody, -5, key, isMinor),
        color: '#ec4899',
      });
      break;

    case 'power-fifths':
      // Power fifths intentionally use parallel motion (rock/metal style)
      voices.push({
        name: 'Voice 2 - Power Fifth',
        notes: generateVoiceByChromatic(melody, 7),
        color: '#ef4444',
      });
      break;

    case 'triads':
      voices.push({
        name: 'Voice 2 - Third',
        notes: generateSimpleHarmony(melody, 2, key, isMinor),
        color: '#10b981',
      });
      voices.push({
        name: 'Voice 3 - Fifth',
        notes: generateSimpleHarmony(melody, 4, key, isMinor),
        color: '#8b5cf6',
      });
      break;

    case 'four-part':
      // Full SATB with counterpoint rules
      voices.push(...generateSATBHarmony(melody, key, isMinor));
      break;

    case 'octave-double':
      voices.push({
        name: 'Voice 2 - Octave Up',
        notes: generateVoiceByChromatic(melody, 12),
        color: '#10b981',
      });
      voices.push({
        name: 'Voice 3 - Octave Down',
        notes: generateVoiceByChromatic(melody, -12),
        color: '#f59e0b',
      });
      break;

    case 'parallel-thirds-sixths':
      voices.push({
        name: 'Voice 2 - Upper Third',
        notes: generateSimpleHarmony(melody, 2, key, isMinor),
        color: '#10b981',
      });
      voices.push({
        name: 'Voice 3 - Lower Sixth',
        notes: generateSimpleHarmony(melody, -5, key, isMinor),
        color: '#f59e0b',
      });
      break;
  }

  return {
    melody,
    voices,
  };
}

/**
 * Combine melody and harmony voices into a single array for playback
 */
export function combineVoicesForPlayback(
  melody: NoteEvent[],
  voices: HarmonyVoice[],
  includeMelody: boolean = true
): NoteEvent[] {
  const allNotes: NoteEvent[] = [];

  if (includeMelody) {
    allNotes.push(...melody);
  }

  for (const voice of voices) {
    allNotes.push(...voice.notes);
  }

  // Sort by start time
  return allNotes.sort((a, b) => a.startTime - b.startTime);
}
