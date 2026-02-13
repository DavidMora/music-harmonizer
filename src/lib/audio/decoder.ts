export async function decodeAudioFile(
  file: File,
  audioContext: AudioContext
): Promise<{ audioData: Float32Array; sampleRate: number; duration: number }> {
  const arrayBuffer = await file.arrayBuffer();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

  // Get mono audio data (average of all channels if stereo)
  const numberOfChannels = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;
  const audioData = new Float32Array(length);

  if (numberOfChannels === 1) {
    audioBuffer.copyFromChannel(audioData, 0);
  } else {
    // Mix down to mono
    const channels: Float32Array[] = [];
    for (let i = 0; i < numberOfChannels; i++) {
      const channelData = new Float32Array(length);
      audioBuffer.copyFromChannel(channelData, i);
      channels.push(channelData);
    }

    for (let i = 0; i < length; i++) {
      let sum = 0;
      for (let c = 0; c < numberOfChannels; c++) {
        sum += channels[c][i];
      }
      audioData[i] = sum / numberOfChannels;
    }
  }

  return {
    audioData,
    sampleRate: audioBuffer.sampleRate,
    duration: audioBuffer.duration,
  };
}
