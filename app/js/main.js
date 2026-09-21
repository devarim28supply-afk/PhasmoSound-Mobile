/* Wires everything together and draws the screen. */

import { AudioEngine, listInputs, listOutputs } from "./audio.js";
import { Classifier } from "./classify.js";
import { Captioner } from "./captions.js";
import { Speaker, PAGE_NAMES } from "./phrases.js";

const BUILD = "v0.1";
const $ = (id) => document.getElementById(id);

const CAT_COLOR = {
  move: "--move", door: "--door", object: "--object", ghost: "--ghost", voice: "--voice",
  alert: "--alert", env: "--env", music: "--music", other: "--other", game: "--game",
};

const prefs = loadPrefs();
const engine = new AudioEngine({ minDb: prefs.minDb });
const classifier = new Classifier();
const captioner = new Captioner();
const speaker = new Speaker();

let events = [];        // {label, cat, angle, t, pending}
let captions = [];      // {text, t}
let wakeLock = null;
let classifyTimer = null;
let onsetPending = null;
let lastSeen = new Map();
let currentPage = 0;

// ─────────────────────────────────────────────────────────── start

$("btn-start").addEventListener("click", () => startUp().catch(showStartError));

async function startUp() {
  $("btn-start").disabled = true;
  $("btn-start").textContent = "looking for your cable…";

  await speaker.load();

  // The browser will not name any input until it has been allowed one, so take the default,
  // learn the names, and drop it again straight away. The phone's own microphone is never
  // listened to: this is only how permission works.
  await grantPermission();

  const id = await pickBestInput();
  if (!id) { showNoCable(); return; }

  await engine.start(id);
  currentInputId = id;

  $("start").hidden = true;
  $("main").hidden = false;
  setStatus(true, engine.deviceLabel);
  await refreshDevices();
  keepAwake(prefs.wake);
  startLoops();
  loadClassifier();
  if (prefs.captions) enableCaptions();
}

async function grantPermission() {
  let s = null;
  try { s = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  finally { try { s?.getTracks().forEach((t) => t.stop()); } catch {} }
}

function showNoCable() {
  $("btn-start").disabled = false;
  $("btn-start").textContent = "Look again";
  $("start-hint").innerHTML =
    "<b>No cable found.</b> Nothing is plugged into this phone that carries the game's sound, and " +
    "this app will not listen through the phone's own microphone.<br><br>" +
    "Plug the cable in and tap <b>Look again</b>.<br><br>" +
    "<span class=\"dim\">If it is already plugged in, the adapter is not one the phone can use as an " +
    "audio input. A USB audio interface with a stereo LINE input is what works.</span>";
}

function showStartError(err) {
  $("btn-start").disabled = false;
  $("btn-start").textContent = "Try again";
  $("start-hint").textContent = "Could not open the audio input: " + (err?.message || err) +
    ". Check that the page is allowed to use the microphone — the browser needs that permission " +
    "to see your cable, even though the phone's own microphone is never used.";
}

/* How many channels this input really hands over. Device names never say, and the track
   settings lie on some phones, so open it and count what reaches the audio graph. */
async function probeChannels(deviceId) {
  for (const want of [{ exact: 2 }, 2]) {
    let s = null, ctx = null;
    try {
      s = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          echoCancellation: false, noiseSuppression: false, autoGainControl: false,
          channelCount: want,
        },
      });
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      let ch = ctx.createMediaStreamSource(s).channelCount;
      const st = s.getAudioTracks()[0]?.getSettings?.() || {};
      if (st.channelCount > ch) ch = st.channelCount;
      return ch;
    } catch (e) {
      if (e?.name === "NotAllowedError") return -1;
    } finally {
      try { s?.getTracks().forEach((t) => t.stop()); } catch {}
      try { await ctx?.close(); } catch {}
    }
  }
  return 0;
}

// A phone's own microphones are always mono, so anything offering two channels is the cable.
// Failing that, fall back to whatever the label says is external.
const BUILT_IN = /built|internal|phone mic|front|back|bottom|top mic|camcorder|voice recognition|speakerphone|default/i;
const EXTERNAL = /usb|headset|wired|adapter|line|digital|dock|external|audio device|uca|interface|dac/i;

/* Find the input carrying the game. Built-in microphones are never returned: if the only thing
   attached is the phone's own mic, this returns "" and the app refuses to start. */
