// Offline support: the app shell is cached on install; everything else (Pyodide,
// Python packages and KaTeX from the CDN) is cached the first time it loads. Bump VERSION to ship updates.
const VERSION = 'mv-2';
const SHELL = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png',
  'js/app.js', 'js/components.js', 'js/render.js', 'js/player.js', 'js/export.js', 'js/demo.js',
  'js/manim/engine.js', 'js/manim/worker.js', 'js/manim/encode.js', 'js/manim/draw.js', 'js/manim/tex.js',
  'vendor/mp4-muxer.mjs', 'vendor/mathjax-tex-svg-full.js',
  'py/manimweb/__init__.py', 'py/manimweb/cairo_shim.py', 'py/manimweb/pango_shim.py', 'py/manimweb/stubs.py',
  'py/fonts/DejaVuSans.ttf', 'py/fonts/DejaVuSans-Bold.ttf', 'py/fonts/DejaVuSansMono.ttf',
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
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
