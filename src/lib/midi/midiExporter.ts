import type { NoteEvent } from '@/types/music';

/**
 * Generate a MIDI file from note events
 * Returns a Blob that can be downloaded
 */
export function generateMidiFile(notes: NoteEvent[], tempo: number = 120): Blob {
  const ticksPerBeat = 480; // Standard MIDI resolution
  const microsecondsPerBeat = Math.round(60000000 / tempo);

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

  // Sort events by tick, with noteOff before noteOn at same tick
  events.sort((a, b) => {
    if (a.tick !== b.tick) return a.tick - b.tick;
    if (a.type === 'noteOff' && b.type === 'noteOn') return -1;
    if (a.type === 'noteOn' && b.type === 'noteOff') return 1;
    return 0;
  });

  // Build track data
  const trackData: number[] = [];

  // Tempo meta event (FF 51 03 tt tt tt)
  trackData.push(0x00); // Delta time
  trackData.push(0xFF, 0x51, 0x03);
  trackData.push((microsecondsPerBeat >> 16) & 0xFF);
  trackData.push((microsecondsPerBeat >> 8) & 0xFF);
  trackData.push(microsecondsPerBeat & 0xFF);

  // Time signature meta event (FF 58 04 nn dd cc bb)
  trackData.push(0x00); // Delta time
  trackData.push(0xFF, 0x58, 0x04);
  trackData.push(0x04); // Numerator (4)
  trackData.push(0x02); // Denominator as power of 2 (4 = 2^2)
  trackData.push(0x18); // MIDI clocks per metronome click (24)
  trackData.push(0x08); // 32nd notes per quarter note (8)

  // Program change to acoustic grand piano
  trackData.push(0x00); // Delta time
  trackData.push(0xC0, 0x00); // Channel 0, Program 0 (piano)

  // Add note events
  let lastTick = 0;
  for (const event of events) {
    const deltaTick = event.tick - lastTick;
    lastTick = event.tick;

    // Write variable-length delta time
    writeVariableLength(trackData, deltaTick);

    // Write MIDI event
    if (event.type === 'noteOn') {
      trackData.push(0x90); // Note on, channel 0
      trackData.push(event.note & 0x7F);
      trackData.push(event.velocity & 0x7F);
    } else {
      trackData.push(0x80); // Note off, channel 0
      trackData.push(event.note & 0x7F);
      trackData.push(0x00);
    }
  }

  // End of track meta event
  trackData.push(0x00); // Delta time
  trackData.push(0xFF, 0x2F, 0x00);

  // Build complete MIDI file
  const midiData: number[] = [];

  // Header chunk
  // "MThd"
  midiData.push(0x4D, 0x54, 0x68, 0x64);
  // Chunk length (6)
  midiData.push(0x00, 0x00, 0x00, 0x06);
  // Format type (0 = single track)
  midiData.push(0x00, 0x00);
  // Number of tracks (1)
  midiData.push(0x00, 0x01);
  // Ticks per beat
  midiData.push((ticksPerBeat >> 8) & 0xFF, ticksPerBeat & 0xFF);

  // Track chunk
  // "MTrk"
  midiData.push(0x4D, 0x54, 0x72, 0x6B);
  // Track length
  const trackLength = trackData.length;
  midiData.push((trackLength >> 24) & 0xFF);
  midiData.push((trackLength >> 16) & 0xFF);
  midiData.push((trackLength >> 8) & 0xFF);
  midiData.push(trackLength & 0xFF);
  // Track data
  midiData.push(...trackData);

  return new Blob([new Uint8Array(midiData)], { type: 'audio/midi' });
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

  // Write in reverse order
  for (let i = bytes.length - 1; i >= 0; i--) {
    data.push(bytes[i]);
  }
}

/**
 * Trigger download of MIDI file
 */
export function downloadMidi(notes: NoteEvent[], tempo: number, filename: string = 'composition.mid'): void {
  const blob = generateMidiFile(notes, tempo);
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  URL.revokeObjectURL(url);
}
