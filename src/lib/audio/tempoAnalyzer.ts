/**
 * Tempo Analysis using Inter-Onset Intervals (IOI)
 *
 * Automatically detects BPM by analyzing the distribution of time intervals
 * between detected onsets.
 */

export interface TempoAnalyzerOptions {
  minBPM?: number;          // Minimum expected BPM
  maxBPM?: number;          // Maximum expected BPM
  histogramBinSize?: number; // IOI histogram bin size in seconds
}

export interface TempoResult {
  bpm: number;              // Detected tempo in BPM
  confidence: number;       // Confidence score 0-1
  alternativeBPMs: number[]; // Other possible tempos (half/double time)
}

/**
 * Detect tempo from onset times
 */
export function analyzeTempo(
  onsets: number[],
  options: TempoAnalyzerOptions = {}
): TempoResult {
  const {
    minBPM = 60,
    maxBPM = 180,
    histogramBinSize = 0.01, // 10ms bins
  } = options;

  // Need at least 4 onsets to detect tempo
  if (onsets.length < 4) {
    return {
      bpm: 120, // Default fallback
      confidence: 0,
      alternativeBPMs: [60, 240],
    };
  }

  // Calculate inter-onset intervals
  const iois = calculateIOIs(onsets);

  // Build histogram of IOIs
  const histogram = buildIOIHistogram(iois, histogramBinSize, minBPM, maxBPM);

  // Find dominant IOI from histogram peaks
  const { dominantIOI, confidence } = findDominantIOI(histogram, histogramBinSize, minBPM, maxBPM);

  // Convert IOI to BPM
  const bpm = 60 / dominantIOI;

  // Calculate alternative tempos (half-time, double-time)
  const alternativeBPMs = [
    Math.round(bpm / 2),
    Math.round(bpm * 2),
  ].filter(b => b >= minBPM && b <= maxBPM * 2);

  return {
    bpm: Math.round(bpm),
    confidence,
    alternativeBPMs,
  };
}

/**
 * Calculate inter-onset intervals from onset times
 */
function calculateIOIs(onsets: number[]): number[] {
  const iois: number[] = [];

  for (let i = 1; i < onsets.length; i++) {
    const ioi = onsets[i] - onsets[i - 1];
    // Only consider reasonable IOIs (between 0.1s and 2s, i.e., 30-600 BPM range)
    if (ioi >= 0.1 && ioi <= 2.0) {
      iois.push(ioi);
    }
  }

  // Also consider intervals between non-consecutive onsets (for missing onsets)
  for (let i = 2; i < onsets.length; i++) {
    const ioi = (onsets[i] - onsets[i - 2]) / 2;
    if (ioi >= 0.1 && ioi <= 2.0) {
      iois.push(ioi);
    }
  }

  return iois;
}

/**
 * Build histogram of IOI values
 */
function buildIOIHistogram(
  iois: number[],
  binSize: number,
  minBPM: number,
  maxBPM: number
): Map<number, number> {
  const histogram = new Map<number, number>();

  // IOI range: from maxBPM (short interval) to minBPM (long interval)
  const minIOI = 60 / maxBPM; // ~0.33s at 180 BPM
  const maxIOI = 60 / minBPM; // ~1.0s at 60 BPM

  for (const ioi of iois) {
    if (ioi < minIOI || ioi > maxIOI) continue;

    // Quantize to bin
    const bin = Math.round(ioi / binSize) * binSize;
    histogram.set(bin, (histogram.get(bin) || 0) + 1);
  }

  return histogram;
}

/**
 * Find the dominant IOI from histogram peaks
 * Uses peak picking with harmonic relationship awareness
 */
function findDominantIOI(
  histogram: Map<number, number>,
  binSize: number,
  minBPM: number,
  maxBPM: number
): { dominantIOI: number; confidence: number } {
  if (histogram.size === 0) {
    return { dominantIOI: 0.5, confidence: 0 }; // 120 BPM default
  }

  // Convert histogram to sorted array of peaks
  const peaks: Array<{ ioi: number; count: number }> = [];

  histogram.forEach((count, ioi) => {
    // Sum counts from neighboring bins for more robust peak detection
    let totalCount = count;
    totalCount += histogram.get(ioi - binSize) || 0;
    totalCount += histogram.get(ioi + binSize) || 0;
    peaks.push({ ioi, count: totalCount });
  });

  // Sort by count descending
  peaks.sort((a, b) => b.count - a.count);

  if (peaks.length === 0) {
    return { dominantIOI: 0.5, confidence: 0 };
  }

  // Get the top candidate
  const topPeak = peaks[0];

  // Calculate confidence based on how dominant the peak is
  const totalCounts = peaks.reduce((sum, p) => sum + p.count, 0);
  const confidence = Math.min(1, topPeak.count / (totalCounts * 0.3));

  // Check for harmonic relationships
  // If the second peak is exactly half or double the first, consider it
  if (peaks.length >= 2) {
    const ratio = peaks[1].ioi / topPeak.ioi;

    // If second peak is at double-time and has significant support
    if (Math.abs(ratio - 2) < 0.1 && peaks[1].count > topPeak.count * 0.5) {
      // Check if half-time makes more musical sense (prefer 60-120 BPM range)
      const bpm1 = 60 / topPeak.ioi;
      const bpm2 = 60 / peaks[1].ioi;

      if (bpm1 > 140 && bpm2 >= 60 && bpm2 <= 120) {
        return { dominantIOI: peaks[1].ioi, confidence: confidence * 0.9 };
      }
    }

    // If second peak is at half-time
    if (Math.abs(ratio - 0.5) < 0.05 && peaks[1].count > topPeak.count * 0.7) {
      const bpm1 = 60 / topPeak.ioi;
      const bpm2 = 60 / peaks[1].ioi;

      if (bpm2 >= 80 && bpm2 <= 140) {
        return { dominantIOI: peaks[1].ioi, confidence: confidence * 0.9 };
      }
    }
  }

  return { dominantIOI: topPeak.ioi, confidence };
}

/**
 * Refine BPM estimate using beat tracking
 * Aligns detected onsets to a tempo grid and finds best fit
 */
export function refineTempo(
  onsets: number[],
  initialBPM: number,
  tolerance: number = 5 // +/- 5 BPM search range
): number {
  if (onsets.length < 4) return initialBPM;

  let bestBPM = initialBPM;
  let bestScore = 0;

  // Search around initial estimate
  for (let bpm = initialBPM - tolerance; bpm <= initialBPM + tolerance; bpm += 0.5) {
    const beatDuration = 60 / bpm;
    let score = 0;

    // Score how well onsets align to beat grid
    for (const onset of onsets) {
      // Find distance to nearest beat
      const beatPhase = (onset % beatDuration) / beatDuration;
      // Use cosine similarity for phase alignment
      score += Math.cos(2 * Math.PI * beatPhase);
    }

    if (score > bestScore) {
      bestScore = score;
      bestBPM = bpm;
    }
  }

  return Math.round(bestBPM);
}
