/**
 * Onset Detection using Spectral Flux
 *
 * Detects note attack points by analyzing the rate of change in spectral energy.
 * Uses an adaptive threshold to handle varying dynamics.
 */

export interface OnsetDetectorOptions {
  sampleRate: number;
  windowSize?: number;      // FFT window size
  hopSize?: number;         // Hop size between frames
  threshold?: number;       // Base threshold multiplier (k in mean + k*std)
  minOnsetGap?: number;     // Minimum gap between onsets in seconds
}

export interface OnsetResult {
  onsets: number[];         // Onset times in seconds
  spectralFlux: number[];   // Raw spectral flux values
}

/**
 * Detect onsets using spectral flux
 */
export function detectOnsets(
  audioData: Float32Array,
  options: OnsetDetectorOptions
): OnsetResult {
  const {
    sampleRate,
    windowSize = 2048,
    hopSize = 512,
    threshold = 1.5,
    minOnsetGap = 0.05,  // 50ms minimum between onsets
  } = options;

  // Calculate spectral flux for each frame
  const spectralFlux = calculateSpectralFlux(audioData, windowSize, hopSize);

  // Pick peaks using adaptive threshold
  const onsetFrames = pickPeaks(spectralFlux, threshold, minOnsetGap, hopSize, sampleRate);

  // Convert frame indices to time in seconds
  const onsets = onsetFrames.map(frame => (frame * hopSize) / sampleRate);

  return { onsets, spectralFlux };
}

/**
 * Calculate spectral flux: the sum of positive differences between consecutive spectra
 */
function calculateSpectralFlux(
  audioData: Float32Array,
  windowSize: number,
  hopSize: number
): number[] {
  const numFrames = Math.floor((audioData.length - windowSize) / hopSize) + 1;
  const spectralFlux: number[] = [];

  let prevMagnitudes: Float32Array | null = null;

  for (let frame = 0; frame < numFrames; frame++) {
    const start = frame * hopSize;
    const windowData = audioData.slice(start, start + windowSize);

    // Apply Hann window
    const windowed = applyHannWindow(windowData);

    // Calculate magnitude spectrum (simplified FFT using autocorrelation approach)
    const magnitudes = calculateMagnitudeSpectrum(windowed);

    if (prevMagnitudes !== null) {
      // Calculate spectral flux: sum of positive differences
      let flux = 0;
      for (let i = 0; i < magnitudes.length; i++) {
        const diff = magnitudes[i] - prevMagnitudes[i];
        if (diff > 0) {
          flux += diff;
        }
      }
      spectralFlux.push(flux);
    } else {
      spectralFlux.push(0);
    }

    prevMagnitudes = magnitudes;
  }

  return spectralFlux;
}

/**
 * Apply Hann window to reduce spectral leakage
 */
function applyHannWindow(samples: Float32Array): Float32Array {
  const windowed = new Float32Array(samples.length);
  const n = samples.length;

  for (let i = 0; i < n; i++) {
    const window = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
    windowed[i] = samples[i] * window;
  }

  return windowed;
}

/**
 * Calculate magnitude spectrum using DFT
 * For onset detection, we only need frequency bins up to ~5kHz
 */
function calculateMagnitudeSpectrum(samples: Float32Array): Float32Array {
  const n = samples.length;
  // Only compute bins up to Nyquist/4 for efficiency (still captures attack transients)
  const numBins = Math.min(256, Math.floor(n / 4));
  const magnitudes = new Float32Array(numBins);

  for (let k = 0; k < numBins; k++) {
    let real = 0;
    let imag = 0;
    const freq = (2 * Math.PI * k) / n;

    for (let i = 0; i < n; i++) {
      real += samples[i] * Math.cos(freq * i);
      imag -= samples[i] * Math.sin(freq * i);
    }

    magnitudes[k] = Math.sqrt(real * real + imag * imag);
  }

  return magnitudes;
}

/**
 * Pick peaks in spectral flux using adaptive threshold
 */
function pickPeaks(
  spectralFlux: number[],
  thresholdMultiplier: number,
  minOnsetGap: number,
  hopSize: number,
  sampleRate: number
): number[] {
  if (spectralFlux.length === 0) return [];

  const onsets: number[] = [];
  const minGapFrames = Math.floor((minOnsetGap * sampleRate) / hopSize);

  // Calculate local adaptive threshold using moving average and standard deviation
  const windowHalf = 10; // Look at ~10 frames on each side

  for (let i = 1; i < spectralFlux.length - 1; i++) {
    // Check if this is a local peak
    if (spectralFlux[i] <= spectralFlux[i - 1] || spectralFlux[i] <= spectralFlux[i + 1]) {
      continue;
    }

    // Calculate local statistics for adaptive threshold
    const windowStart = Math.max(0, i - windowHalf);
    const windowEnd = Math.min(spectralFlux.length, i + windowHalf + 1);

    let sum = 0;
    let sumSq = 0;
    let count = 0;

    for (let j = windowStart; j < windowEnd; j++) {
      sum += spectralFlux[j];
      sumSq += spectralFlux[j] * spectralFlux[j];
      count++;
    }

    const mean = sum / count;
    const variance = sumSq / count - mean * mean;
    const stddev = Math.sqrt(Math.max(0, variance));

    // Adaptive threshold: mean + k * stddev
    const adaptiveThreshold = mean + thresholdMultiplier * stddev;

    // Check if peak exceeds threshold
    if (spectralFlux[i] > adaptiveThreshold) {
      // Check minimum gap from previous onset
      if (onsets.length === 0 || i - onsets[onsets.length - 1] >= minGapFrames) {
        onsets.push(i);
      } else if (spectralFlux[i] > spectralFlux[onsets[onsets.length - 1]]) {
        // Replace previous onset if this one is stronger
        onsets[onsets.length - 1] = i;
      }
    }
  }

  return onsets;
}

/**
 * Refine onset times using local energy minimum search
 * Adjusts onset times to the actual attack point
 */
export function refineOnsets(
  audioData: Float32Array,
  onsets: number[],
  sampleRate: number,
  searchWindow: number = 0.02 // 20ms search window
): number[] {
  const searchSamples = Math.floor(searchWindow * sampleRate);

  return onsets.map(onsetTime => {
    const sampleIndex = Math.floor(onsetTime * sampleRate);
    const searchStart = Math.max(0, sampleIndex - searchSamples);
    const searchEnd = Math.min(audioData.length, sampleIndex + Math.floor(searchSamples / 2));

    // Find local energy minimum just before the attack
    let minEnergy = Infinity;
    let minIndex = sampleIndex;
    const windowSize = 64;

    for (let i = searchStart; i < searchEnd - windowSize; i += 16) {
      let energy = 0;
      for (let j = 0; j < windowSize; j++) {
        energy += audioData[i + j] * audioData[i + j];
      }

      if (energy < minEnergy) {
        minEnergy = energy;
        minIndex = i;
      }
    }

    return minIndex / sampleRate;
  });
}