async function pickBestInput() {
  const ins = await listInputs();
  let external = "";

  for (const d of ins) {
    if (!d.deviceId || d.deviceId === "default" || d.deviceId === "communications") continue;
    const label = d.label || "";
    if (isBuiltIn(label)) continue;                       // never the phone's own microphone
    const ch = await probeChannels(d.deviceId);
    if (ch >= 2) return d.deviceId;                       // stereo wins outright
    if (ch >= 1 && !external) external = d.deviceId;      // mono cable still carries the game
  }
  return external;
}

function isBuiltIn(label) {
  if (!label) return true;                  // unnamed is not worth risking: it is usually the built-in
  if (EXTERNAL.test(label)) return false;   // an explicit USB / headset / line name is external
  return BUILT_IN.test(label) || /^microphone$/i.test(label.trim());
}

/* Something was plugged in or pulled out. Follow the cable; never drop back to the phone. */
async function autoPickInput() {
  if (prefs.inputId) return;                        // an explicit choice always wins
  let id = "";
  try { id = await pickBestInput(); } catch {}

  if (!id) {                                        // cable gone
    await engine.stop();
    currentInputId = "";
    setStatus(false, "cable unplugged");
    return;
  }
  if (id === currentInputId && engine.stream) return;
  try {
    await engine.start(id);
    currentInputId = id;
    setStatus(true, engine.deviceLabel);
    await refreshDevices();
  } catch { setStatus(false, "could not open that input"); }
}

let currentInputId = "";

function setStatus(ok, text) {
  $("status-dot").className = "dot" + (ok ? " on" : "");
  statusDevice = text;
  paintStatus();
}

// The left/right display is only honest if the input really carries two different channels.
// Most phones hand a web page a single mixed-down channel no matter what we ask for, so say
// plainly which one we got instead of lighting both edges off the same sound.
let statusDevice = "";
let lastStereo = "";

const STEREO_NOTE = {
  stereo: "stereo",
  mono: "mono · no left/right",
  "dual-mono": "both sides the same · no left/right",
  unknown: "",
};

/* Opens every input the phone will admit to having and reports how many channels it actually
   hands over. This is the only way to know which adapter works -- the labels never say. */
async function checkInputs() {
  const out = $("check-out");
  out.textContent = "checking every input…";
  const devices = await listInputs();
  if (!devices.length) { out.textContent = "No inputs found. Allow the microphone first."; return; }

  const lines = [];
  let stereo = null;
  for (const d of devices) {
    if (d.deviceId === "default") continue;
    const ch = await probeChannels(d.deviceId);
    const verdict = ch >= 2 ? "✓ STEREO — this is your cable"
      : ch === 1 ? "mono, no left/right"
      : ch === -1 ? "not allowed" : "unavailable";
    if (ch >= 2 && !stereo) stereo = d;
    lines.push((d.label || "input") + ": " + verdict);
  }

  if (stereo) {
    lines.push("");
    lines.push("Switching to it now.");
    prefs.inputId = stereo.deviceId; savePrefs();
    try { await engine.start(stereo.deviceId); currentInputId = stereo.deviceId; setStatus(true, engine.deviceLabel); } catch {}
    await refreshDevices();
  } else {
    lines.push("");
    lines.push("Nothing here gives stereo. If an adapter is plugged in, it is a headset adapter — " +
      "its mic input is mono by design. A USB interface with a stereo LINE input is what works.");
  }
  out.innerHTML = lines.join("<br>");
}

function paintStatus() {
  const state = engine.stream ? engine.stereoState() : "unknown";
  const note = STEREO_NOTE[state] || "";
  $("status-text").textContent = note ? statusDevice + " · " + note : statusDevice;

  if (state !== lastStereo) {
    lastStereo = state;
    const flat = state === "mono" || state === "dual-mono";
    document.body.classList.toggle("no-direction", flat);
    const label = flat ? "–" : null;
    $("edge-l").querySelector(".edge-label").textContent = label ?? "L";
    $("edge-r").querySelector(".edge-label").textContent = label ?? "R";
  }
}

// ─────────────────────────────────────────────────────────── audio -> screen

engine.addEventListener("onset", (e) => {
  const { angle, loud } = e.detail;
  addEvent({ label: loud ? "LOUD !" : "!", cat: loud ? "alert" : "other", angle, pending: true });
  onsetPending = performance.now();
  classifySoon(60);
});

engine.addEventListener("samples", (e) => {
  if (prefs.captions && captioner.ready) captioner.push(e.detail);
});

