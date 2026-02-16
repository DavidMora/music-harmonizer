'use client';

import { useState, useCallback } from 'react';
import { useAudioContext } from '@/context/AudioContextProvider';
import { decodeAudioFile } from '@/lib/audio/decoder';
import { detectPitchContour, smoothPitchContour } from '@/lib/audio/pitchDetector';
import { detectOnsets, refineOnsets } from '@/lib/audio/onsetDetector';
import { analyzeTempo, refineTempo } from '@/lib/audio/tempoAnalyzer';
import { analyzeDynamics } from '@/lib/audio/dynamicsAnalyzer';
import {
  segmentNotes,
  mergeConsecutiveNotes,
  normalizeStartTimes,
  filterShortNotes,
} from '@/lib/audio/noteSegmenter';
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

        // Step 1: Decode audio file
        console.log('Decoding audio file...');
        setProgress(10);
        const { audioData, sampleRate, duration } = await decodeAudioFile(
          file,
          audioContext
        );

        // Step 2: Detect onsets (note attack points)
        console.log('Detecting onsets...');
        setProgress(25);
        const { onsets: rawOnsets } = detectOnsets(audioData, {
          sampleRate,
          windowSize: 2048,
          hopSize: 512,
          threshold: 1.5,
          minOnsetGap: 0.05,
        });

        // Refine onset times
        const onsets = refineOnsets(audioData, rawOnsets, sampleRate);
        console.log(`Detected ${onsets.length} onsets`);

        // Step 3: Analyze tempo
        console.log('Analyzing tempo...');
        setProgress(35);
        const tempoResult = analyzeTempo(onsets, {
          minBPM: 60,
          maxBPM: 180,
        });

        // Refine tempo estimate
        const detectedTempo = refineTempo(onsets, tempoResult.bpm, 5);
        const tempoConfidence = tempoResult.confidence;
        console.log(`Detected tempo: ${detectedTempo} BPM (confidence: ${(tempoConfidence * 100).toFixed(0)}%)`);

        // Step 4: Detect pitch contour
        console.log('Detecting pitch...');
        setProgress(50);
        const rawContour = detectPitchContour(audioData, {
          sampleRate,
          windowSize: 2048,
          hopSize: 512,
          minFrequency: 80,
          maxFrequency: 1100,
          clarityThreshold: 0.5, // Lower threshold for better detection
        });

        // Smooth pitch contour
        const pitchContour = smoothPitchContour(rawContour, 5);

        // Step 5: Analyze dynamics
        console.log('Analyzing dynamics...');
        setProgress(65);
        const dynamicsResult = analyzeDynamics(audioData, onsets, duration, {
          sampleRate,
          minVelocity: 30,
          maxVelocity: 120,
        });
        console.log(`Dynamic range: ${dynamicsResult.globalDynamicRange.toFixed(1)} dB`);

        // Step 6: Segment into notes
        console.log('Segmenting notes...');
        setProgress(80);
        let notes = segmentNotes(
          onsets,
          pitchContour,
          dynamicsResult.velocities,
          duration,
          {
            minNoteDuration: 0.05,
            usePitchChanges: true,
          }
        );

        // Post-process notes
        notes = mergeConsecutiveNotes(notes, 0.05);
        notes = filterShortNotes(notes, 0.05);
        notes = normalizeStartTimes(notes);

        console.log(`Segmented ${notes.length} notes`);

        setProgress(100);

        return {
          notes,
          sampleRate,
          duration: notes.length > 0
            ? notes[notes.length - 1].startTime + notes[notes.length - 1].duration
            : 0,
          detectedTempo,
          tempoConfidence,
          onsets,
        };
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
