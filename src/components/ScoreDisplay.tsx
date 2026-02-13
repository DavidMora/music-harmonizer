'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { QuantizedNote, NoteDuration } from '@/types/music';

interface ScoreDisplayProps {
  measures: QuantizedNote[][];
  currentNoteIndex?: number;
  isPlaying?: boolean;
  selectedNoteIndex?: number | null;
  editMode?: 'select' | 'add';
  inputDuration?: NoteDuration;
  onNoteChange?: (noteIndex: number, newMidi: number) => void;
  onNoteSelect?: (noteIndex: number | null) => void;
  onNoteAdd?: (midi: number, beat: number) => void;
  onPlayNote?: (midi: number) => void;
  onStopNote?: () => void;
  beatsPerMeasure?: number;
  keySignature?: string;
  onSeek?: (noteIndex: number) => void;
}

// Staff line MIDI values (for treble clef)
const TREBLE_CLEF_LINES = [64, 67, 71, 74, 77]; // E4, G4, B4, D5, F5
const TREBLE_CLEF_MIDDLE = 71; // B4 (middle line)

export function ScoreDisplay({
  measures,
  currentNoteIndex = -1,
  isPlaying = false,
  selectedNoteIndex = null,
  editMode = 'select',
  inputDuration = 'quarter',
  onNoteChange,
  onNoteSelect,
  onNoteAdd,
  onPlayNote,
  onStopNote,
  beatsPerMeasure = 4,
  keySignature = 'C',
  onSeek
}: ScoreDisplayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isRendering, setIsRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragState, setDragState] = useState<{
    noteIndex: number;
    startY: number;
    startMidi: number;
    currentMidi: number;
  } | null>(null);
  const [staffInfo, setStaffInfo] = useState<{
    lineSpacing: number;
    topLineY: number;
    staveStartX: number;
    staveWidth: number;
    measurePositions: { x: number; width: number; y: number }[];
  } | null>(null);

  const allNotes = measures.flat();

  useEffect(() => {
    if (!containerRef.current) return;

    let cancelled = false;
    setIsRendering(true);
    setError(null);

    const render = async () => {
      try {
        const { renderScore } = await import('@/lib/notation/vexflowRenderer');

        if (cancelled || !containerRef.current) return;

        // Always render - renderScore handles empty measures by showing an empty staff
        await renderScore(containerRef.current, measures, {
          width: containerRef.current.clientWidth || 800,
          beatsPerMeasure,
          keySignature,
        });

        // Make notes interactive after rendering
        if (containerRef.current) {
          makeNotesInteractive(containerRef.current);
          extractStaffInfo(containerRef.current);
        }

        setIsRendering(false);
      } catch (err) {
        if (!cancelled) {
          console.error('Score rendering error:', err);
          setError('Failed to render score');
          setIsRendering(false);
        }
      }
    };

    render();

    return () => {
      cancelled = true;
    };
  }, [measures, allNotes.length, beatsPerMeasure, keySignature, editMode]);

  const makeNotesInteractive = useCallback((container: HTMLDivElement) => {
    const noteElements = container.querySelectorAll('.vf-stavenote');
    noteElements.forEach((el, index) => {
      const svgEl = el as SVGElement;
      svgEl.style.cursor = 'pointer';
      svgEl.setAttribute('data-note-index', index.toString());
    });
  }, []);

  // Extract staff positioning info for click-to-add
  const extractStaffInfo = useCallback((container: HTMLDivElement) => {
    const staveGroups = container.querySelectorAll('.vf-stave');
    const measurePositions: { x: number; width: number; y: number }[] = [];

    // Extract measure positions from stave groups
    staveGroups.forEach((stave) => {
      const rect = (stave as SVGElement).getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      measurePositions.push({
        x: rect.left - containerRect.left,
        width: rect.width,
        y: rect.top - containerRect.top,
      });
    });

    const staveLines = container.querySelectorAll('.vf-stave line');
    if (staveLines.length >= 5) {
      // Get first staff lines
      const firstFiveLines = Array.from(staveLines).slice(0, 5);
      const yPositions = firstFiveLines.map(line => {
        const y1 = parseFloat(line.getAttribute('y1') || '0');
        return y1;
      }).sort((a, b) => a - b);

      if (yPositions.length >= 2) {
        const lineSpacing = yPositions[1] - yPositions[0];
        setStaffInfo({
          lineSpacing,
          topLineY: yPositions[0],
          staveStartX: measurePositions[0]?.x || 120,
          staveWidth: container.clientWidth - 40,
          measurePositions,
        });
      }
    } else {
      // Fallback for empty staff
      setStaffInfo({
        lineSpacing: 10,
        topLineY: 50,
        staveStartX: 120,
        staveWidth: container.clientWidth - 140,
        measurePositions,
      });
    }
  }, []);

  // Highlight current/selected note
  useEffect(() => {
    if (!containerRef.current) return;

    const doHighlight = async () => {
      const { highlightNote: highlight } = await import('@/lib/notation/vexflowRenderer');
      if (containerRef.current) {
        // Determine which note to highlight and how
        if (isPlaying && currentNoteIndex >= 0) {
          highlight(containerRef.current, currentNoteIndex, 'playback');
        } else if (selectedNoteIndex !== null && selectedNoteIndex >= 0) {
          highlight(containerRef.current, selectedNoteIndex, 'selected');
        } else if (currentNoteIndex >= 0) {
          highlight(containerRef.current, currentNoteIndex, 'cursor');
        } else {
          highlight(containerRef.current, -1, 'cursor'); // Clear all highlights
        }
      }
    };

    doHighlight();
  }, [currentNoteIndex, isPlaying, selectedNoteIndex]);

  // Convert Y position to MIDI note
  const yToMidi = useCallback((y: number): number => {
    if (!staffInfo) return 60; // Default to middle C

    const { lineSpacing, topLineY } = staffInfo;
    // Each half-space is one semitone in diatonic terms, but we need chromatic
    // Top line is F5 (MIDI 77), each space down is one diatonic step
    const halfSpaces = (y - topLineY) / (lineSpacing / 2);

    // Map to MIDI: F5=77, E5=76, D5=74, C5=72, B4=71, A4=69, G4=67, F4=65, E4=64
    // This is approximate - we use chromatic mapping
    const diatonicSteps = Math.round(halfSpaces);

    // F5 = 77, going down diatonically
    const diatonicToChromatic = [0, -1, -3, -5, -6, -8, -10, -12, -13, -15, -17, -18, -20, -22];
    const baseNote = 77; // F5

    if (diatonicSteps >= 0 && diatonicSteps < diatonicToChromatic.length) {
      return baseNote + diatonicToChromatic[diatonicSteps];
    } else if (diatonicSteps < 0) {
      // Above the staff
      return Math.min(96, baseNote - diatonicSteps);
    } else {
      // Below the staff
      return Math.max(36, baseNote - Math.floor(diatonicSteps * 1.5));
    }
  }, [staffInfo]);

  // Convert X position to beat
  const xToBeat = useCallback((x: number, y: number): number => {
    if (!staffInfo) return allNotes.length > 0 ? allNotes[allNotes.length - 1].startBeat + 1 : 0;

    const { measurePositions } = staffInfo;

    // Find which measure was clicked based on position
    let measureIndex = 0;
    let relativeX = x;

    if (measurePositions.length > 0) {
      // Find the measure that contains this click
      for (let i = 0; i < measurePositions.length; i++) {
        const measure = measurePositions[i];
        // Check if click is within this measure's bounds (with some tolerance for y)
        if (x >= measure.x && x <= measure.x + measure.width) {
          // Check if y is close to this measure's y position (within a line height)
          if (Math.abs(y - measure.y) < 100) {
            measureIndex = i;
            relativeX = x - measure.x;
            break;
          }
        }
      }

      // Calculate beat within the measure
      const measureWidth = measurePositions[measureIndex]?.width || 200;
      const beatInMeasure = (relativeX / measureWidth) * beatsPerMeasure;
      const totalBeat = measureIndex * beatsPerMeasure + beatInMeasure;

      return Math.max(0, Math.round(totalBeat * 4) / 4); // Quantize to quarter beat
    }

    // Fallback: simple calculation
    const { staveStartX, staveWidth } = staffInfo;
    const simpleRelativeX = x - staveStartX;
    const visibleMeasures = Math.max(1, measures.length || 1);
    const totalBeats = visibleMeasures * beatsPerMeasure;
    const beat = (simpleRelativeX / staveWidth) * totalBeats;

    return Math.max(0, Math.round(beat * 4) / 4);
  }, [staffInfo, measures.length, beatsPerMeasure, allNotes]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const target = e.target as SVGElement;
    const noteEl = target.closest('.vf-stavenote') as SVGElement | null;
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (noteEl) {
      // Clicked on an existing note
      const noteIndex = parseInt(noteEl.getAttribute('data-note-index') || '-1');
      if (noteIndex >= 0 && noteIndex < allNotes.length) {
        e.preventDefault();

        if (editMode === 'select') {
          // Select the note
          onNoteSelect?.(noteIndex);
        }

        // Enable dragging for pitch change
        if (onNoteChange) {
          const midi = allNotes[noteIndex].midi;
          setDragState({
            noteIndex,
            startY: e.clientY,
            startMidi: midi,
            currentMidi: midi,
          });
          noteEl.style.fill = '#3b82f6';
          onPlayNote?.(midi);
        }
      }
    } else if (editMode === 'add' && onNoteAdd) {
      // Clicked on empty staff area - add a note
      e.preventDefault();
      const midi = staffInfo ? yToMidi(y) : 60; // Default to middle C if no staff info
      const beat = staffInfo ? xToBeat(x, y) : 0;

      onPlayNote?.(midi);
      onNoteAdd(midi, beat);
    } else if (editMode === 'select') {
      // Clicked on empty area in select mode - deselect
      onNoteSelect?.(null);
    }
  }, [allNotes, onNoteChange, onPlayNote, onNoteAdd, onNoteSelect, editMode, staffInfo, yToMidi, xToBeat]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragState || !onNoteChange) return;

    const deltaY = dragState.startY - e.clientY;
    // Each 10px of movement = 1 semitone
    const semitoneDelta = Math.round(deltaY / 10);
    const newMidi = Math.max(21, Math.min(108, dragState.startMidi + semitoneDelta));

    if (newMidi !== dragState.currentMidi) {
      onPlayNote?.(newMidi);
      setDragState(prev => prev ? { ...prev, currentMidi: newMidi } : null);
      onNoteChange(dragState.noteIndex, newMidi);
    }
  }, [dragState, onNoteChange, onPlayNote]);

  const handleMouseUp = useCallback(() => {
    if (dragState && containerRef.current) {
      const noteEl = containerRef.current.querySelector(
        `[data-note-index="${dragState.noteIndex}"]`
      ) as SVGElement | null;
      if (noteEl) {
        noteEl.style.fill = '';
      }
      onStopNote?.();

      // If we didn't change pitch, treat as a click for selection/seek
      if (dragState.startMidi === dragState.currentMidi) {
        if (editMode === 'select') {
          onNoteSelect?.(dragState.noteIndex);
        }
        onSeek?.(dragState.noteIndex);
      }
    }
    setDragState(null);
  }, [dragState, onStopNote, onSeek, onNoteSelect, editMode]);

  const handleMouseLeave = useCallback(() => {
    if (dragState) {
      handleMouseUp();
    }
  }, [dragState, handleMouseUp]);


  if (error) {
    return (
      <div className="w-full h-48 flex items-center justify-center bg-red-50 dark:bg-red-950 rounded-lg">
        <p className="text-red-500">{error}</p>
      </div>
    );
  }

  return (
    <div className="w-full bg-white rounded-lg border border-zinc-200 dark:border-zinc-700 p-4 overflow-x-auto relative">
      {isRendering && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/50 z-10">
          <div className="animate-pulse text-zinc-500">Rendering score...</div>
        </div>
      )}
      {measures.length === 0 && !isRendering && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <p className="text-zinc-400 dark:text-zinc-500 bg-white/80 px-4 py-2 rounded">
            {editMode === 'add'
              ? 'Click on the staff to add notes'
              : 'Upload audio or switch to Add mode'}
          </p>
        </div>
      )}
      <div
        ref={containerRef}
        className={`min-h-[200px] [&_svg]:max-w-full select-none ${
          editMode === 'add' ? 'cursor-crosshair' : 'cursor-default'
        }`}
        style={{ minWidth: '600px' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      />
    </div>
  );
}
