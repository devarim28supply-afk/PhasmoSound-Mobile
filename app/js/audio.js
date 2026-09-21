/* Microphone / line-in capture, loudness, direction, sudden-sound detection, and a 16 kHz
   ring buffer for the classifier and captioner. The phone equivalent of AudioEngine.cs. */

export const TARGET_RATE = 16000;

const RING_SECONDS = 8;

export class AudioEngine extends EventTarget {
  constructor(opts = {}) {
    super();
    this.minDb = opts.minDb ?? -42;
    this.maxDb = opts.maxDb ?? -10;
    this.onsetDb = opts.onsetDb ?? 10;
    this.loudOnsetDb = opts.loudOnsetDb ?? 14;
    this.ambientGateDb = opts.ambientGateDb ?? 6;
    this.adaptiveFloor = opts.adaptiveFloor ?? true;

    this.ring = new Float32Array(TARGET_RATE * RING_SECONDS);
    this.ringWrite = 0; this.ringCount = 0;

    this.levelL = -100; this.levelR = -100; this.level = -100;
    this.floorL = NaN; this.floorR = NaN; this.floorAll = NaN;
    this.smooth = -100; this.blocks = 0;
    this.lastOnset = 0;

    this.stream = null; this.ctx = null; this.node = null; this.src = null;
    this.deviceLabel = "";
    this.channels = 1;
    this.realChannels = 0;    // what the worklet actually receives
    this.maxDiff = 0;         // 0 after a few seconds means the two sides carry the same signal
    this.heardLoud = false;   // we cannot judge stereo from silence
    this.forcedStereo = false;
  }

  static db(rms) { return 20 * Math.log10(rms + 1e-7); }

  /** Ask for an input. deviceId "" means whatever the browser thinks is default. */
  async start(deviceId = "") {
    await this.stop();
    this.realChannels = 0; this.maxDiff = 0; this.heardLoud = false;
    // Phones downmix to mono whenever the browser's voice processing is in the path, and a plain
    // "channelCount: 2" is only a wish -- it is dropped silently. Asking for exactly 2 makes the
    // request FAIL instead of quietly going mono, which is the only way to get real stereo out of
    // a USB audio interface. If that fails there is no stereo to be had, so fall back and say so.
    const base = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
    if (deviceId) base.deviceId = { exact: deviceId };

    const attempts = [
      { ...base, channelCount: { exact: 2 }, sampleRate: 48000 },
      { ...base, channelCount: { exact: 2 } },
      { ...base, channelCount: 2 },
      { ...base },
    ];
    let lastErr = null;
    for (const audio of attempts) {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
        this.forcedStereo = audio.channelCount?.exact === 2;
        lastErr = null;
        break;
      } catch (e) { lastErr = e; }
    }
    if (lastErr || !this.stream) throw lastErr || new Error("no audio input");

    const track = this.stream.getAudioTracks()[0];
    this.deviceLabel = track?.label || "audio input";
    this.channels = track?.getSettings?.().channelCount ?? 1;

