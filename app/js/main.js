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

$("btn-start").addEventListener("click", async () => {
  $("btn-start").disabled = true;
  $("btn-start").textContent = "starting…";
  try {
    await speaker.load();
    await engine.start(prefs.inputId);
    $("start").hidden = true;
    $("main").hidden = false;
    setStatus(true, engine.deviceLabel);
    await refreshDevices();
    keepAwake(prefs.wake);
    startLoops();
    loadClassifier();
    if (prefs.captions) enableCaptions();
  } catch (e) {
    $("btn-start").disabled = false;
    $("btn-start").textContent = "Start listening";
    $("start-hint").textContent = "Could not open the audio input: " + (e?.message || e) +
      ". Check that the page is allowed to use the microphone.";
  }
});

function setStatus(ok, text) {
  $("status-dot").className = "dot" + (ok ? " on" : "");
  $("status-text").textContent = text;
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

const arrow = (a) => (a < -15 ? "←" : a > 15 ? "→" : "↑");

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

$("sel-input").addEventListener("change", async (e) => {
  prefs.inputId = e.target.value; savePrefs();
  try { setStatus(false, "switching…"); await engine.start(prefs.inputId); setStatus(true, engine.deviceLabel); }
  catch (err) { setStatus(false, "could not open that input"); }
});
$("sel-out").addEventListener("change", async (e) => {
  prefs.outputId = e.target.value; savePrefs();
  await speaker.setOutput(prefs.outputId);
});

async function refreshDevices() {
  const ins = await listInputs(), outs = await listOutputs();
  fill($("sel-input"), ins, prefs.inputId, "Default input (phone microphone)");
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
