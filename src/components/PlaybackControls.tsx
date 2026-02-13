'use client';

import type { PlaybackState } from '@/types/music';

interface PlaybackControlsProps {
  playbackState: PlaybackState;
  tempo: number;
  onPlay: () => void;
  onStop: () => void;
  onTempoChange: (tempo: number) => void;
  isLoading?: boolean;
  disabled?: boolean;
}

export function PlaybackControls({
  playbackState,
  tempo,
  onPlay,
  onStop,
  onTempoChange,
  isLoading = false,
  disabled = false,
}: PlaybackControlsProps) {
  const { isPlaying, currentTime, duration } = playbackState;

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="w-full p-4 bg-zinc-100 dark:bg-zinc-800 rounded-lg space-y-4">
      {/* Buttons and tempo */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <button
            onClick={isPlaying ? onStop : onPlay}
            disabled={disabled || isLoading}
            className={`
              flex items-center justify-center gap-2 px-4 py-2 rounded-lg
              font-medium transition-colors
              ${disabled || isLoading
                ? 'bg-zinc-300 dark:bg-zinc-700 text-zinc-500 cursor-not-allowed'
                : isPlaying
                  ? 'bg-red-500 hover:bg-red-600 text-white'
                  : 'bg-blue-500 hover:bg-blue-600 text-white'
              }
            `}
          >
            {isLoading ? (
              <>
                <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                Loading...
              </>
            ) : isPlaying ? (
              <>
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="4" width="4" height="16" />
                  <rect x="14" y="4" width="4" height="16" />
                </svg>
                Stop
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
                Play
              </>
            )}
          </button>
        </div>

        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
            Tempo:
          </label>
          <input
            type="range"
            min="60"
            max="200"
            value={tempo}
            onChange={(e) => onTempoChange(Number(e.target.value))}
            disabled={isPlaying}
            className="w-24 h-2 bg-zinc-300 dark:bg-zinc-600 rounded-lg appearance-none cursor-pointer disabled:opacity-50"
          />
          <span className="text-sm font-mono text-zinc-600 dark:text-zinc-400 w-12">
            {tempo}
          </span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="space-y-1">
        <div className="w-full bg-zinc-200 dark:bg-zinc-700 rounded-full h-2">
          <div
            className="bg-blue-500 h-2 rounded-full transition-all duration-100"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-zinc-500">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>
    </div>
  );
}
