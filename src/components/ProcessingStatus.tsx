'use client';

interface ProcessingStatusProps {
  isProcessing: boolean;
  progress: number;
  error: string | null;
  fileName?: string;
}

export function ProcessingStatus({
  isProcessing,
  progress,
  error,
  fileName,
}: ProcessingStatusProps) {
  if (error) {
    return (
      <div className="w-full p-4 bg-red-50 dark:bg-red-950 rounded-lg">
        <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span className="font-medium">Error</span>
        </div>
        <p className="mt-1 text-sm text-red-600 dark:text-red-400">{error}</p>
      </div>
    );
  }

  if (!isProcessing) {
    return null;
  }

  return (
    <div className="w-full p-4 bg-zinc-100 dark:bg-zinc-800 rounded-lg">
      <div className="flex items-center gap-3 mb-3">
        <div className="animate-spin">
          <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        </div>
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Processing {fileName ? `"${fileName}"` : 'audio'}...
        </span>
      </div>
      <div className="w-full bg-zinc-200 dark:bg-zinc-700 rounded-full h-2">
        <div
          className="bg-blue-500 h-2 rounded-full transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-zinc-500 text-center">
        {progress < 30 && 'Decoding audio...'}
        {progress >= 30 && progress < 80 && 'Detecting pitches...'}
        {progress >= 80 && 'Finalizing...'}
      </p>
    </div>
  );
}
