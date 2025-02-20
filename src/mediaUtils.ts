// Convert audio buffer to PCM 16-bit data
export function extractPcm16Data(buffer: AudioBuffer): ArrayBuffer {
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;
  const pcmData = new Int16Array(length);

  // Convert the float samples to PCM 16-bit (scaled between -32768 and 32767)
  for (let i = 0; i < length; i++) {
    const channelData = buffer.getChannelData(0);
    if (channelData) {
      const cdi = channelData[i];
      if (cdi) {
        pcmData[i] = Math.max(-32768, Math.min(32767, cdi * 32767));
      }
    }
  }

  // Convert Int16Array to a binary buffer (ArrayBuffer)
  const pcmBuffer = new ArrayBuffer(pcmData.length * 2); // 2 bytes per sample
  const pcmView = new DataView(pcmBuffer);

  for (let i = 0; i < pcmData.length; i++) {
    const pcmData_i = pcmData[i];
    if (pcmData_i) {
      pcmView.setInt16(i * 2, pcmData_i, true); // true means little-endian
    }
  }

  return pcmBuffer;
}

export async function getMicrophoneStream(): Promise<MediaStream> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false,
    });
    return stream;
  } catch (error) {
    console.error('Error accessing microphone:', error);
    throw error; // Re-throw the error to be handled upstream
  }
}
