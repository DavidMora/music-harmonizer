'use client';

import { useState } from 'react';
import type { HarmonyStyle, HarmonyVoice } from '@/lib/harmony/harmonizer';
import { HARMONY_STYLES } from '@/lib/harmony/harmonizer';

interface HarmonyPanelProps {
  harmonyStyle: HarmonyStyle | null;
  onStyleChange: (style: HarmonyStyle | null) => void;
  harmonyVoices: HarmonyVoice[];
  onToggleVoice: (index: number) => void;
  voiceEnabled: boolean[];
  onDownloadHarmony: () => void;
  hasNotes: boolean;
  isMinor: boolean;
  onMinorChange: (isMinor: boolean) => void;
  leadVoiceEnabled: boolean;
  onLeadVoiceToggle: () => void;
}

export function HarmonyPanel({
  harmonyStyle,
  onStyleChange,
  harmonyVoices,
  onToggleVoice,
  voiceEnabled,
  onDownloadHarmony,
  hasNotes,
  isMinor,
  onMinorChange,
  leadVoiceEnabled,
  onLeadVoiceToggle,
}: HarmonyPanelProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <section className="mb-6 p-4 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-700">
      <div
        className="flex items-center justify-between cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Harmony Generator
        </h2>
        <button className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200">
          {isExpanded ? '▼' : '▶'}
        </button>
      </div>

      {isExpanded && (
        <div className="mt-4 space-y-4">
          {/* Style Selection */}
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="text-sm text-zinc-600 dark:text-zinc-400">Style:</label>
              <select
                value={harmonyStyle || ''}
                onChange={(e) => onStyleChange(e.target.value ? e.target.value as HarmonyStyle : null)}
                className="px-3 py-1.5 text-sm border border-zinc-300 dark:border-zinc-600 rounded bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white"
                disabled={!hasNotes}
              >
                <option value="">No Harmony</option>
                {HARMONY_STYLES.map((style) => (
                  <option key={style.value} value={style.value}>
                    {style.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Major/Minor Toggle */}
            <div className="flex items-center gap-2">
              <label className="text-sm text-zinc-600 dark:text-zinc-400">Scale:</label>
              <div className="flex gap-1">
                <button
                  onClick={() => onMinorChange(false)}
                  className={`px-3 py-1 text-sm rounded ${
                    !isMinor
                      ? 'bg-blue-500 text-white'
                      : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300'
                  }`}
                >
                  Major
                </button>
                <button
                  onClick={() => onMinorChange(true)}
                  className={`px-3 py-1 text-sm rounded ${
                    isMinor
                      ? 'bg-blue-500 text-white'
                      : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300'
                  }`}
                >
                  Minor
                </button>
              </div>
            </div>

            {/* Download Harmony MIDI */}
            {harmonyVoices.length > 0 && (
              <button
                onClick={onDownloadHarmony}
                className="px-3 py-1.5 text-sm bg-purple-500 text-white rounded hover:bg-purple-600 transition-colors ml-auto"
              >
                Download Harmony MIDI
              </button>
            )}
          </div>

          {/* Style Description */}
          {harmonyStyle && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {HARMONY_STYLES.find(s => s.value === harmonyStyle)?.description}
            </p>
          )}

          {/* Voice Controls */}
          {harmonyVoices.length > 0 && (
            <div className="space-y-2">
              <div className="text-sm text-zinc-600 dark:text-zinc-400">Voices:</div>
              <div className="flex flex-wrap gap-2">
                {/* Lead Voice toggle */}
                <button
                  onClick={onLeadVoiceToggle}
                  className={`flex items-center gap-2 px-3 py-1.5 text-sm rounded border transition-colors ${
                    leadVoiceEnabled
                      ? 'bg-blue-100 dark:bg-blue-900 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300'
                      : 'bg-zinc-100 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-600 text-zinc-500 line-through'
                  }`}
                >
                  <span
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: leadVoiceEnabled ? '#3b82f6' : '#9ca3af' }}
                  />
                  Lead Voice
                </button>

                {/* Harmony voices */}
                {harmonyVoices.map((voice, index) => (
                  <button
                    key={index}
                    onClick={() => onToggleVoice(index)}
                    className={`flex items-center gap-2 px-3 py-1.5 text-sm rounded border transition-colors ${
                      voiceEnabled[index]
                        ? 'bg-green-100 dark:bg-green-900 border-green-300 dark:border-green-700 text-green-700 dark:text-green-300'
                        : 'bg-zinc-100 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-600 text-zinc-500 line-through'
                    }`}
                  >
                    <span
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: voice.color }}
                    />
                    {voice.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* No notes message */}
          {!hasNotes && (
            <p className="text-sm text-zinc-400 dark:text-zinc-500 text-center py-2">
              Load or compose a melody to generate harmony
            </p>
          )}
        </div>
      )}
    </section>
  );
}
