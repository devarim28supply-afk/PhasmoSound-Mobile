/* Live captions, entirely on the phone. Whisper through transformers.js, WebGPU when the
   browser has it and WASM otherwise. Audio is cut into utterances the same way the desktop
   captioner does: an adaptive gate, a cut on a real pause, and a hard cut on a long talker. */

const TRANSFORMERS = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.3";
const SR = 16000;
const HOP = 0.1;                 // one loudness reading per 100 ms
const PAUSE = 0.45;              // a gap this long ends an utterance
const MAX_SPEECH = 4.5;          // cut a long talker here so captions keep coming
const MIN_SPEECH = 0.35;         // ignore anything shorter than this

const JUNK = new Set(["thank you.", "thanks for watching.", "you", "bye.", "thank you for watching.", "."]);

export class Captioner extends EventTarget {
  constructor(model = "onnx-community/whisper-base.en") {
    super();
    this.modelId = model;
    this.pipe = null; this.ready = false; this.busy = false;
    this.buf = []; this.recent = [];
    this.inSpeech = false; this.silence = 0; this.spoken = 0;
    this.pending = new Float32Array(0);
  }

  async load(onProgress = () => {}) {
    onProgress("loading the speech model…");
    const { pipeline, env } = await import(/* @vite-ignore */ TRANSFORMERS);
    env.allowLocalModels = false;
    const device = (navigator.gpu ? "webgpu" : "wasm");
    this.pipe = await pipeline("automatic-speech-recognition", this.modelId, {
      device,
      dtype: device === "webgpu" ? "fp16" : "q8",
      progress_callback: (p) => {
        if (p.status === "progress" && p.total)
          onProgress(`speech model ${Math.round((p.loaded / p.total) * 100)}%`);
      },
    });
    this.device = device;
    this.ready = true;
    onProgress("");
    this.dispatchEvent(new CustomEvent("ready", { detail: { device } }));
  }

  /** The gate follows the room: speech has to clear the quiet background by a margin. */
  gate() {
    if (this.recent.length < 10) return 0.008;
    const sorted = [...this.recent].sort((a, b) => a - b);
    const floor = sorted[Math.floor(sorted.length * 0.2)];
    return Math.max(0.006, floor * 2.2);
  }

  /** Feed 16 kHz mono samples from the audio engine. */
  push(samples) {
    if (!this.ready) return;
    const merged = new Float32Array(this.pending.length + samples.length);
    merged.set(this.pending); merged.set(samples, this.pending.length);
    const hopN = Math.round(SR * HOP);
    let off = 0;

    while (merged.length - off >= hopN) {
      const hop = merged.subarray(off, off + hopN);
      off += hopN;
      let acc = 0;
      for (let i = 0; i < hop.length; i++) acc += hop[i] * hop[i];
      const rms = Math.sqrt(acc / hop.length);
      this.recent.push(rms);
      if (this.recent.length > 50) this.recent.shift();

      const g = this.gate();
      if (rms > g) {
        this.inSpeech = true;
        this.buf.push({ a: hop.slice(), rms });
        this.spoken += HOP; this.silence = 0;
      } else if (this.inSpeech) {
        this.buf.push({ a: hop.slice(), rms });      // keep a short tail
        this.silence += HOP;
        if (this.silence >= PAUSE) {
          this.inSpeech = false; this.silence = 0;
          const snap = this.buf; this.buf = [];
          const sp = this.spoken; this.spoken = 0;
          if (sp >= MIN_SPEECH) this._transcribe(concat(snap));
        }
      }

      if (this.inSpeech && this.spoken >= MAX_SPEECH) {
        // cut at the quietest moment in the last 1.5 s so a word is not sliced in half
        const tail = this.buf.slice(-15);
        let k = this.buf.length - tail.length, lowest = Infinity;
        tail.forEach((h, i) => { if (h.rms < lowest) { lowest = h.rms; k = this.buf.length - tail.length + i; } });
        const part = this.buf.slice(0, k);
        this.buf = this.buf.slice(k);
        this.spoken = this.buf.filter((h) => h.rms > g).length * HOP;
        if (part.length) this._transcribe(concat(part));
      }
    }
    this.pending = merged.slice(off);
  }

  async _transcribe(audio) {
    if (this.busy || !this.pipe) return;      // one at a time; a phone cannot run two
    this.busy = true;
    const t0 = performance.now();
    try {
      const out = await this.pipe(audio, { language: "en", task: "transcribe", chunk_length_s: 30 });
      const text = (out?.text || "").trim();
      const ms = Math.round(performance.now() - t0);
      if (text && !JUNK.has(text.toLowerCase()))
        this.dispatchEvent(new CustomEvent("caption", { detail: { text, ms, seconds: audio.length / SR } }));
    } catch (e) {
      this.dispatchEvent(new CustomEvent("error", { detail: String(e?.message || e) }));
    } finally {
      this.busy = false;
    }
  }
}

function concat(hops) {
  let n = 0;
  for (const h of hops) n += h.a.length;
  const out = new Float32Array(n);
  let o = 0;
  for (const h of hops) { out.set(h.a, o); o += h.a.length; }
  return out;
}
