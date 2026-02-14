import type { NoteEvent } from '@/types/music';
import type { HarmonyVoice } from '@/lib/harmony/harmonizer';

interface MidiTrack {
  name: string;
  notes: NoteEvent[];
  channel: number;
  program: number; // MIDI program/instrument number
}

/**
 * Generate a MIDI file from note events (single track)
 * Returns a Blob that can be downloaded
 */
export function generateMidiFile(notes: NoteEvent[], tempo: number = 120): Blob {
  return generateMultiTrackMidiFile(
    [{ name: 'Melody', notes, channel: 0, program: 0 }],
    tempo
  );
}

/**
 * Generate a multi-track MIDI file from melody and harmony voices
 */
export function generateMultiTrackMidiFile(
  tracks: MidiTrack[],
  tempo: number = 120
): Blob {
  const ticksPerBeat = 480;
  const microsecondsPerBeat = Math.round(60000000 / tempo);

  // Build all track data
  const trackDataArray: number[][] = [];

  // First track: tempo and time signature (conductor track for format 1)
  const conductorTrack: number[] = [];

  // Tempo meta event
  conductorTrack.push(0x00); // Delta time
  conductorTrack.push(0xFF, 0x51, 0x03);
  conductorTrack.push((microsecondsPerBeat >> 16) & 0xFF);
  conductorTrack.push((microsecondsPerBeat >> 8) & 0xFF);
  conductorTrack.push(microsecondsPerBeat & 0xFF);

  // Time signature meta event
  conductorTrack.push(0x00);
  conductorTrack.push(0xFF, 0x58, 0x04);
  conductorTrack.push(0x04, 0x02, 0x18, 0x08);

  // End of track
  conductorTrack.push(0x00);
  conductorTrack.push(0xFF, 0x2F, 0x00);

  trackDataArray.push(conductorTrack);

  // Build each instrument track
  for (const track of tracks) {
    const trackData = buildTrackData(track, ticksPerBeat, tempo);
    trackDataArray.push(trackData);
  }

  // Build complete MIDI file
  const midiData: number[] = [];

  // Header chunk - Format 1 (multiple tracks, synchronous)
  midiData.push(0x4D, 0x54, 0x68, 0x64); // "MThd"
  midiData.push(0x00, 0x00, 0x00, 0x06); // Chunk length (6)
  midiData.push(0x00, 0x01); // Format type 1
  const numTracks = trackDataArray.length;
  midiData.push((numTracks >> 8) & 0xFF, numTracks & 0xFF); // Number of tracks
  midiData.push((ticksPerBeat >> 8) & 0xFF, ticksPerBeat & 0xFF); // Ticks per beat

  // Add all track chunks
  for (const trackData of trackDataArray) {
    midiData.push(0x4D, 0x54, 0x72, 0x6B); // "MTrk"
    const trackLength = trackData.length;
    midiData.push((trackLength >> 24) & 0xFF);
    midiData.push((trackLength >> 16) & 0xFF);
    midiData.push((trackLength >> 8) & 0xFF);
    midiData.push(trackLength & 0xFF);
    midiData.push(...trackData);
  }

  return new Blob([new Uint8Array(midiData)], { type: 'audio/midi' });
}

/**
 * Build track data for a single track
 */
function buildTrackData(
  track: MidiTrack,
  ticksPerBeat: number,
  tempo: number
): number[] {
  const trackData: number[] = [];
  const { notes, channel, program, name } = track;

  // Track name meta event
  if (name) {
    trackData.push(0x00); // Delta time
    trackData.push(0xFF, 0x03); // Track name
    const nameBytes = new TextEncoder().encode(name);
    writeVariableLength(trackData, nameBytes.length);
    trackData.push(...nameBytes);
  }

  // Program change
  trackData.push(0x00); // Delta time
  trackData.push(0xC0 | (channel & 0x0F), program & 0x7F);

  // Sort notes by start time
  const sortedNotes = [...notes].sort((a, b) => a.startTime - b.startTime);

  // Convert time in seconds to ticks
  const secondsToTicks = (seconds: number): number => {
    const beats = seconds * (tempo / 60);
    return Math.round(beats * ticksPerBeat);
  };

  // Build MIDI events
  interface MidiEvent {
    tick: number;
    type: 'noteOn' | 'noteOff';
    note: number;
    velocity: number;
  }

  const events: MidiEvent[] = [];

  for (const note of sortedNotes) {
    const startTick = secondsToTicks(note.startTime);
    const endTick = secondsToTicks(note.startTime + note.duration);

    events.push({
      tick: startTick,
      type: 'noteOn',
      note: note.midi,
      velocity: note.velocity || 80,
    });

    events.push({
      tick: endTick,
      type: 'noteOff',
      note: note.midi,
      velocity: 0,
    });
  }

  // Sort events
  events.sort((a, b) => {
    if (a.tick !== b.tick) return a.tick - b.tick;
    if (a.type === 'noteOff' && b.type === 'noteOn') return -1;
    if (a.type === 'noteOn' && b.type === 'noteOff') return 1;
    return 0;
  });

  // Add note events
  let lastTick = 0;
  for (const event of events) {
    const deltaTick = event.tick - lastTick;
    lastTick = event.tick;

    writeVariableLength(trackData, deltaTick);

    if (event.type === 'noteOn') {
      trackData.push(0x90 | (channel & 0x0F));
      trackData.push(event.note & 0x7F);
      trackData.push(event.velocity & 0x7F);
    } else {
      trackData.push(0x80 | (channel & 0x0F));
      trackData.push(event.note & 0x7F);
      trackData.push(0x00);
    }
  }

  // End of track
  trackData.push(0x00);
  trackData.push(0xFF, 0x2F, 0x00);

  return trackData;
}

/**
 * Write a variable-length quantity to the data array
 */
function writeVariableLength(data: number[], value: number): void {
  if (value < 0) value = 0;

  const bytes: number[] = [];
  bytes.push(value & 0x7F);

  while (value > 0x7F) {
    value >>= 7;
    bytes.push((value & 0x7F) | 0x80);
  }

  for (let i = bytes.length - 1; i >= 0; i--) {
    data.push(bytes[i]);
  }
}

/**
 * Trigger download of MIDI file (single track)
 */
export function downloadMidi(notes: NoteEvent[], tempo: number, filename: string = 'composition.mid'): void {
  const blob = generateMidiFile(notes, tempo);
  downloadBlob(blob, filename);
}

/**
 * Trigger download of multi-track MIDI file with harmony
 */
export function downloadMidiWithHarmony(
  melody: NoteEvent[],
  harmonyVoices: HarmonyVoice[],
  tempo: number,
  filename: string = 'harmony.mid'
): void {
  const tracks: MidiTrack[] = [
    { name: 'Melody', notes: melody, channel: 0, program: 0 }
  ];

  // Add harmony voices on different channels
  harmonyVoices.forEach((voice, index) => {
    tracks.push({
      name: voice.name,
      notes: voice.notes,
      channel: (index + 1) % 16, // Avoid channel 9 (drums)
      program: 0, // Piano for all voices
    });
  });

  const blob = generateMultiTrackMidiFile(tracks, tempo);
  downloadBlob(blob, filename);
}

/**
 * Helper to download a blob
 */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
