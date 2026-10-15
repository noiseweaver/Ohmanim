// Web Worker that runs real Manim (Community Edition) inside Pyodide, paints
// each frame on an OffscreenCanvas and encodes an MP4 with WebCodecs.
//
// Messages in:  {type:'init'}  {type:'render', code, width, height, fps, tex, assets:[{name, type, bytes}],
//               audio:{name: Float32Array mono PCM at 48 kHz}}
// Messages out: {type:'status', text}  {type:'ready'}  {type:'preview', bitmap, frame, time}
//               {type:'missingTex', keys}  {type:'done', mp4, mime, markers, duration, frames, scene}
//               {type:'error', message}
import { FrameEncoder, AUDIO_RATE } from './encode.js';

export const PYODIDE_VERSION = '0.29.5';
const PYODIDE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
const MANIM_VERSION = '0.21.0';
// Pure-Python dependencies Manim imports. numpy, scipy, Pillow etc. come from Pyodide's own builds.
const PURE_DEPS = ['numpy', 'scipy', 'pillow', 'networkx', 'fonttools', 'beautifulsoup4', 'pygments', 'rich', 'cloup',
  'click', 'isosurfaces', 'svgelements', 'tqdm', 'typing-extensions', 'decorator'];
const SHIM_FILES = ['manimweb/__init__.py', 'manimweb/cairo_shim.py', 'manimweb/pango_shim.py', 'manimweb/pathops_shim.py', 'manimweb/stubs.py'];
let fontList = []; // fonts/fonts.json
const fontsLoaded = new Set();

let pyodide = null;
let booting = null;
const base = new URL('../../', import.meta.url); // site root

const post = (m, t) => self.postMessage(m, t || []);
const status = (text) => post({ type: 'status', text });

async function boot() {
  status('Downloading Python (Pyodide)…');
  const { loadPyodide } = await import(PYODIDE_URL + 'pyodide.mjs');
  pyodide = await loadPyodide({ indexURL: PYODIDE_URL });
  status('Installing NumPy, SciPy and friends…');
  await pyodide.loadPackage('micropip');
  const micropip = pyodide.pyimport('micropip');
  await micropip.install(PURE_DEPS);
  status(`Installing Manim ${MANIM_VERSION}…`);
  await micropip.install(`manim==${MANIM_VERSION}`, { deps: false });
  status('Loading the browser shims…');
  const FS = pyodide.FS;
  for (const d of ['/manimweb', '/manimweb/manimweb', '/manimweb/fonts', '/manimweb/fonts/files']) try { FS.mkdir(d); } catch {}
  await Promise.all([
    ...SHIM_FILES.map(async (f) => FS.writeFile('/manimweb/' + f, await (await fetch(new URL('py/' + f, base))).text())),
    (async () => {
      const json = await (await fetch(new URL('fonts/fonts.json', base))).text();
      fontList = JSON.parse(json);
      FS.writeFile('/manimweb/fonts/fonts.json', json);
    })(),
  ]);
  status('Starting Manim…');
  await pyodide.runPythonAsync(`
import sys, os
os.environ["MANIMWEB_FONTS"] = "/manimweb/fonts"
sys.path.insert(0, "/manimweb")
import manimweb
manimweb.install()
`);
  post({ type: 'ready' });
}

