import Soundfont from 'soundfont-player';
import type { NoteEvent } from '@/types/music';

let instrument: Soundfont.Player | null = null;
let loadingPromise: Promise<Soundfont.Player> | null = null;

export async function loadInstrument(audioContext: AudioContext): Promise<Soundfont.Player> {
  if (instrument && audioContext.state === 'closed') {
    instrument = null;
    loadingPromise = null;
  }

  if (instrument) return instrument;

  if (loadingPromise) return loadingPromise;

  console.log('Loading soundfont...');
  loadingPromise = Soundfont.instrument(audioContext as unknown as AudioContext, 'acoustic_grand_piano', {
    soundfont: 'MusyngKite',
    gain: 2,
  }).then((piano) => {
    console.log('Soundfont loaded successfully');
    instrument = piano;
    return piano;
  }).catch((err) => {
    console.error('Failed to load soundfont:', err);
    loadingPromise = null;
    throw err;
  });

  return loadingPromise;
}

function midiToSoundfontNote(midi: number): string {
  const noteNames = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  const octave = Math.floor(midi / 12) - 1;
  const noteIndex = midi % 12;
  return `${noteNames[noteIndex]}${octave}`;
}

export function stopAllNotes(piano: Soundfont.Player): void {
  piano.stop();
}

interface PlaybackOptions {
  onNoteStart?: (index: number) => void;
  onComplete?: () => void;
  startFromIndex?: number;
}

export function schedulePlayback(
  piano: Soundfont.Player,
  audioContext: AudioContext,
  notes: NoteEvent[],
  options: PlaybackOptions
): { stop: () => void } {
  const { onNoteStart, onComplete, startFromIndex = 0 } = options;

  let stopped = false;
  const scheduledNodes: Soundfont.Player[] = [];
  const timeouts: ReturnType<typeof setTimeout>[] = [];

  // Get notes starting from the specified index
  const notesToPlay = notes.slice(startFromIndex);
  const timeOffset = startFromIndex > 0 && startFromIndex < notes.length
    ? notes[startFromIndex].startTime
    : 0;

  console.log(`Starting playback of ${notesToPlay.length} notes from index ${startFromIndex}`);

  if (notesToPlay.length > 0) {
    console.log('First note starts at:', notesToPlay[0].startTime.toFixed(3), 's');
  }

  // Use Web Audio API scheduling for precise timing
  const startTime = audioContext.currentTime;

  notesToPlay.forEach((note, i) => {
    const originalIndex = startFromIndex + i;
    const noteStartTime = note.startTime - timeOffset;
    const noteDuration = Math.max(note.duration, 0.1);

    // Schedule the note using Web Audio time
    const timeout = setTimeout(() => {
      if (stopped) return;

      onNoteStart?.(originalIndex);
      const noteName = midiToSoundfontNote(note.midi);

      try {
        const node = piano.play(noteName, audioContext.currentTime, {
          duration: noteDuration,
          gain: (note.velocity / 127) * 2,
        });
        scheduledNodes.push(node);
      } catch (err) {
        console.error('Error playing note:', err);
      }
    }, noteStartTime * 1000);

    timeouts.push(timeout);
  });

  // Schedule completion callback
  if (notesToPlay.length > 0) {
    const lastNote = notesToPlay[notesToPlay.length - 1];
    const totalDuration = (lastNote.startTime - timeOffset) + lastNote.duration;

    const completeTimeout = setTimeout(() => {
      if (!stopped) {
        console.log('Playback complete');
        onComplete?.();
      }
    }, (totalDuration + 0.3) * 1000);

    timeouts.push(completeTimeout);
  }

  return {
    stop: () => {
      console.log('Stopping playback');
      stopped = true;
      timeouts.forEach(clearTimeout);
      scheduledNodes.forEach((node) => {
        try {
          node.stop();
        } catch (e) {
          // Ignore errors on stop
        }
      });
      piano.stop();
    },
  };
}
