import type { QuantizedNote, NoteDuration } from '@/types/music';

// VexFlow duration codes (d suffix = dotted)
const DURATION_CODES: Record<NoteDuration, string> = {
  'whole-dotted': 'wd',
  'whole': 'w',
  'half-dotted': 'hd',
  'half': 'h',
  'quarter-dotted': 'qd',
  'quarter': 'q',
  'eighth-dotted': '8d',
  'eighth': '8',
  'sixteenth': '16',
};

// Minimum width per note type to ensure readability
const MIN_NOTE_WIDTH: Record<NoteDuration, number> = {
  'whole-dotted': 100,
  'whole': 80,
  'half-dotted': 75,
  'half': 60,
  'quarter-dotted': 50,
  'quarter': 40,
  'eighth-dotted': 35,
  'eighth': 30,
  'sixteenth': 25,
};

interface RenderOptions {
  width?: number;
  beatsPerMeasure?: number;
  keySignature?: string;
  singleLine?: boolean; // DAW mode: render all measures on one horizontal line
  compactHeight?: boolean; // Reduce vertical spacing for multi-track view
}

export async function renderScore(
  container: HTMLDivElement,
  measures: QuantizedNote[][],
  options: RenderOptions = {}
): Promise<void> {
  const VexFlow = await import('vexflow');
  const { Renderer, Stave, StaveNote, Voice, Formatter, Accidental, BarlineType, Dot } = VexFlow.default;

  const { width = 800, beatsPerMeasure = 4, keySignature = 'C', singleLine = false, compactHeight = false } = options;

  container.innerHTML = '';

  // Empty state
  if (measures.length === 0 || measures.every(m => m.length === 0)) {
    const renderer = new Renderer(container, Renderer.Backends.SVG);
    renderer.resize(width, 150);
    const context = renderer.getContext();
    const stave = new Stave(10, 40, width - 20);
    stave.addClef('treble').addKeySignature(keySignature).addTimeSignature(`${beatsPerMeasure}/4`);
    stave.setContext(context).draw();
    return;
  }

  // Calculate required width for each measure based on note count and types
  const measureWidths = measures.map((measure) => {
    if (measure.length === 0) return 100; // Empty measure minimum

    let totalWidth = 0;
    for (const note of measure) {
      totalWidth += MIN_NOTE_WIDTH[note.duration] || 35;
    }
    // Add padding for bar lines and spacing
    return Math.max(totalWidth + 40, 120);
  });

  // Layout: determine which measures go on each line
  const clefKeyTimeWidth = 110; // Extra space for clef, key sig, time sig on first measure
  const clefWidth = 50; // Just clef on subsequent lines
  const lineMargin = 20; // Left/right margin
  const availableLineWidth = width - lineMargin;

  interface LineInfo {
    measureIndices: number[];
    totalWidth: number;
  }

  const lines: LineInfo[] = [];

  if (singleLine) {
    // DAW mode: all measures on one line
    const totalMeasureWidth = measureWidths.reduce((sum, w) => sum + w, 0);
    lines.push({
      measureIndices: measures.map((_, i) => i),
      totalWidth: clefKeyTimeWidth + totalMeasureWidth,
    });
  } else {
    // Normal mode: wrap lines based on available width
    let currentLine: LineInfo = { measureIndices: [], totalWidth: clefKeyTimeWidth };

    for (let i = 0; i < measures.length; i++) {
      const neededWidth = measureWidths[i];
      const isFirstLine = lines.length === 0;
      const lineStartWidth = isFirstLine ? clefKeyTimeWidth : clefWidth;

      // Check if measure fits on current line
      if (currentLine.measureIndices.length === 0) {
        // First measure on line always fits
        currentLine.measureIndices.push(i);
        currentLine.totalWidth = lineStartWidth + neededWidth;
      } else if (currentLine.totalWidth + neededWidth <= availableLineWidth) {
        // Measure fits
        currentLine.measureIndices.push(i);
        currentLine.totalWidth += neededWidth;
      } else {
        // Start new line
        lines.push(currentLine);
        currentLine = {
          measureIndices: [i],
          totalWidth: clefWidth + neededWidth,
        };
      }
    }

    // Don't forget the last line
    if (currentLine.measureIndices.length > 0) {
      lines.push(currentLine);
    }
  }

  // Calculate total height
  const lineHeight = compactHeight ? 110 : 120;
  const topMargin = compactHeight ? 25 : 30;
  const totalHeight = topMargin + lines.length * lineHeight + (compactHeight ? 25 : 20);

  // Calculate actual width needed
  const actualWidth = singleLine ? lines[0].totalWidth + lineMargin : width;

  const renderer = new Renderer(container, Renderer.Backends.SVG);
  renderer.resize(actualWidth, totalHeight);
  const context = renderer.getContext();
  context.setFont('Arial', 10);

  // Set default colors - black notes on white background
  const svg = container.querySelector('svg');
  if (svg) {
    svg.style.backgroundColor = 'white';
  }
  context.setFillStyle('#000000');
  context.setStrokeStyle('#000000');

  // Render each line
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const yPosition = topMargin + lineIndex * lineHeight;
    const isFirstLine = lineIndex === 0;

    // In singleLine mode, don't scale - use natural widths
    // In normal mode, scale to fill available width
    const lineScale = singleLine ? 1 : Math.min(1.3, availableLineWidth / line.totalWidth);

    let xPosition = 10;

    for (let i = 0; i < line.measureIndices.length; i++) {
      const measureIndex = line.measureIndices[i];
      const measure = measures[measureIndex];
      const isFirstInLine = i === 0;
      const isLastMeasure = measureIndex === measures.length - 1;

      // Calculate measure width
      let measureWidth = measureWidths[measureIndex];
      if (isFirstInLine) {
        const extraWidth = isFirstLine ? clefKeyTimeWidth : clefWidth;
        measureWidth = measureWidths[measureIndex] + extraWidth;
      }

      // Scale (only in non-singleLine mode)
      measureWidth *= lineScale;

      // Create stave
      const stave = new Stave(xPosition, yPosition, measureWidth);

      if (isFirstInLine) {
        stave.addClef('treble');
        if (isFirstLine) {
          stave.addKeySignature(keySignature);
          stave.addTimeSignature(`${beatsPerMeasure}/4`);
        }
      }

      if (isLastMeasure) {
        stave.setEndBarType(BarlineType.END);
      }

      stave.setContext(context).draw();

      // Draw notes if any
      if (measure.length > 0) {
        try {
          const vexNotes = measure.map((note) => {
            const vexKey = convertToVexFlowKey(note.noteName);
            const durationCode = DURATION_CODES[note.duration] || 'q';
            const isDotted = note.duration.includes('dotted');

            const staveNote = new StaveNote({
              keys: [vexKey],
              duration: durationCode,
              autoStem: true,
            });

            // Add dot for dotted notes
            if (isDotted) {
              Dot.buildAndAttach([staveNote], { all: true });
            }

            // Add accidentals
            if (note.noteName.includes('#')) {
              staveNote.addModifier(new Accidental('#'), 0);
            } else if (note.noteName.includes('b')) {
              staveNote.addModifier(new Accidental('b'), 0);
            }

            return staveNote;
          });

          // Create voice - use soft mode to avoid strict timing
          const voice = new Voice({
            numBeats: beatsPerMeasure,
            beatValue: 4,
          }).setStrict(false);

          voice.addTickables(vexNotes);

          // Format with proper spacing
          const formatter = new Formatter();
          formatter.joinVoices([voice]);

          // Calculate available space for notes (account for clef/key/time on first measures)
          let noteAreaStart = 15;
          if (isFirstInLine && isFirstLine) {
            noteAreaStart = 95;
          } else if (isFirstInLine) {
            noteAreaStart = 45;
          }

          const noteSpace = measureWidth - noteAreaStart - 15;
          formatter.format([voice], Math.max(noteSpace, 80));

          voice.draw(context, stave);
        } catch (err) {
          console.error('Error rendering measure', measureIndex, err);
        }
      }

      xPosition += measureWidth;
    }
  }
}

function convertToVexFlowKey(noteName: string): string {
  const match = noteName.match(/^([A-G])(#|b)?(-?\d+)$/);
  if (!match) {
    console.warn('Invalid note name:', noteName);
    return 'c/4';
  }

  const [, note, accidental, octave] = match;
  const vexNote = note.toLowerCase() + (accidental || '');
  return `${vexNote}/${octave}`;
}

export function highlightNote(
  container: HTMLDivElement,
  noteIndex: number,
  type: 'playback' | 'cursor' | 'selected' = 'playback'
): void {
  const notes = container.querySelectorAll('.vf-stavenote');
  notes.forEach((note) => {
    (note as SVGElement).style.fill = '';
  });

  if (noteIndex >= 0 && noteIndex < notes.length) {
    // Blue for playback, orange for cursor, green for selected
    const colors = {
      playback: '#3b82f6',
      cursor: '#f97316',
      selected: '#10b981',
    };
    (notes[noteIndex] as SVGElement).style.fill = colors[type];
  }
}
