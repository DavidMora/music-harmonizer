/**
 * Dynamics Analysis
 *
 * Extracts velocity/dynamics information from audio segments.
 * Maps RMS energy to MIDI velocity values.
 */

export interface DynamicsAnalyzerOptions {
  sampleRate: number;
  minVelocity?: number;     // Minimum MIDI velocity
  maxVelocity?: number;     // Maximum MIDI velocity
  referenceRMS?: number;    // Reference RMS for velocity=100
}

export interface VelocityInfo {
  velocity: number;         // MIDI velocity 1-127
  rms: number;              // Raw RMS value
  peak: number;             // Peak amplitude
}

export interface DynamicsResult {
  velocities: VelocityInfo[];  // Velocity for each segment
  globalDynamicRange: number;  // Dynamic range in dB
  averageVelocity: number;     // Average velocity across all segments
}

/**
 * Calculate velocity/dynamics for audio segments bounded by onset times
 */
export function analyzeDynamics(
  audioData: Float32Array,
  onsets: number[],
  duration: number,
  options: DynamicsAnalyzerOptions
): DynamicsResult {
  const {
    sampleRate,
    minVelocity = 30,
    maxVelocity = 120,
  } = options;

  if (onsets.length === 0) {
    return {
      velocities: [],
      globalDynamicRange: 0,
      averageVelocity: 80,
    };
  }

  // Calculate RMS for each onset-bounded segment
  const segmentRMS: number[] = [];
  const segmentPeaks: number[] = [];

  for (let i = 0; i < onsets.length; i++) {
    const startTime = onsets[i];
    const endTime = i < onsets.length - 1 ? onsets[i + 1] : duration;

    const startSample = Math.floor(startTime * sampleRate);
    const endSample = Math.min(Math.floor(endTime * sampleRate), audioData.length);

    // Focus on attack portion (first 50ms) for velocity estimation
    const attackEnd = Math.min(startSample + Math.floor(0.05 * sampleRate), endSample);

    const { rms, peak } = calculateSegmentEnergy(audioData, startSample, attackEnd);
    segmentRMS.push(rms);
    segmentPeaks.push(peak);
  }

  // Find reference RMS (use median to avoid outliers)
  const sortedRMS = [...segmentRMS].sort((a, b) => a - b);
  const referenceRMS = sortedRMS[Math.floor(sortedRMS.length * 0.75)] || 0.1;

  // Map RMS to velocity
  const velocities: VelocityInfo[] = segmentRMS.map((rms, i) => {
    const velocity = mapRMSToVelocity(rms, referenceRMS, minVelocity, maxVelocity);
    return {
      velocity,
      rms,
      peak: segmentPeaks[i],
    };
  });

  // Calculate global dynamic range
  const maxRMS = Math.max(...segmentRMS);
  const minRMS = Math.min(...segmentRMS.filter(r => r > 0));
  const dynamicRangeDB = minRMS > 0 ? 20 * Math.log10(maxRMS / minRMS) : 0;

  // Calculate average velocity
  const avgVelocity = velocities.reduce((sum, v) => sum + v.velocity, 0) / velocities.length;

  return {
    velocities,
    globalDynamicRange: dynamicRangeDB,
    averageVelocity: Math.round(avgVelocity),
  };
}

/**
 * Calculate RMS and peak for a segment of audio
 */
function calculateSegmentEnergy(
  audioData: Float32Array,
  startSample: number,
  endSample: number
): { rms: number; peak: number } {
  if (startSample >= endSample || startSample >= audioData.length) {
    return { rms: 0, peak: 0 };
  }

  let sumSquares = 0;
  let peak = 0;
  let count = 0;

  for (let i = startSample; i < endSample && i < audioData.length; i++) {
    const sample = audioData[i];
    sumSquares += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
    count++;
  }

  const rms = count > 0 ? Math.sqrt(sumSquares / count) : 0;
  return { rms, peak };
}

/**
 * Map RMS energy to MIDI velocity using logarithmic scaling
 * This better matches human perception of loudness
 */
function mapRMSToVelocity(
  rms: number,
  referenceRMS: number,
  minVelocity: number,
  maxVelocity: number
): number {
  if (rms <= 0 || referenceRMS <= 0) {
    return minVelocity;
  }

  // Logarithmic scaling: velocity = base + range * log(rms/threshold)
  // Reference RMS maps to velocity ~100
  const ratio = rms / referenceRMS;

  // Use logarithmic scaling for natural loudness perception
  // Map ratio 0.1 -> minVelocity, 1.0 -> 100, 2.0 -> maxVelocity
  const logRatio = Math.log10(ratio);

  // Scale to velocity range
  // logRatio of -1 (ratio=0.1) -> minVelocity
  // logRatio of 0 (ratio=1.0) -> 100
  // logRatio of 0.3 (ratio=2.0) -> maxVelocity
  const normalizedVelocity = 100 + logRatio * 40;

  return Math.round(Math.max(minVelocity, Math.min(maxVelocity, normalizedVelocity)));
}

/**
 * Detect crescendos and decrescendos in the velocity sequence
 */
export function detectDynamicContours(
  velocities: VelocityInfo[],
  minLength: number = 3,
  minChange: number = 20
): Array<{ type: 'crescendo' | 'decrescendo'; startIndex: number; endIndex: number; change: number }> {
  const contours: Array<{ type: 'crescendo' | 'decrescendo'; startIndex: number; endIndex: number; change: number }> = [];

  if (velocities.length < minLength) {
    return contours;
  }

  let trendStart = 0;
  let trendDirection: 'up' | 'down' | null = null;

  for (let i = 1; i < velocities.length; i++) {
    const diff = velocities[i].velocity - velocities[i - 1].velocity;
    const currentDirection = diff > 5 ? 'up' : diff < -5 ? 'down' : null;

    if (currentDirection === null) {
      // No significant change, continue
      continue;
    }

    if (trendDirection === null) {
      // Start new trend
      trendDirection = currentDirection;
      trendStart = i - 1;
    } else if (currentDirection !== trendDirection) {
      // Trend changed, check if previous trend was significant
      const length = i - trendStart;
      const totalChange = velocities[i - 1].velocity - velocities[trendStart].velocity;

      if (length >= minLength && Math.abs(totalChange) >= minChange) {
        contours.push({
          type: trendDirection === 'up' ? 'crescendo' : 'decrescendo',
          startIndex: trendStart,
          endIndex: i - 1,
          change: totalChange,
        });
      }

      // Start new trend
      trendDirection = currentDirection;
      trendStart = i - 1;
    }
  }

  // Check final trend
  const length = velocities.length - trendStart;
  const totalChange = velocities[velocities.length - 1].velocity - velocities[trendStart].velocity;

  if (trendDirection !== null && length >= minLength && Math.abs(totalChange) >= minChange) {
    contours.push({
      type: trendDirection === 'up' ? 'crescendo' : 'decrescendo',
      startIndex: trendStart,
      endIndex: velocities.length - 1,
      change: totalChange,
    });
  }

  return contours;
}
