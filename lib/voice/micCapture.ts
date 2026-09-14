/**
 * Opens the microphone and streams 16 kHz linear16 PCM frames to `onPcm`.
 * Returns a handle whose stop() releases everything (so the browser's
 * recording indicator turns off). Throws if permission is denied.
 */
export async function startMicCapture(onPcm: (pcm: ArrayBuffer) => void): Promise<{ stop: () => void }> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
  });
  const audioContext = new AudioContext({ sampleRate: 16000 });
  const source = audioContext.createMediaStreamSource(stream);
  const processor = audioContext.createScriptProcessor(4096, 1, 1);
  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    const int16 = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const sample = Math.max(-1, Math.min(1, input[i]));
      int16[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    onPcm(int16.buffer);
  };
  source.connect(processor);
  processor.connect(audioContext.destination);
  return {
    stop() {
      processor.onaudioprocess = null;
      processor.disconnect();
      source.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      void audioContext.close();
    },
  };
}
