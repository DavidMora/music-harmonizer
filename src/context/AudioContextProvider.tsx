'use client';

import { createContext, useContext, useRef, useCallback, ReactNode } from 'react';

interface AudioContextValue {
  getAudioContext: () => AudioContext;
  resumeContext: () => Promise<void>;
}

const AudioContextContext = createContext<AudioContextValue | null>(null);

export function AudioContextProvider({ children }: { children: ReactNode }) {
  const audioContextRef = useRef<AudioContext | null>(null);

  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }
    return audioContextRef.current;
  }, []);

  const resumeContext = useCallback(async () => {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
  }, [getAudioContext]);

  return (
    <AudioContextContext.Provider value={{ getAudioContext, resumeContext }}>
      {children}
    </AudioContextContext.Provider>
  );
}

export function useAudioContext() {
  const context = useContext(AudioContextContext);
  if (!context) {
    throw new Error('useAudioContext must be used within an AudioContextProvider');
  }
  return context;
}