    this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: "interactive" });
    if (this.ctx.state === "suspended") await this.ctx.resume();
    await this.ctx.audioWorklet.addModule("js/capture-worklet.js");

    this.src = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, "capture", {
      numberOfInputs: 1, numberOfOutputs: 0,
      channelCount: 2, channelCountMode: "max", channelInterpretation: "discrete",
    });
    this.node.port.onmessage = (e) => this._onAudio(e.data);
    this.src.connect(this.node);

    this.dispatchEvent(new CustomEvent("started", { detail: { label: this.deviceLabel, rate: this.ctx.sampleRate } }));
    return this.deviceLabel;
  }

  async stop() {
    try { this.node?.port && (this.node.port.onmessage = null); } catch {}
    try { this.src?.disconnect(); } catch {}
    try { this.node?.disconnect(); } catch {}
    try { await this.ctx?.close(); } catch {}
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null; this.ctx = null; this.node = null; this.src = null;
  }

  _onAudio({ levels, mono, channels, maxDiff }) {
    if (channels) this.realChannels = channels;
    if (maxDiff > this.maxDiff) this.maxDiff = maxDiff;
    // 16 kHz ring buffer
    for (let i = 0; i < mono.length; i++) {
      this.ring[this.ringWrite] = mono[i];
      this.ringWrite = (this.ringWrite + 1) % this.ring.length;
    }
    this.ringCount += mono.length;
    if (mono.length) this.dispatchEvent(new CustomEvent("samples", { detail: mono }));

    // loudness blocks (flat pairs)
    const now = performance.now();
    for (let i = 0; i + 1 < levels.length; i += 2) {
      let dbL = AudioEngine.db(levels[i]);
      let dbR = AudioEngine.db(levels[i + 1]);
      let dbAll = AudioEngine.db(Math.sqrt((levels[i] ** 2 + levels[i + 1] ** 2) / 2));

      if (this.adaptiveFloor) {
        // constant background (hum, fans, a noisy room) is learned and subtracted, so only
        // things that rise above it light the display
        const kUp = 0.0016, kDown = 0.007;    // ~3 s up, ~0.7 s down at 5 ms blocks
        this.floorL = isNaN(this.floorL) ? dbL : this.floorL + (dbL - this.floorL) * (dbL > this.floorL ? kUp : kDown);
        this.floorR = isNaN(this.floorR) ? dbR : this.floorR + (dbR - this.floorR) * (dbR > this.floorR ? kUp : kDown);
        this.floorAll = isNaN(this.floorAll) ? dbAll : this.floorAll + (dbAll - this.floorAll) * (dbAll > this.floorAll ? kUp : kDown);
        dbL = this.minDb + (dbL - this.floorL) - this.ambientGateDb;
        dbR = this.minDb + (dbR - this.floorR) - this.ambientGateDb;
        dbAll = this.minDb + (dbAll - this.floorAll) - this.ambientGateDb;
      }

      // fast attack, slow release, so a short knock still shows
      this.levelL = dbL > this.levelL ? dbL : this.levelL + (dbL - this.levelL) * 0.18;
      this.levelR = dbR > this.levelR ? dbR : this.levelR + (dbR - this.levelR) * 0.18;
      this.level = dbAll > this.level ? dbAll : this.level + (dbAll - this.level) * 0.18;
      if (dbAll > this.minDb + 8) this.heardLoud = true;

      // sudden sound
      if (this.blocks < 200) { this.smooth = this.blocks === 0 ? dbAll : this.smooth + 0.5 * (dbAll - this.smooth); this.blocks++; }
      const prev = this.smooth;
      this.smooth += (dbAll > this.smooth ? 0.2 : 0.035) * (dbAll - this.smooth);
      const jump = dbAll - prev;
      if (this.blocks >= 200 && jump >= this.onsetDb && dbAll > this.minDb && now - this.lastOnset > 120) {
        this.lastOnset = now;
        this.dispatchEvent(new CustomEvent("onset", {
          detail: { jump, loud: jump >= this.loudOnsetDb, angle: this.angle(), level: this.level },
        }));
      }
    }
  }

  /** −90 (hard left) … +90 (hard right), from the difference between the two channels. */
  angle() {
    const l = 10 ** (this.levelL / 20), r = 10 ** (this.levelR / 20);
    const sum = l + r;
    if (sum < 1e-9) return 0;
    return Math.max(-90, Math.min(90, ((r - l) / sum) * 90));
  }

  /** What the direction display can honestly do with this input.
      "mono"      one channel arrived, so there is no left or right at all
      "stereo"    the two sides carry different sound: direction works
      "dual-mono" two channels, but identical, so direction will always read centre
      "unknown"   nothing loud enough yet to tell stereo from dual-mono */
  stereoState() {
    if (this.realChannels === 0) return "unknown";
    if (this.realChannels < 2) return "mono";
    if (this.maxDiff > 0.002) return "stereo";
    return this.heardLoud ? "dual-mono" : "unknown";
  }

  /** 0…1 for the display. */
  norm(db) { return Math.max(0, Math.min(1, (db - this.minDb) / (this.maxDb - this.minDb))); }

  /** The most recent n samples at 16 kHz, or null if we do not have that much yet. */
  latest(n) {
    if (this.ringCount < n) return null;
    const out = new Float32Array(n);
    let start = (this.ringWrite - n + this.ring.length * 2) % this.ring.length;
    for (let i = 0; i < n; i++) out[i] = this.ring[(start + i) % this.ring.length];
    return out;
  }
}

/** Input devices we are allowed to see (labels only appear after permission is granted). */
export async function listInputs() {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === "audioinput");
  } catch { return []; }
}

export async function listOutputs() {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === "audiooutput");
  } catch { return []; }
}
