/**
 * Browser audio plumbing for a live voice session.
 *
 * Two independent AudioContexts, because the Live API is asymmetric: it wants
 * 16 kHz in and emits 24 kHz out. Constructing each context at its native rate
 * lets the browser resample once, correctly, instead of us doing it badly in
 * JavaScript.
 */

import { INPUT_SAMPLE_RATE, OUTPUT_SAMPLE_RATE } from "./config";

/** Base64 for the SDK's audio blob. Chunked because `String.fromCharCode`
 *  applied to a whole buffer at once blows the argument limit. */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

type MicHandlers = {
  onAudio: (base64: string) => void;
  /** 0..1 RMS, for driving a waveform that reflects real speech. */
  onLevel?: (level: number) => void;
};

/**
 * Microphone → 16-bit PCM frames.
 */
export class MicCapture {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;

  async start({ onAudio, onLevel }: MicHandlers, deviceId?: string) {
    this.stream = await openMicrophone(deviceId);

    this.context = new AudioContext({ sampleRate: INPUT_SAMPLE_RATE });
    await this.context.audioWorklet.addModule("/live/pcm-recorder.js");

    this.source = this.context.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.context, "pcm-recorder", {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      processorOptions: { frameSize: 1024 },
    });

    this.node.port.onmessage = (event) => {
      const { audio, level } = event.data as { audio: ArrayBuffer; level: number };
      onAudio(toBase64(new Uint8Array(audio)));
      onLevel?.(level);
    };

    this.source.connect(this.node);
    // Deliberately not connected to destination: routing the mic to the
    // speakers would put the caller's own voice in their ear.
    if (this.context.state === "suspended") await this.context.resume();
  }

  setMuted(muted: boolean) {
    this.node?.port.postMessage({ type: "mute", muted });
  }

  async stop() {
    this.node?.port.close();
    this.source?.disconnect();
    this.node?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    await this.context?.close().catch(() => {});
    this.context = null;
    this.stream = null;
    this.node = null;
    this.source = null;
  }
}

/**
 * Opens a microphone with progressively looser constraints.
 *
 * Chrome on Linux (PulseAudio / PipeWire) throws `NotFoundError` with the
 * message "Requested device not found" when `channelCount: 1` or a bundle of
 * processing flags cannot be satisfied — even though a perfectly usable input
 * exists. Asking for "any audio" after that, then each enumerated device by
 * id, is what actually finds it.
 */
async function openMicrophone(deviceId?: string): Promise<MediaStream> {
  const attempts: MediaTrackConstraints[] = [];
  if (deviceId) attempts.push({ deviceId: { exact: deviceId } });
  attempts.push({
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  });
  // Bare `true` is the last structured try: no flags the driver can reject.
  attempts.push({});

  let last: Error | undefined;
  for (const audio of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: Object.keys(audio).length ? audio : true });
    } catch (error) {
      last = error instanceof Error ? error : new Error(String(error));
      if (!isMissingDevice(last)) throw last;
    }
  }

  const inputs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput");
  for (const input of inputs) {
    if (!input.deviceId || input.deviceId === "default") continue;
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: input.deviceId } },
      });
    } catch (error) {
      last = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw last ?? new Error("Requested device not found");
}

function isMissingDevice(error: Error) {
  const name = "name" in error ? String((error as DOMException).name) : "";
  return (
    name === "NotFoundError" ||
    name === "OverconstrainedError" ||
    /device not found|Overconstrained|could not start audio/i.test(error.message)
  );
}

/**
 * Plays the model's 24 kHz PCM as it streams in.
 *
 * The model emits many small chunks. Playing each one on arrival produces
 * audible clicks, because each `start()` lands at whatever the clock says
 * rather than exactly where the previous chunk ended. Instead we keep our own
 * playhead and schedule each chunk at the sample-accurate end of the last one.
 */
