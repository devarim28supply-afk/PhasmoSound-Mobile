/* Names the sounds. YAMNet (the same model the desktop overlay uses) through ONNX Runtime Web,
   with the same label mapping, the same Phasmophobia-only filter, and the same honest merging
   of look-alike classes. Ported from Classifier.cs; labels.json is generated from it. */

const ORT_VERSION = "1.20.1";
const ORT_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;

export class Classifier {
  constructor() {
    this.session = null; this.names = null; this.labels = null;
    this.inputName = "waveform"; this.ready = false;
  }

  async load(onProgress = () => {}) {
    onProgress("loading the sound engine…");
    const ort = await import(/* @vite-ignore */ ORT_BASE + "ort.min.mjs");
    ort.env.wasm.wasmPaths = ORT_BASE;
    ort.env.wasm.numThreads = 1;          // phones dislike cross-origin-isolated threading
    ort.env.logLevel = "error";
    this.ort = ort;

    onProgress("loading sound names…");
    const [csv, labels] = await Promise.all([
      fetch("models/yamnet_class_map.csv").then((r) => r.text()),
      fetch("models/labels.json").then((r) => r.json()),
    ]);
    this.names = parseClassMap(csv);
    this.labels = labels;
    this.ignore = new Set(labels.ignore);
    this.profile = new Set(labels.profile);
    this.wood = new Set(labels.woodFamily);
    this.clink = new Set(labels.clinkFamily);

    onProgress("loading the sound model (16 MB)…");
    this.session = await ort.InferenceSession.create("models/yamnet.onnx", {
      executionProviders: ["wasm"], graphOptimizationLevel: "all",
    });
    this.inputName = this.session.inputNames[0];
    this.outputName = this.session.outputNames[0];

    await this.run(new Float32Array(15600));   // warm up: the first run is always the slow one
    this.ready = true;
    onProgress("");
  }

  /** Per-class maximum score across the clip. */
  async run(wave) {
    const t = new this.ort.Tensor("float32", wave, [wave.length]);
    const res = await this.session.run({ [this.inputName]: t });
    const scores = res[this.outputName];
    const [frames, classes] = scores.dims;
    const data = scores.data;
    const max = new Float32Array(classes);
    for (let f = 0; f < frames; f++) {
      const off = f * classes;
      for (let c = 0; c < classes; c++) if (data[off + c] > max[c]) max[c] = data[off + c];
    }
    return max;
  }

  /** Raw scores -> the short list we actually show. */
  detect(scores, { minScore = 0.21, phasmoOnly = true, showVoice = true, showMusic = false, hide = [] } = {}) {
    const L = this.labels;
    const hidden = new Set(hide);
    const best = new Map();
    for (let i = 0; i < scores.length && i < this.names.length; i++) {
      if (scores[i] < minScore) continue;
      const raw = this.names[i];
      if (this.ignore.has(raw)) continue;

      const entry = L.map[raw];
      let label = entry ? entry[0] : raw;
      let cat = entry ? entry[1] : "other";

      if (cat === "voice" && !showVoice) continue;
      if (cat === "music" && !showMusic) continue;

      // rare but important names need real confidence; below that they are just a sharp click
      const strict = L.strictMin[label];
      if (strict !== undefined && scores[i] < strict) { label = L.clinkLabel; cat = "object"; }
      else if (this.wood.has(label) && scores[i] < L.specificScore) { label = L.woodLabel; cat = "object"; }
      else if (this.clink.has(label) && scores[i] < L.specificScore) { label = L.clinkLabel; cat = "object"; }

      if (phasmoOnly && !this.profile.has(label)) continue;
      if (hidden.has(cat)) continue;

      const prev = best.get(label);
      if (!prev || prev.score < scores[i]) best.set(label, { label, cat, score: scores[i] });
    }
    return [...best.values()].sort((a, b) => b.score - a.score);
  }

  isOwnMove(label) { return this.labels.ownMoveLabels.includes(label); }
}

function parseClassMap(csv) {
  const out = [];
  const lines = csv.split(/\r?\n/).slice(1);
  for (const line of lines) {
    if (!line) continue;
    const c1 = line.indexOf(",");
    const c2 = line.indexOf(",", c1 + 1);
    let name = line.slice(c2 + 1).trim();
    if (name.startsWith('"') && name.endsWith('"')) name = name.slice(1, -1).replace(/""/g, '"');
    out.push(name);
  }
  return out;
}