captioner.addEventListener("caption", (e) => {
  captions.push({ text: e.detail.text, t: performance.now() });
  if (captions.length > 8) captions.shift();
  drawCaptions();
});
captioner.addEventListener("ready", (e) => {
  $("cap-status").textContent = `On, running on ${e.detail.device === "webgpu" ? "the GPU" : "the processor"}.`;
});
captioner.addEventListener("error", (e) => { $("cap-status").textContent = "Caption error: " + e.detail; });

// ─────────────────────────────────────────────────────────── the loops

function startLoops() {
  requestAnimationFrame(draw);
  classifyTimer = setInterval(() => classifySoon(0), 250);
  setInterval(paintStatus, 1000);
}

let classifyQueued = false;
function classifySoon(delayMs) {
  if (!prefs.sounds || !classifier.ready || classifyQueued) return;
  classifyQueued = true;
  setTimeout(async () => {
    try { await classifyOnce(); } finally { classifyQueued = false; }
  }, delayMs);
}

async function classifyOnce() {
  const wave = engine.latest(15600);
  if (!wave) return;
  if (engine.level < engine.minDb) return;

  const scores = await classifier.run(wave);
  const dets = classifier.detect(scores, {
    minScore: 0.21, phasmoOnly: prefs.phasmoOnly, showVoice: true, showMusic: false, hide: prefs.hide,
  });
  if (!dets.length) return;

  const angle = engine.angle();
  drawChips(dets.slice(0, 4));

  // a "!" row waiting for a name gets it now
  const waiting = events.find((x) => x.pending && performance.now() - x.t < 1500);
  const top = dets[0];
  if (waiting && top) {
    waiting.label = top.label; waiting.cat = top.cat; waiting.pending = false;
    waiting.angle = angle;
    lastSeen.set(top.label, performance.now());
    drawEvents();
    markFeet(top, angle);
    return;
  }

  for (const d of dets) {
    if (d.score < 0.3) continue;
    const seen = lastSeen.get(d.label) || 0;
    lastSeen.set(d.label, performance.now());
    if (performance.now() - seen < 2500) continue;
    addEvent({ label: d.label, cat: d.cat, angle });
    markFeet(d, angle);
  }
}

function markFeet(det, angle) {
  if (!classifier.isOwnMove(det.label)) return;
  if (Math.abs(angle) < 15) return;                 // dead centre could be you
  const el = angle < 0 ? $("feet-l") : $("feet-r");
  el.hidden = false; el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 1500);
}

function addEvent(ev) {
  ev.t = performance.now();
  events.unshift(ev);
  if (events.length > 10) events.pop();
  drawEvents();
}

// ─────────────────────────────────────────────────────────── drawing

function draw() {
  // level edges
  const l = engine.norm(engine.levelL), r = engine.norm(engine.levelR);
  $("edge-l").style.setProperty("--glow", levelColor(l));
  $("edge-r").style.setProperty("--glow", levelColor(r));
  // age the rows
  const now = performance.now();
  let dirty = false;
  for (const e of events) {
    const age = (now - e.t) / 1000;
    if (age > 10 && !e.gone) { e.gone = true; dirty = true; }
  }
  if (dirty) { events = events.filter((e) => !e.gone); drawEvents(); }
  updateAges();
  requestAnimationFrame(draw);
}

function levelColor(t) {
  if (t <= 0.02) return "transparent";
  const stops = [[170, 215, 255], [255, 230, 80], [255, 50, 40]];
  const c = t < 0.55
    ? mix(stops[0], stops[1], t / 0.55)
    : mix(stops[1], stops[2], (t - 0.55) / 0.45);
  return `rgba(${c[0]},${c[1]},${c[2]},${(0.15 + 0.85 * t).toFixed(2)})`;
}
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

function drawEvents() {
  const ul = $("events");
  ul.innerHTML = "";
  for (const e of events.slice(0, 7)) {
    const li = document.createElement("li");
    const colour = `var(${CAT_COLOR[e.cat] || "--other"})`;
    li.innerHTML =
      `<span class="ev-dot" style="background:${colour}"></span>` +
      `<span class="ev-arrow">${arrow(e.angle)}</span>` +
      `<span class="ev-label" style="color:${e.pending ? "#fff" : colour}"></span>` +
      `<span class="ev-age" data-t="${e.t}"></span>`;
    li.querySelector(".ev-label").textContent = e.label;
    ul.appendChild(li);
  }
  updateAges();
}

