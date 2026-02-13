'use client';

import { useCallback, useState } from 'react';

interface AudioUploaderProps {
  onFileSelect: (file: File) => void;
  onMidiSelect?: (file: File) => void;
  disabled?: boolean;
}

const ACCEPTED_AUDIO_TYPES = ['audio/mpeg', 'audio/wav', 'audio/mp3', 'audio/wave'];
const ACCEPTED_AUDIO_EXTENSIONS = ['.mp3', '.wav'];
const ACCEPTED_MIDI_TYPES = ['audio/midi', 'audio/x-midi'];
const ACCEPTED_MIDI_EXTENSIONS = ['.mid', '.midi'];

export function AudioUploader({ onFileSelect, onMidiSelect, disabled = false }: AudioUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getFileType = useCallback((file: File): 'audio' | 'midi' | null => {
    const extension = '.' + file.name.split('.').pop()?.toLowerCase();

    if (ACCEPTED_AUDIO_TYPES.includes(file.type) || ACCEPTED_AUDIO_EXTENSIONS.includes(extension)) {
      return 'audio';
    }

    if (ACCEPTED_MIDI_TYPES.includes(file.type) || ACCEPTED_MIDI_EXTENSIONS.includes(extension)) {
      return 'midi';
    }

    return null;
  }, []);

  const validateFile = useCallback((file: File): 'audio' | 'midi' | null => {
    const fileType = getFileType(file);

    if (!fileType) {
      setError('Please upload an MP3, WAV, or MIDI file');
      return null;
    }

    // Max 50MB
    if (file.size > 50 * 1024 * 1024) {
      setError('File size must be less than 50MB');
      return null;
    }

    setError(null);
    return fileType;
  }, [getFileType]);

  const handleFile = useCallback(
    (file: File) => {
      const fileType = validateFile(file);
      if (fileType === 'audio') {
        onFileSelect(file);
      } else if (fileType === 'midi' && onMidiSelect) {
        onMidiSelect(file);
      }
    },
    [onFileSelect, onMidiSelect, validateFile]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);

      if (disabled) return;

      const file = e.dataTransfer.files[0];
      if (file) {
        handleFile(file);
      }
    },
    [handleFile, disabled]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (!disabled) {
        setIsDragging(true);
      }
    },
    [disabled]
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        handleFile(file);
      }
      // Reset input to allow selecting the same file again
      e.target.value = '';
    },
    [handleFile]
  );

  return (
    <div className="w-full">
      <label
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`
          flex flex-col items-center justify-center w-full h-40
          border-2 border-dashed rounded-xl cursor-pointer
          transition-all duration-200
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-zinc-50 dark:hover:bg-zinc-900'}
          ${isDragging
            ? 'border-blue-500 bg-blue-50 dark:bg-blue-950'
            : 'border-zinc-300 dark:border-zinc-700'
          }
        `}
      >
        <div className="flex flex-col items-center justify-center pt-5 pb-6">
          <svg
            className={`w-10 h-10 mb-3 ${isDragging ? 'text-blue-500' : 'text-zinc-400'}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
            />
          </svg>
          <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400">
            <span className="font-semibold">Drop file here</span> or click to browse
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-500">
            MP3, WAV, or MIDI (max 50MB)
          </p>
        </div>
        <input
          type="file"
          className="hidden"
          accept=".mp3,.wav,.mid,.midi,audio/mpeg,audio/wav,audio/midi"
          onChange={handleInputChange}
          disabled={disabled}
        />
      </label>
      {error && (
        <p className="mt-2 text-sm text-red-500 text-center">{error}</p>
      )}
    </div>
  );
}
