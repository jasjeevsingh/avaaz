/**
 * Plays linear16 PCM chunks streamed from the agent, back-to-back.
 * `drop()` exists because AgentLiveClient has no clear() — when the student
 * interrupts, stopping our own queued audio is the only thing that actually
 * makes the helper stop talking.
 */
export function createAudioQueue(ctx: AudioContext, sampleRate = 24000) {
  let sources: { stop(): void }[] = [];
  let cursor = 0;

  function push(pcm: ArrayBuffer): void {
    if (pcm.byteLength < 2) return;
    // PCM can arrive split at any byte boundary over the socket; Int16Array
    // requires an even length, so drop a stray trailing byte rather than throw.
    const evenLength = pcm.byteLength - (pcm.byteLength % 2);
    const ints = new Int16Array(pcm.slice(0, evenLength));
    const buffer = ctx.createBuffer(1, ints.length, sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < ints.length; i++) channel[i] = ints[i] / 32768;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    const startAt = Math.max(ctx.currentTime, cursor);
    source.start(startAt);
    cursor = startAt + ints.length / sampleRate;
    sources.push(source);
    source.onended = () => {
      sources = sources.filter((s) => s !== source);
    };
  }

  function drop(): void {
    for (const s of sources) {
      try {
        s.stop();
      } catch {
        // already finished
      }
    }
    sources = [];
    cursor = 0;
  }

  function close(): void {
    drop();
    // The owner may close the context too; a second close() rejects.
    if (ctx.state !== "closed") void ctx.close?.().catch(() => {});
  }

  return { push, drop, close };
}