async function render({ code, width, height, fps, tex, assets = [], audio = {} }) {
  if (!pyodide) await (booting ||= boot());
  const enc = await new FrameEncoder(width, height, fps).init({ withAudio: Object.keys(audio).length > 0 });
  const sounds = []; // [{name, time}]
  // The scene writes its captions as .vtt and .srt files; clear old ones first.
  const cwd = pyodide.FS.cwd(), isCaption = (f) => /\.(vtt|srt)$/.test(f);
  for (const f of pyodide.FS.readdir(cwd).filter(isCaption)) pyodide.FS.unlink(cwd + '/' + f);
  // Image files (backgrounds) go next to the scene for Manim, and stay here as bitmaps to draw.
  const names = [];
  for (const a of assets) {
    pyodide.FS.writeFile(pyodide.FS.cwd() + '/' + a.name, new Uint8Array(a.bytes));
    enc.images.push(await createImageBitmap(new Blob([a.bytes], { type: a.type })));
    names.push(a.name);
  }
  let lastPreview = 0;
  const sink = (kind, payload, n, bg) => {
    if (kind === 'frame') {
      const u8 = payload.toJs ? payload.toJs() : payload;
      payload.destroy?.();
      enc.addFrame(new Float32Array(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)), n, bg);
      const now = performance.now();
      if (now - lastPreview > 120) {
        lastPreview = now;
        createImageBitmap(enc.canvas).then((bitmap) => post({ type: 'preview', bitmap, frame: enc.frameNo, time: enc.frameNo / fps }, [bitmap]));
      }
    } else if (kind === 'slide') {
      enc.marker(String(payload || ''));
    } else if (kind === 'sound') {
      sounds.push({ name: String(payload), time: +n });
    }
  };

  await loadFontsFor(code);
  if (/\b(Union|Intersection|Difference|Exclusion)\s*\(/.test(code)) {
    status('Loading Shapely for shape operations…');
    await pyodide.loadPackage('shapely');
  }
  status('Rendering with Manim…');
  pyodide.globals.set('_mv_sink', sink);
  pyodide.globals.set('_mv_code', code);
  pyodide.globals.set('_mv_tex', pyodide.toPy(tex || {}));
  pyodide.globals.set('_mv_size', pyodide.toPy([width, height, fps]));
  pyodide.globals.set('_mv_images', pyodide.toPy(names));
  let result;
  try {
    const r = await pyodide.runPythonAsync(`
from pyodide.ffi import to_js
def _wrap(kind, payload, n, bg):
    _mv_sink(kind, to_js(memoryview(payload)) if kind == "frame" else payload, n, bg)
_res = manimweb.render(_mv_code, sink=_wrap, width=_mv_size[0], height=_mv_size[1], fps=_mv_size[2], tex=dict(_mv_tex), images=list(_mv_images))
_res
`);
    result = r.toJs({ dict_converter: Object.fromEntries });
    r.destroy?.();
  } finally {
    pyodide.globals.delete('_mv_sink');
  }
  if (result.missing) {
    enc.abort();
    post({ type: 'missingTex', keys: result.missing });
    return;
  }
  // Mix every narration clip in at the time the scene started it.
  let pcm = null;
  const heard = sounds.filter((s) => audio[s.name]);
  if (heard.length && enc.audio) {
    pcm = new Float32Array(Math.ceil((enc.frameNo / fps) * AUDIO_RATE));
    for (const s of heard) {
      const clip = audio[s.name], at = Math.round(s.time * AUDIO_RATE);
      for (let i = 0; i < clip.length && at + i < pcm.length; i++) pcm[at + i] += clip[i];
    }
  } else if (heard.length) status('This browser cannot encode audio, so the video has no narration.');
  const out = await enc.finish(pcm);
  const captions = {};
  for (const f of pyodide.FS.readdir(cwd).filter(isCaption)) captions[f.slice(-3)] = pyodide.FS.readFile(cwd + '/' + f, { encoding: 'utf8' });
  post({ type: 'done', ...out, captions, mime: 'video/mp4', scene: result.scene, codec: enc.codec, audio: !!pcm }, [out.mp4]);
}

// Copy the TTFs a scene names (plus DejaVu Sans, the default and fallback) into Python's filesystem.
async function loadFontsFor(code) {
  const wanted = fontList.filter((f) => f.file === 'DejaVuSans' || code.includes(f.family));
  const files = wanted.flatMap((f) => [f.file + '-Regular.ttf', ...(f.bold ? [f.file + '-Bold.ttf'] : [])]).filter((f) => !fontsLoaded.has(f));
  if (!files.length) return;
  status('Loading fonts…');
  await Promise.all(files.map(async (f) => {
    const res = await fetch(new URL('fonts/files/' + f, base));
    if (!res.ok) throw new Error('Could not load font ' + f);
    pyodide.FS.writeFile('/manimweb/fonts/files/' + f, new Uint8Array(await res.arrayBuffer()));
    fontsLoaded.add(f);
  }));
}

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'init') await (booting ||= boot());
    else if (m.type === 'render') await render(m);
  } catch (err) {
    if (!pyodide) booting = null; // let the next attempt retry the download
    post({ type: 'error', message: pyErrorMessage(err) });
  }
};

function pyErrorMessage(err) {
  const s = String(err?.message || err);
  // Python tracebacks are long; keep the last line plus the user's code location.
  const lines = s.trim().split('\n');
  const user = lines.filter((l) => l.includes('lesson.py')).slice(-1);
  return [...user, lines.at(-1)].join('\n');
}
