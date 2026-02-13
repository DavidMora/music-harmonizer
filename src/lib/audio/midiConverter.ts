const A4_FREQUENCY = 440;
const A4_MIDI = 69;

export function frequencyToMidi(frequency: number): number {
  if (frequency <= 0) return -1;
  return Math.round(12 * Math.log2(frequency / A4_FREQUENCY) + A4_MIDI);
}

export function midiToFrequency(midi: number): number {
  return A4_FREQUENCY * Math.pow(2, (midi - A4_MIDI) / 12);
}

export function isValidMidiNote(midi: number): boolean {
  return midi >= 0 && midi <= 127;
}

// Convert cents deviation from perfect pitch
export function getCentsDeviation(frequency: number, targetMidi: number): number {
  const targetFrequency = midiToFrequency(targetMidi);
  return 1200 * Math.log2(frequency / targetFrequency);
}