function updateAges() {
  const now = performance.now();
  for (const s of document.querySelectorAll(".ev-age")) {
    const age = (now - Number(s.dataset.t)) / 1000;
    s.textContent = age < 1 ? "now" : `${Math.floor(age)}s`;
  }
}

const arrow = (a) => {
  if (lastStereo === "mono" || lastStereo === "dual-mono") return "•";   // one channel: no side to point to
  return a < -15 ? "←" : a > 15 ? "→" : "↑";
};

function drawChips(dets) {
  const box = $("chips");
  box.innerHTML = "";
  for (const d of dets) {
    const s = document.createElement("span");
    s.className = "chip";
    s.style.background = `color-mix(in srgb, var(${CAT_COLOR[d.cat] || "--other"}) 38%, transparent)`;
    s.textContent = `${d.label} ${Math.round(d.score * 100)}%`;
    box.appendChild(s);
  }
  clearTimeout(box._t);
  box._t = setTimeout(() => (box.innerHTML = ""), 2500);
}

function drawCaptions() {
  const box = $("captions");
  const now = performance.now();
  const live = captions.filter((c) => now - c.t < 14000).slice(-4);
  box.innerHTML = "";
  if (!live.length) {
    const p = document.createElement("p");
    p.className = "cap-idle";
    p.textContent = prefs.captions ? "Listening…" : "Captions are off. Turn them on in settings.";
    box.appendChild(p);
    return;
  }
  live.forEach((c, i) => {
    const p = document.createElement("p");
    p.className = i === live.length - 1 ? "new" : "old";
    p.textContent = c.text;
    box.appendChild(p);
  });
}
setInterval(drawCaptions, 2000);

// ─────────────────────────────────────────────────────────── the wheel

$("btn-speak").addEventListener("click", () => openWheel());
$("btn-wheel-close").addEventListener("click", () => ($("wheel").hidden = true));
$("btn-type").addEventListener("click", () => { $("wheel").hidden = true; $("typer").hidden = false; $("type-input").focus(); });
$("btn-type-close").addEventListener("click", () => ($("typer").hidden = true));
$("btn-type-say").addEventListener("click", () => {
  const t = $("type-input").value.trim();
  if (t) { speaker.speakText(t); addEvent({ label: "You: " + t, cat: "voice", angle: 0 }); }
  $("type-input").value = ""; $("typer").hidden = true;
});

function openWheel() {
  currentPage = 0;
  renderWheel();
  $("wheel").hidden = false;
}

function renderWheel() {
  const ring = $("wheel-ring");
  const pages = speaker.pages();
  ring.innerHTML = "";
  pages.forEach((_, i) => {
    const b = document.createElement("button");
    b.textContent = speaker.pageName(i);
    b.className = i === currentPage ? "sel" : "";
    b.addEventListener("click", () => { currentPage = i; renderWheel(); });
    ring.appendChild(b);
  });

  const ul = $("wheel-lines");
  ul.innerHTML = "";
  (pages[currentPage] || []).forEach((item, i) => {
    const globalIndex = currentPage * 9 + i;
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.innerHTML = `<span class="num">${i + 1}</span>`;
    const span = document.createElement("span");
    span.textContent = item.Text;
    b.appendChild(span);
    b.addEventListener("click", async () => {
      $("wheel").hidden = true;
      $("btn-speak").classList.add("busy");
      $("btn-speak").textContent = "Speaking…";
      const said = await speaker.say(globalIndex);
      addEvent({ label: "You: " + said, cat: "voice", angle: 0 });
      setTimeout(() => { $("btn-speak").classList.remove("busy"); $("btn-speak").textContent = "Speak"; }, 900);
    });
    li.appendChild(b);
    ul.appendChild(li);
  });
}

// ─────────────────────────────────────────────────────────── settings

try {
  navigator.mediaDevices.addEventListener("devicechange", () => {
    if (!$("main").hidden) autoPickInput().catch(() => {});
  });
} catch {}

$("btn-settings").addEventListener("click", async () => { await refreshDevices(); $("settings").hidden = false; });
$("btn-settings-close").addEventListener("click", () => ($("settings").hidden = true));

$("rng-sens").addEventListener("input", (e) => {
  prefs.minDb = Number(e.target.value);
  engine.minDb = prefs.minDb;
  $("lbl-sens").textContent = `${prefs.minDb} dB`;
  savePrefs();
});

