/**
 * Mic capture worklet: Float32 frames in, 16-bit PCM frames out.
 *
 * This runs on the audio render thread, which is why it exists at all. The
 * deprecated ScriptProcessorNode ran on the main thread, so a React re-render
 * could stall audio capture and drop syllables mid-word. A worklet cannot be
 * blocked by anything the UI does.
 *
 * Resampling to 16 kHz is not done here — the AudioContext is constructed at
 * 16 kHz so the browser's own resampler handles it, which is both better
 * quality and cheaper than anything hand-rolled at this layer.
 */
class PcmRecorder extends AudioWorkletProcessor {
  constructor(options) {
    super();
    // 1024 samples at 16 kHz is 64 ms per message. Smaller frames cut latency
    // but multiply postMessage overhead; this is the same frame size the
    // Python reference client uses, and it sounds right.
    this.frameSize = options?.processorOptions?.frameSize ?? 1024;
    this.frame = new Int16Array(this.frameSize);
    this.offset = 0;
    this.muted = false;

    this.port.onmessage = (event) => {
      if (event.data?.type === "mute") this.muted = event.data.muted;
    };
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    // No input yet (device still opening) — stay alive and wait.
    if (!channel) return true;

    if (this.muted) {
      // Drop the audio but keep the node running. Tearing down and rebuilding
      // the graph on every mute toggle costs a device re-acquire, which is
      // audible as a gap when unmuting.
      this.offset = 0;
      return true;
    }

    let sumSquares = 0;

    for (let i = 0; i < channel.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, channel[i]));
      sumSquares += sample * sample;
      // Asymmetric scaling: int16 range is -32768..32767, so using 32767 for
      // negatives would clip the loudest troughs.
      this.frame[this.offset] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      this.offset += 1;

      if (this.offset === this.frameSize) {
        const copy = this.frame.slice();
        this.port.postMessage(
          { audio: copy.buffer, level: Math.sqrt(sumSquares / channel.length) },
          // Transfer rather than copy: this buffer crosses to the main thread
          // 15 times a second for the whole call.
          [copy.buffer],
        );
        this.offset = 0;
        sumSquares = 0;
      }
    }

    return true;
  }
}

registerProcessor("pcm-recorder", PcmRecorder);
