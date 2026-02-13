'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useAudioContext } from '@/context/AudioContextProvider';
import { loadInstrument, schedulePlayback, stopAllNotes } from '@/lib/playback/soundfontPlayer';
import type { NoteEvent, PlaybackState } from '@/types/music';
import type Soundfont from 'soundfont-player';

interface UsePlaybackReturn {
  play: () => void;
  playFrom: (noteIndex: number) => void;
  stop: () => void;
  toggle: () => void;
  setTempo: (tempo: number) => void;
  setCursorPosition: (noteIndex: number) => void;
  playbackState: PlaybackState;
  cursorPosition: number;
  isLoading: boolean;
}

export function usePlayback(notes: NoteEvent[]): UsePlaybackReturn {
  const { getAudioContext, resumeContext } = useAudioContext();
  const [playbackState, setPlaybackState] = useState<PlaybackState>({
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    currentNoteIndex: -1,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [tempo, setTempoState] = useState(120);
  const [cursorPosition, setCursorPositionState] = useState(0);

  const instrumentRef = useRef<Soundfont.Player | null>(null);
  const stopFnRef = useRef<(() => void) | null>(null);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  // Calculate total duration
  useEffect(() => {
    if (notes.length > 0) {
      const lastNote = notes[notes.length - 1];
      const duration = lastNote.startTime + lastNote.duration;
      setPlaybackState((prev) => ({ ...prev, duration }));
    }
  }, [notes]);

  const playFromIndex = useCallback(async (startFromIndex: number = 0) => {
    if (notes.length === 0) {
      console.log('No notes to play');
      return;
    }

    try {
      setIsLoading(true);
      console.log('Starting playback from index:', startFromIndex);

      // Resume audio context (required for browser autoplay policy)
      await resumeContext();
      const audioContext = getAudioContext();

      console.log('AudioContext state:', audioContext.state);

      // Ensure context is running
      if (audioContext.state !== 'running') {
        console.log('Resuming AudioContext...');
        await audioContext.resume();
        console.log('AudioContext state after resume:', audioContext.state);
      }

      // Load instrument if needed
      if (!instrumentRef.current) {
        console.log('Loading instrument...');
        instrumentRef.current = await loadInstrument(audioContext);
        console.log('Instrument loaded');
      }

      setIsLoading(false);
      setPlaybackState((prev) => ({
        ...prev,
        isPlaying: true,
        currentTime: startFromIndex > 0 ? notes[startFromIndex].startTime : 0,
        currentNoteIndex: startFromIndex,
      }));

      const timeOffset = startFromIndex > 0 ? notes[startFromIndex].startTime : 0;
      startTimeRef.current = Date.now() - (timeOffset * 1000);

      // Track progress
      progressIntervalRef.current = setInterval(() => {
        const elapsed = (Date.now() - startTimeRef.current) / 1000;
        setPlaybackState((prev) => ({
          ...prev,
          currentTime: Math.min(elapsed, prev.duration),
        }));
      }, 50);

      // Schedule playback
      const { stop: stopPlayback } = schedulePlayback(
        instrumentRef.current,
        audioContext,
        notes,
        {
          startFromIndex,
          onNoteStart: (index) => {
            setPlaybackState((prev) => ({ ...prev, currentNoteIndex: index }));
          },
          onComplete: () => {
            if (progressIntervalRef.current) {
              clearInterval(progressIntervalRef.current);
            }
            setPlaybackState((prev) => ({
              ...prev,
              isPlaying: false,
              currentNoteIndex: -1,
            }));
            // Reset cursor to beginning after completion
            setCursorPositionState(0);
          },
        }
      );

      stopFnRef.current = stopPlayback;
    } catch (err) {
      console.error('Playback error:', err);
      setIsLoading(false);
      setPlaybackState((prev) => ({ ...prev, isPlaying: false }));
    }
  }, [notes, tempo, getAudioContext, resumeContext]);

  const play = useCallback(() => {
    playFromIndex(cursorPosition);
  }, [playFromIndex, cursorPosition]);

  const playFrom = useCallback((noteIndex: number) => {
    setCursorPositionState(noteIndex);
    playFromIndex(noteIndex);
  }, [playFromIndex]);

  const stop = useCallback(() => {
    if (stopFnRef.current) {
      stopFnRef.current();
      stopFnRef.current = null;
    }

    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }

    if (instrumentRef.current) {
      stopAllNotes(instrumentRef.current);
    }

    setPlaybackState((prev) => ({
      ...prev,
      isPlaying: false,
      currentTime: 0,
      currentNoteIndex: -1,
    }));
  }, []);

  const toggle = useCallback(() => {
    if (playbackState.isPlaying) {
      stop();
    } else {
      play();
    }
  }, [playbackState.isPlaying, play, stop]);

  const setCursorPosition = useCallback((noteIndex: number) => {
    setCursorPositionState(Math.max(0, Math.min(noteIndex, notes.length - 1)));
  }, [notes.length]);

  const setTempo = useCallback((newTempo: number) => {
    setTempoState(newTempo);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (stopFnRef.current) stopFnRef.current();
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    };
  }, []);

  return { play, playFrom, stop, toggle, setTempo, setCursorPosition, playbackState, cursorPosition, isLoading };
}