$("chk-captions").addEventListener("change", (e) => {
  prefs.captions = e.target.checked; savePrefs();
  if (prefs.captions) enableCaptions();
  else $("cap-status").textContent = "Off.";
  drawCaptions();
});
$("chk-sounds").addEventListener("change", (e) => { prefs.sounds = e.target.checked; savePrefs(); });
$("sel-game").addEventListener("change", (e) => {
  prefs.phasmoOnly = e.target.value === "phasmophobia";
  // outside Phasmophobia the environment sounds (weather, traffic, animals) are often the point
  prefs.hide = prefs.phasmoOnly ? ["env"] : [];
  savePrefs();
});
$("chk-wake").addEventListener("change", (e) => { prefs.wake = e.target.checked; savePrefs(); keepAwake(prefs.wake); });

$("btn-check").addEventListener("click", () => { checkInputs().catch((e) => { $("check-out").textContent = "check failed: " + (e?.message || e); }); });

$("sel-input").addEventListener("change", async (e) => {
  prefs.inputId = e.target.value; savePrefs();
  if (!prefs.inputId) { await autoPickInput(); return; }   // back to auto
  try {
    setStatus(false, "switching…");
    await engine.start(prefs.inputId);
    currentInputId = prefs.inputId;
    setStatus(true, engine.deviceLabel);
  } catch (err) { setStatus(false, "could not open that input"); }
});
$("sel-out").addEventListener("change", async (e) => {
  prefs.outputId = e.target.value; savePrefs();
  await speaker.setOutput(prefs.outputId);
});

async function refreshDevices() {
  const ins = await listInputs(), outs = await listOutputs();
  fill($("sel-input"), ins, prefs.inputId, "Auto — follow the cable");
  fill($("sel-out"), outs, prefs.outputId, "Default output");
  $("sel-out").disabled = !("setSinkId" in HTMLMediaElement.prototype);
  if ($("sel-out").disabled) $("sel-out").title = "This browser always uses the default output.";
}

function fill(sel, devices, chosen, defaultLabel) {
  sel.innerHTML = "";
  const d0 = document.createElement("option");
  d0.value = ""; d0.textContent = defaultLabel;
  sel.appendChild(d0);
  devices.forEach((d, i) => {
    const o = document.createElement("option");
    o.value = d.deviceId;
    o.textContent = d.label || `Input ${i + 1}`;
    sel.appendChild(o);
  });
  sel.value = chosen || "";
}

async function loadClassifier() {
  try {
    await classifier.load((m) => { if (m) setStatus(true, m); });
    setStatus(true, engine.deviceLabel);
  } catch (e) {
    setStatus(true, "sound naming unavailable");
    console.error(e);
  }
}

async function enableCaptions() {
  if (captioner.ready) { $("cap-status").textContent = "On."; return; }
  $("cap-status").textContent = "Downloading the speech model…";
  try { await captioner.load((m) => { if (m) $("cap-status").textContent = m; }); }
  catch (e) { $("cap-status").textContent = "Could not load captions: " + (e?.message || e); prefs.captions = false; }
}

async function keepAwake(on) {
  try {
    if (on && "wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen");
    else { await wakeLock?.release(); wakeLock = null; }
  } catch {}
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && prefs.wake) keepAwake(true);
});

// ─────────────────────────────────────────────────────────── prefs

function loadPrefs() {
  let p = {};
  try { p = JSON.parse(localStorage.getItem("phasmo.prefs") || "{}"); } catch {}
  return {
    minDb: p.minDb ?? -42, captions: p.captions ?? false, sounds: p.sounds ?? true,
    wake: p.wake ?? true, inputId: p.inputId ?? "", outputId: p.outputId ?? "",
    phasmoOnly: p.phasmoOnly ?? true, hide: p.hide ?? ["env"],
  };
}
function savePrefs() { try { localStorage.setItem("phasmo.prefs", JSON.stringify(prefs)); } catch {} }

// initial UI state
$("rng-sens").value = prefs.minDb;
$("lbl-sens").textContent = `${prefs.minDb} dB`;
$("chk-captions").checked = prefs.captions;
$("chk-sounds").checked = prefs.sounds;
$("chk-wake").checked = prefs.wake;
$("sel-game").value = prefs.phasmoOnly ? "phasmophobia" : "all";
$("build-info").textContent = `PhasmoSound Mobile ${BUILD}`;

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
