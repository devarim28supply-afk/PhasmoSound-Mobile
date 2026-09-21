/* The phrase board and the voice. Wheel lines play pre-recorded Kokoro clips, so they are
   instant and sound the same every time. Free text falls back to the phone's own voice. */

export const PAGE_NAMES = ["Quick", "Evidence", "Ghost did", "Where", "Doing", "Status", "Ghost type"];
const PER_PAGE = 9;

export class Speaker {
  constructor() {
    this.items = []; this.audio = null; this.sinkId = "";
    this.el = new Audio();
    this.el.preload = "none";
  }

  async load() {
    this.items = await fetch("phrases/phrases.json").then((r) => r.json());
    return this.items;
  }

  pages() {
    const out = [];
    for (let i = 0; i < this.items.length; i += PER_PAGE) out.push(this.items.slice(i, i + PER_PAGE));
    return out;
  }

  pageName(i) { return PAGE_NAMES[i] ?? `Page ${i + 1}`; }

  /** Send the voice to a chosen output (the cable). Chrome only; iOS ignores it. */
  async setOutput(deviceId) {
    this.sinkId = deviceId || "";
    if (this.el.setSinkId && this.sinkId) { try { await this.el.setSinkId(this.sinkId); } catch {} }
  }

  /** Play line n (0-based) from the recorded clips. */
  async say(index) {
    const item = this.items[index];
    if (!item) return "";
    const file = `phrases/${String(index + 1).padStart(2, "0")}.mp3`;
    try {
      this.el.src = file;
      if (this.el.setSinkId && this.sinkId) { try { await this.el.setSinkId(this.sinkId); } catch {} }
      await this.el.play();
      return item.Text;
    } catch {
      return this.speakText(item.Text);   // clip missing: fall back to the phone's voice
    }
  }

  /** Anything not on the board, using the phone's built-in voice. */
  speakText(text) {
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.0; u.pitch = 1.0;
      const v = speechSynthesis.getVoices();
      const pick = v.find((x) => /en-US/.test(x.lang) && /male|adam|alex|daniel|aaron/i.test(x.name))
                || v.find((x) => /en/.test(x.lang));
      if (pick) u.voice = pick;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch {}
    return text;
  }

  stop() { try { this.el.pause(); speechSynthesis.cancel(); } catch {} }
}
