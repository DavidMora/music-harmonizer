'use client';

import type { NoteDuration } from '@/types/music';

interface ScoreToolbarProps {
  selectedDuration: NoteDuration;
  onDurationChange: (duration: NoteDuration) => void;
  editMode: 'select' | 'add';
  onEditModeChange: (mode: 'select' | 'add') => void;
  selectedNoteIndex: number | null;
  onDeleteNote: () => void;
  onClearAll: () => void;
  onDownloadMidi: () => void;
  hasNotes: boolean;
}

const DURATION_OPTIONS: { value: NoteDuration; label: string; symbol: string }[] = [
  { value: 'whole', label: 'Whole', symbol: '𝅝' },
  { value: 'whole-dotted', label: 'Dotted Whole', symbol: '𝅝.' },
  { value: 'half', label: 'Half', symbol: '𝅗𝅥' },
  { value: 'half-dotted', label: 'Dotted Half', symbol: '𝅗𝅥.' },
  { value: 'quarter', label: 'Quarter', symbol: '♩' },
  { value: 'quarter-dotted', label: 'Dotted Quarter', symbol: '♩.' },
  { value: 'eighth', label: 'Eighth', symbol: '♪' },
  { value: 'eighth-dotted', label: 'Dotted Eighth', symbol: '♪.' },
  { value: 'sixteenth', label: '16th', symbol: '𝅘𝅥𝅯' },
];

export function ScoreToolbar({
  selectedDuration,
  onDurationChange,
  editMode,
  onEditModeChange,
  selectedNoteIndex,
  onDeleteNote,
  onClearAll,
  onDownloadMidi,
  hasNotes,
}: ScoreToolbarProps) {
  return (
    <div className="bg-zinc-100 dark:bg-zinc-800 rounded-lg p-3 mb-4">
      {/* Mode Toggle */}
      <div className="flex items-center gap-4 mb-3">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Mode:</span>
        <div className="flex gap-1">
          <button
            onClick={() => onEditModeChange('select')}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              editMode === 'select'
                ? 'bg-blue-500 text-white'
                : 'bg-white dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-600'
            }`}
          >
            Select/Edit
          </button>
          <button
            onClick={() => onEditModeChange('add')}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              editMode === 'add'
                ? 'bg-green-500 text-white'
                : 'bg-white dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-600'
            }`}
          >
            Add Notes
          </button>
        </div>

        {/* Delete/Clear/Download buttons */}
        <div className="flex gap-2 ml-auto">
          {selectedNoteIndex !== null && (
            <button
              onClick={onDeleteNote}
              className="px-3 py-1.5 text-sm bg-red-500 text-white rounded-md hover:bg-red-600 transition-colors"
            >
              Delete Note
            </button>
          )}
          {hasNotes && (
            <>
              <button
                onClick={onDownloadMidi}
                className="px-3 py-1.5 text-sm bg-purple-500 text-white rounded-md hover:bg-purple-600 transition-colors"
              >
                Download MIDI
              </button>
              <button
                onClick={onClearAll}
                className="px-3 py-1.5 text-sm bg-zinc-500 text-white rounded-md hover:bg-zinc-600 transition-colors"
              >
                Clear All
              </button>
            </>
          )}
        </div>
      </div>

      {/* Duration Selection */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Duration:</span>
        {DURATION_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onDurationChange(opt.value)}
            title={opt.label}
            className={`w-10 h-10 flex items-center justify-center text-lg rounded-md transition-colors ${
              selectedDuration === opt.value
                ? 'bg-blue-500 text-white'
                : 'bg-white dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-600'
            }`}
          >
            {opt.symbol}
          </button>
        ))}
      </div>

      {/* Instructions */}
      <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
        {editMode === 'add' ? (
          <span>Click on the staff to add a note. Drag up/down to adjust pitch before releasing.</span>
        ) : (
          <span>Click a note to select it. Drag to change pitch. Press Delete or click button to remove.</span>
        )}
      </div>
    </div>
  );
}
