/* Runs on the audio thread. Does the two jobs that must never be late:
   - a left/right loudness reading every ~5 ms, for the edge glow and the direction
   - a 16 kHz mono stream, for the sound classifier and the captioner
   Everything else happens on the main thread. */

const TARGET_RATE = 16000;
const BLOCK_SEC = 0.005;      // one loudness reading per 5 ms
const POST_MS = 20;           // batch messages so we are not posting 375 times a second

class Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.blockLen = Math.max(1, Math.round(sampleRate * BLOCK_SEC));
    this.sumL = 0; this.sumR = 0; this.blockN = 0;
    this.levels = [];           // [{l, r}] since the last post
    this.mono = [];             // 16 kHz samples since the last post
    this.ratio = sampleRate / TARGET_RATE;
    this.outPos = 0; this.srcIndex = 0; this.prev = 0; this.lp = 0;
    this.lpA = 1 - Math.exp((-2 * Math.PI * 7000) / sampleRate);   // anti-alias before decimating
    this.lastPost = currentTime;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const L = input[0];
    const R = input.length > 1 ? input[1] : input[0];
    if (!L || L.length === 0) return true;

    for (let i = 0; i < L.length; i++) {
      const l = L[i], r = R[i];
      this.sumL += l * l;
      this.sumR += r * r;

      // mono, low-passed, resampled to 16 kHz by linear interpolation
      const m = (l + r) * 0.5;
      this.lp += this.lpA * (m - this.lp);
      while (this.outPos <= this.srcIndex) {
        const t = this.outPos - (this.srcIndex - 1);
        this.mono.push(this.prev + (this.lp - this.prev) * t);
        this.outPos += this.ratio;
      }
      this.prev = this.lp;
      this.srcIndex++;

      if (++this.blockN >= this.blockLen) {
        this.levels.push(
          Math.sqrt(this.sumL / this.blockN),
          Math.sqrt(this.sumR / this.blockN)
        );
        this.sumL = this.sumR = 0; this.blockN = 0;
      }
    }

    if ((currentTime - this.lastPost) * 1000 >= POST_MS) {
      this.lastPost = currentTime;
      const levels = new Float32Array(this.levels);   // flat pairs: l, r, l, r, …
      const mono = new Float32Array(this.mono);
      this.levels.length = 0; this.mono.length = 0;
      this.port.postMessage({ levels, mono }, [levels.buffer, mono.buffer]);
    }
    return true;
  }
}

registerProcessor("capture", Capture);
