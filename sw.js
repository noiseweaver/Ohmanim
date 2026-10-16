// Offline support: the app shell is cached on install; everything else (Pyodide,
// Python packages from the CDN, KaTeX fonts) is cached the first time it loads. Bump VERSION to ship updates.
const VERSION = 'mv-29';
const SHELL = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png',
  'js/app.js', 'js/icons.js', 'js/motion.js', 'js/backgrounds.js', 'js/store.js', 'js/voice.js', 'js/video.js', 'js/audiofx.js', 'js/audioedit.js', 'js/trimvideo.js', 'js/themes.js', 'js/components.js', 'js/render.js', 'js/player.js', 'js/export.js', 'js/demo.js',
  'js/manim/engine.js', 'js/manim/worker.js', 'js/manim/encode.js', 'js/manim/draw.js', 'js/manim/tex.js',
  'vendor/mp4-muxer.mjs', 'vendor/mathjax-tex-svg-full.js', 'vendor/katex/katex.min.js', 'vendor/katex/katex.min.css',
  'py/manimweb/__init__.py', 'py/manimweb/cairo_shim.py', 'py/manimweb/pango_shim.py', 'py/manimweb/stubs.py', 'py/manimweb/pathops_shim.py',
  'fonts/fonts.json', 'fonts/files/DejaVuSans-Regular.ttf', 'fonts/files/DejaVuSans-Bold.ttf',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // Network first for our own files so edits show up; cache as fallback offline.
  // Our own files skip the HTTP cache (GitHub Pages lets browsers keep them for 10 minutes),
  // so a fresh deploy shows up on the next reload.
  const own = new URL(e.request.url).origin === self.location.origin && e.request.mode !== 'navigate';
  e.respondWith(
    fetch(own ? new Request(e.request, { cache: 'no-cache' }) : e.request).then((res) => {
      if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
