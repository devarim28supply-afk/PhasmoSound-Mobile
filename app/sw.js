/* Offline cache. The app shell and the phrase clips are cached on install so the wheel works
   with no signal; the 16 MB sound model and the speech model are cached the first time they
   are fetched, because they are large and not everyone turns captions on. */

const VERSION = "v0.1.7";
const SHELL = `shell-${VERSION}`;
const BIG = `big-${VERSION}`;

const SHELL_FILES = [
  "./", "./index.html",
  "./css/style.css",
  "./js/main.js", "./js/audio.js", "./js/classify.js", "./js/captions.js",
  "./js/phrases.js", "./js/capture-worklet.js",
  "./manifest.webmanifest",
  "./phrases/phrases.json",
  "./models/labels.json", "./models/yamnet_class_map.csv",
  "./icons/icon-192.png", "./icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    // the 63 voice clips
    const clips = Array.from({ length: 63 }, (_, i) => `./phrases/${String(i + 1).padStart(2, "0")}.mp3`);
    await c.addAll(SHELL_FILES).catch(() => {});
    await Promise.allSettled(clips.map((u) => c.add(u)));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keep = new Set([SHELL, BIG]);
    for (const k of await caches.keys()) if (!keep.has(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // big models and CDN runtimes: serve from cache, fetch and keep on first use
  const isBig = /yamnet\.onnx$/.test(url.pathname)
             || url.hostname === "cdn.jsdelivr.net"
             || url.hostname === "huggingface.co"
             || url.hostname === "cdn-lfs.huggingface.co"
             || url.hostname.endsWith(".hf.co");
  if (isBig) {
    e.respondWith((async () => {
      const c = await caches.open(BIG);
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && res.status === 200) c.put(req, res.clone()).catch(() => {});
      return res;
    })());
    return;
  }

  if (url.origin !== location.origin) return;

  // The app's own code and the voice clips: try the network first so an update is picked up
  // immediately, and fall back to the cache when there is no signal. These files are small;
  // only the models above are worth serving from cache first.
  e.respondWith((async () => {
    const c = await caches.open(SHELL);
    try {
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone()).catch(() => {});
      return res;
    } catch {
      const hit = await c.match(req, { ignoreSearch: true });
      return hit || (await c.match("./index.html")) || Response.error();
    }
  })());
});
