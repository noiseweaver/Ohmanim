// Main-thread side of the in-browser Manim renderer. Owns the worker, renders
// LaTeX with MathJax when Manim asks for it, and re-runs the scene.
import { texToSVG } from './tex.js';

let worker = null;
let ready = false;
const texCache = {};
let listeners = new Set();

export function onEngine(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const emit = (m) => listeners.forEach((fn) => fn(m));

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    if (e.data.type === 'ready') ready = true;
    emit(e.data);
  };
  worker.onerror = (e) => emit({ type: 'error', message: e.message || 'The renderer crashed. Reload the page and try again.' });
  return worker;
}

export const engineReady = () => ready;
export function warmUp() { getWorker().postMessage({ type: 'init' }); }

let mathjax = null;
function loadMathJax() {
  if (mathjax) return mathjax;
  mathjax = new Promise((resolve, reject) => {
    window.MathJax = {
      tex: { packages: { '[+]': ['html'] } },
      svg: { fontCache: 'none' },
      startup: { typeset: false, ready() { window.MathJax.startup.defaultReady(); window.MathJax.startup.promise.then(() => resolve(window.MathJax)); } },
    };
    const s = document.createElement('script');
    s.src = new URL('../../vendor/mathjax-tex-svg-full.js', import.meta.url).href;
    s.onerror = () => reject(new Error('Could not load MathJax for LaTeX'));
    document.head.appendChild(s);
  });
  return mathjax;
}

export async function renderTex(keys) {
  const MJ = await loadMathJax();
  for (const k of keys) {
    if (texCache[k]) continue;
    const i = k.indexOf('|');
    texCache[k] = texToSVG(MJ, MJ.startup.adaptor, k.slice(i + 1), k.slice(0, i));
  }
}

// Renders `code` and resolves with {url, blob, markers, duration, scene}.
// onProgress receives worker messages (status, preview) while it runs.
// assets: image files the code loads, [{name, type, bytes}]; audio: {name: Float32Array} narration PCM.
// videos: {file name: ImageBitmap[]} frames of each clip at fps; they are handed to the worker.
export function renderCode(code, { width = 1280, height = 720, fps = 30, assets = [], audio = {}, videos = {} } = {}, onProgress = () => {}) {
  const w = getWorker();
  w.postMessage({ type: 'videos', videos }, Object.values(videos).flat());
  return new Promise((resolve, reject) => {
    let rounds = 0;
    const off = onEngine(async (m) => {
      if (m.type === 'missingTex') {
        if (++rounds > 5) { off(); return reject(new Error('LaTeX kept changing between runs')); }
        onProgress({ type: 'status', text: `Typesetting ${m.keys.length} LaTeX formula${m.keys.length > 1 ? 's' : ''}…` });
        try { await renderTex(m.keys); } catch (e) { off(); return reject(e); }
        w.postMessage({ type: 'render', code, width, height, fps, assets, audio, tex: { ...texCache } });
      } else if (m.type === 'done') {
        off();
        const blob = new Blob([m.mp4], { type: m.mime });
        resolve({ blob, url: URL.createObjectURL(blob), markers: m.markers, duration: m.duration, scene: m.scene, frames: m.frames, captions: m.captions || {} });
      } else if (m.type === 'error') {
        off(); reject(new Error(m.message));
      } else onProgress(m);
    });
    w.postMessage({ type: 'render', code, width, height, fps, assets, audio, tex: { ...texCache } });
  });
}
