'use client';

import { useState, useCallback } from 'react';
import { useAudioContext } from '@/context/AudioContextProvider';
import { decodeAudioFile } from '@/lib/audio/decoder';
import { detectPitches } from '@/lib/audio/pitchDetector';
import type { AnalysisResult } from '@/types/music';

interface UseAudioAnalysisReturn {
  analyze: (file: File) => Promise<AnalysisResult>;
  isAnalyzing: boolean;
  progress: number;
  error: string | null;
}

export function useAudioAnalysis(): UseAudioAnalysisReturn {
  const { getAudioContext, resumeContext } = useAudioContext();
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const analyze = useCallback(
    async (file: File): Promise<AnalysisResult> => {
      setIsAnalyzing(true);
      setProgress(0);
      setError(null);

      try {
        await resumeContext();
        const audioContext = getAudioContext();

        // Decode audio file
        setProgress(20);
        const { audioData, sampleRate, duration } = await decodeAudioFile(
          file,
          audioContext
        );

        // Detect pitches
        setProgress(50);
        const result = detectPitches(audioData, {
          sampleRate,
          windowSize: 2048,
          hopSize: 512,
        });

        setProgress(100);
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Analysis failed';
        setError(message);
        throw err;
      } finally {
        setIsAnalyzing(false);
      }
    },
    [getAudioContext, resumeContext]
  );

  return { analyze, isAnalyzing, progress, error };
}