export class AudioPlayer {
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  // Explicitly backed by an ArrayBuffer, not the SharedArrayBuffer the loose
  // Float32Array type also permits, because getFloatTimeDomainData rejects
  // shared memory.
  private levelBuffer: Float32Array<ArrayBuffer> | null = null;
  private playhead = 0;
  private active = new Set<AudioBufferSourceNode>();
  private onSpeakingChange?: (speaking: boolean) => void;

  /** Small lead so the first chunk is scheduled slightly in the future rather
   *  than in the past, which would drop it entirely. */
  private static readonly LEAD_SECONDS = 0.08;

  async start(onSpeakingChange?: (speaking: boolean) => void) {
    this.onSpeakingChange = onSpeakingChange;
    this.context = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
    this.gain = this.context.createGain();

    // Tapped so the UI can show the agent's real amplitude while it speaks
    // rather than a decorative animation. On a test bench, a meter that moves
    // when no audio is playing is worse than no meter.
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 1024;
    this.levelBuffer = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4));

    this.gain.connect(this.analyser);
    this.analyser.connect(this.context.destination);

    // Autoplay policy: a context created outside a user gesture starts
    // suspended and stays silent with no error.
    if (this.context.state === "suspended") await this.context.resume();
    this.playhead = this.context.currentTime + AudioPlayer.LEAD_SECONDS;
  }

  /** RMS of what is coming out of the speaker right now, 0..1. */
  get level(): number {
    if (!this.analyser || !this.levelBuffer) return 0;
    this.analyser.getFloatTimeDomainData(this.levelBuffer);
    let sum = 0;
    for (let i = 0; i < this.levelBuffer.length; i += 1) {
      sum += this.levelBuffer[i] * this.levelBuffer[i];
    }
    return Math.sqrt(sum / this.levelBuffer.length);
  }

  enqueue(pcm: Uint8Array) {
    if (!this.context || !this.gain) return;

    // Int16 view needs an even, aligned buffer; a copy guarantees both.
    const samples = new Int16Array(pcm.length / 2);
    const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    for (let i = 0; i < samples.length; i += 1) {
      samples[i] = view.getInt16(i * 2, true); // Live API is little-endian.
    }

    const buffer = this.context.createBuffer(1, samples.length, OUTPUT_SAMPLE_RATE);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i += 1) {
      channel[i] = samples[i] / 0x8000;
    }

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gain);

    // If the model went quiet long enough for the playhead to fall behind the
    // clock, restart from now — otherwise we'd schedule in the past.
    const startAt = Math.max(this.playhead, this.context.currentTime + 0.02);
    source.start(startAt);
    this.playhead = startAt + buffer.duration;

    const wasIdle = this.active.size === 0;
    this.active.add(source);
    if (wasIdle) this.onSpeakingChange?.(true);

    source.onended = () => {
      this.active.delete(source);
      if (this.active.size === 0) this.onSpeakingChange?.(false);
    };
  }

  /**
   * Barge-in. The model has already streamed us audio it no longer intends to
   * say, so it has to be dropped, not faded out — the caller is talking now.
   * A 20 ms ramp avoids the click that a hard stop makes.
   */
  interrupt() {
    if (!this.context || !this.gain) return;
    const now = this.context.currentTime;

    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(this.gain.gain.value, now);
    this.gain.gain.linearRampToValueAtTime(0, now + 0.02);

    this.active.forEach((source) => {
      try {
        source.stop(now + 0.02);
      } catch {
        // Already finished; nothing to stop.
      }
    });
    this.active.clear();
    this.onSpeakingChange?.(false);

    this.gain.gain.setValueAtTime(1, now + 0.03);
    this.playhead = now + AudioPlayer.LEAD_SECONDS;
  }

  /** Seconds of already-scheduled audio still to play. Lets the UI hold a
   *  session open until the agent finishes its sign-off. */
  get pendingSeconds() {
    if (!this.context) return 0;
    return Math.max(0, this.playhead - this.context.currentTime);
  }

  async stop() {
    this.interrupt();
    await this.context?.close().catch(() => {});
    this.context = null;
    this.gain = null;
    this.analyser = null;
    this.levelBuffer = null;
  }
}
