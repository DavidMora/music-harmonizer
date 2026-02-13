import type { NoteEvent } from '@/types/music';

interface MidiImportResult {
  notes: NoteEvent[];
  tempo: number;
}

/**
 * Parse a MIDI file and extract note events
 */
export async function parseMidiFile(file: File): Promise<MidiImportResult> {
  const buffer = await file.arrayBuffer();
  const data = new Uint8Array(buffer);

  let pos = 0;
  let tempo = 120; // Default tempo
  let ticksPerBeat = 480;

  // Read header chunk
  const headerChunk = readChunk(data, pos);
  if (headerChunk.type !== 'MThd') {
    throw new Error('Invalid MIDI file: missing header');
  }
  pos += 8 + headerChunk.length;

  // Parse header data
  const headerData = headerChunk.data;
  const format = (headerData[0] << 8) | headerData[1];
  const numTracks = (headerData[2] << 8) | headerData[3];
  ticksPerBeat = (headerData[4] << 8) | headerData[5];

  // Collect all note events from all tracks
  const noteEvents: { tick: number; type: 'on' | 'off'; note: number; velocity: number }[] = [];

  // Read track chunks
  for (let track = 0; track < numTracks && pos < data.length; track++) {
    const trackChunk = readChunk(data, pos);
    if (trackChunk.type !== 'MTrk') {
      pos += 8 + trackChunk.length;
      continue;
    }

    // Parse track events
    let trackPos = 0;
    let absoluteTick = 0;
    let runningStatus = 0;

    while (trackPos < trackChunk.data.length) {
      // Read delta time
      const deltaResult = readVariableLength(trackChunk.data, trackPos);
      trackPos = deltaResult.newPos;
      absoluteTick += deltaResult.value;

      // Read event
      let eventByte = trackChunk.data[trackPos];

      // Handle running status
      if (eventByte < 0x80) {
        eventByte = runningStatus;
      } else {
        trackPos++;
        if (eventByte < 0xF0) {
          runningStatus = eventByte;
        }
      }

      const eventType = eventByte & 0xF0;
      const channel = eventByte & 0x0F;

      if (eventType === 0x90) {
        // Note on
        const note = trackChunk.data[trackPos++];
        const velocity = trackChunk.data[trackPos++];
        if (velocity > 0) {
          noteEvents.push({ tick: absoluteTick, type: 'on', note, velocity });
        } else {
          // Note on with velocity 0 = note off
          noteEvents.push({ tick: absoluteTick, type: 'off', note, velocity: 0 });
        }
      } else if (eventType === 0x80) {
        // Note off
        const note = trackChunk.data[trackPos++];
        const velocity = trackChunk.data[trackPos++];
        noteEvents.push({ tick: absoluteTick, type: 'off', note, velocity });
      } else if (eventType === 0xA0) {
        // Polyphonic key pressure
        trackPos += 2;
      } else if (eventType === 0xB0) {
        // Control change
        trackPos += 2;
      } else if (eventType === 0xC0) {
        // Program change
        trackPos += 1;
      } else if (eventType === 0xD0) {
        // Channel pressure
        trackPos += 1;
      } else if (eventType === 0xE0) {
        // Pitch bend
        trackPos += 2;
      } else if (eventByte === 0xFF) {
        // Meta event
        const metaType = trackChunk.data[trackPos++];
        const lengthResult = readVariableLength(trackChunk.data, trackPos);
        trackPos = lengthResult.newPos;
        const metaLength = lengthResult.value;

        if (metaType === 0x51 && metaLength === 3) {
          // Tempo
          const microsecondsPerBeat =
            (trackChunk.data[trackPos] << 16) |
            (trackChunk.data[trackPos + 1] << 8) |
            trackChunk.data[trackPos + 2];
          tempo = Math.round(60000000 / microsecondsPerBeat);
        }

        trackPos += metaLength;

        if (metaType === 0x2F) {
          // End of track
          break;
        }
      } else if (eventByte === 0xF0 || eventByte === 0xF7) {
        // SysEx
        const lengthResult = readVariableLength(trackChunk.data, trackPos);
        trackPos = lengthResult.newPos + lengthResult.value;
      }
    }

    pos += 8 + trackChunk.length;
  }

  // Sort events by tick
  noteEvents.sort((a, b) => a.tick - b.tick);

  // Convert to NoteEvent format
  const notes: NoteEvent[] = [];
  const activeNotes = new Map<number, { tick: number; velocity: number }>();

  // Helper to convert ticks to seconds
  const ticksToSeconds = (ticks: number): number => {
    const beats = ticks / ticksPerBeat;
    return beats * (60 / tempo);
  };

  for (const event of noteEvents) {
    if (event.type === 'on') {
      activeNotes.set(event.note, { tick: event.tick, velocity: event.velocity });
    } else if (event.type === 'off') {
      const noteOn = activeNotes.get(event.note);
      if (noteOn) {
        const startTime = ticksToSeconds(noteOn.tick);
        const endTime = ticksToSeconds(event.tick);
        const duration = Math.max(0.05, endTime - startTime);

        notes.push({
          midi: event.note,
          frequency: 440 * Math.pow(2, (event.note - 69) / 12),
          startTime,
          duration,
          velocity: noteOn.velocity,
        });

        activeNotes.delete(event.note);
      }
    }
  }

  // Sort notes by start time
  notes.sort((a, b) => a.startTime - b.startTime);

  // Normalize start times (remove leading silence)
  if (notes.length > 0) {
    const firstStart = notes[0].startTime;
    if (firstStart > 0) {
      for (const note of notes) {
        note.startTime -= firstStart;
      }
    }
  }

  return { notes, tempo };
}

/**
 * Read a MIDI chunk (header or track)
 */
function readChunk(data: Uint8Array, pos: number): { type: string; length: number; data: Uint8Array } {
  const type = String.fromCharCode(data[pos], data[pos + 1], data[pos + 2], data[pos + 3]);
  const length = (data[pos + 4] << 24) | (data[pos + 5] << 16) | (data[pos + 6] << 8) | data[pos + 7];
  const chunkData = data.slice(pos + 8, pos + 8 + length);
  return { type, length, data: chunkData };
}

/**
 * Read a variable-length quantity
 */
function readVariableLength(data: Uint8Array, pos: number): { value: number; newPos: number } {
  let value = 0;
  let byte: number;

  do {
    byte = data[pos++];
    value = (value << 7) | (byte & 0x7F);
  } while (byte & 0x80);

  return { value, newPos: pos };
}
