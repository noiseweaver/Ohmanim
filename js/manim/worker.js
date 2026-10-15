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
// What Manim imports. Pyodide has its own builds of most of it (loaded from its CDN with their
// dependencies); the rest are pure-Python wheels from PyPI, pinned to versions that work with
// Pyodide's packages and installed without dependency resolution so nothing else gets pulled in.
const PYODIDE_PKGS = ['numpy', 'scipy', 'pillow', 'networkx', 'fonttools', 'beautifulsoup4', 'pygments', 'rich',
  'click', 'tqdm', 'typing-extensions', 'decorator', 'micropip'];
const PYPI_PKGS = ['cloup==3.0.8', 'isosurfaces==0.1.2', 'svgelements==1.9.6', 'markdown-it-py==3.0.0', 'mdurl==0.1.2'];
const SHIM_FILES = ['manimweb/__init__.py', 'manimweb/cairo_shim.py', 'manimweb/pango_shim.py', 'manimweb/pathops_shim.py', 'manimweb/stubs.py'];
let fontList = []; // fonts/fonts.json
const fontsLoaded = new Set();

let pyodide = null;
let booting = null;
const base = new URL('../../', import.meta.url); // site root

const post = (m, t) => self.postMessage(m, t || []);
const status = (text, boot) => post({ type: 'status', text, ...(boot ? { boot } : {}) });
// Installing Manim happens in these steps; the editor shows them as a progress bar.
const BOOT_STEPS = 5;

async function boot() {
  status('Downloading Python (Pyodide)…', [0, BOOT_STEPS]);
  const { loadPyodide } = await import(PYODIDE_URL + 'pyodide.mjs');
  const py = await loadPyodide({ indexURL: PYODIDE_URL });
  status('Installing NumPy, SciPy and friends…', [1, BOOT_STEPS]);
  await py.loadPackage(PYODIDE_PKGS);
  const micropip = py.pyimport('micropip');
  status(`Installing Manim ${MANIM_VERSION}…`, [2, BOOT_STEPS]);
  for (const pkg of [...PYPI_PKGS, `manim==${MANIM_VERSION}`]) {
    // Keyword arguments must go through callKwargs; a plain JS object would arrive as a positional one.
    try { await micropip.install.callKwargs(pkg, { deps: false }); }
    catch (err) { throw new Error(`Could not install ${pkg}: ${pyErrorMessage(err)}`); }
  }
  status('Loading the browser shims…', [3, BOOT_STEPS]);
  const FS = py.FS;
  for (const d of ['/manimweb', '/manimweb/manimweb', '/manimweb/fonts', '/manimweb/fonts/files']) try { FS.mkdir(d); } catch {}
  await Promise.all([
    ...SHIM_FILES.map(async (f) => FS.writeFile('/manimweb/' + f, await (await fetch(new URL('py/' + f, base))).text())),
    (async () => {
      const json = await (await fetch(new URL('fonts/fonts.json', base))).text();
      fontList = JSON.parse(json);
      FS.writeFile('/manimweb/fonts/fonts.json', json);
    })(),
  ]);
  status('Starting Manim…', [4, BOOT_STEPS]);
  await py.runPythonAsync(`
import sys, os
os.environ["MANIMWEB_FONTS"] = "/manimweb/fonts"
sys.path.insert(0, "/manimweb")
import manimweb
manimweb.install()
`);
  // Only now is Manim importable; a render that arrives earlier waits on `booting`.
  pyodide = py;
  post({ type: 'ready' });
}

// Loop the music under the whole video, dipping by `duck` dB (with short ramps) while
// narration plays and fading out at the end.
function mixMusic(pcm, bed, m, audio) {
  const R = AUDIO_RATE, ramp = Math.round(0.3 * R), n = Math.min(pcm.length, Math.round((m.end || Infinity) * R));
  const spans = m.voiced.filter(([, name]) => audio[name]).map(([t, name]) => [Math.round(t * R), Math.round(t * R) + audio[name].length]).sort((a, b) => a[0] - b[0]);
  const low = 10 ** (m.duck / 20), base = 10 ** (m.gain / 20), fade = Math.max(1, Math.round((m.fade || 0) * R));
  let j = 0;
  for (let i = 0; i < n; i++) {
    while (j < spans.length && spans[j][1] + ramp < i) j++;
    // How far into a dip this sample is: 0 outside narration, 1 inside, ramping at the edges.
    let d = 0;
    for (let k = j; k < spans.length && spans[k][0] - ramp <= i; k++) {
      const [a, b] = spans[k];
      d = Math.max(d, i < a ? 1 - (a - i) / ramp : i > b ? 1 - (i - b) / ramp : 1);
    }
    const out = n - i < fade ? (n - i) / fade : 1;
    pcm[i] += bed[i % bed.length] * base * (1 + (low - 1) * d) * out;
  }
}

async function render({ code, width, height, fps, tex, assets = [], audio = {} }) {
  await (booting ||= boot());
  const enc = await new FrameEncoder(width, height, fps).init({ withAudio: Object.keys(audio).length > 0 });
  const sounds = []; // [{name, time, gain}]
  let music = null; // {name, gain, duck, fade, voiced: [[time, name]], end}
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
  const clips = Object.keys(clipFrames);
  enc.videos = clips.map((k) => clipFrames[k]);
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
      sounds.push({ name: String(payload), time: +n, gain: +bg || 0 });
    } else if (kind === 'music') {
      try { music = { ...JSON.parse(String(payload)), end: +n }; } catch {}
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
  pyodide.globals.set('_mv_videos', pyodide.toPy(clips));
  let result;
  try {
    const r = await pyodide.runPythonAsync(`
import manimweb
from pyodide.ffi import to_js
def _wrap(kind, payload, n, bg):
    _mv_sink(kind, to_js(memoryview(payload)) if kind == "frame" else payload, n, bg)
_res = manimweb.render(_mv_code, sink=_wrap, width=_mv_size[0], height=_mv_size[1], fps=_mv_size[2], tex=dict(_mv_tex), images=list(_mv_images), videos=list(_mv_videos))
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
  // Mix every clip in at the time the scene started it, plus the music bed.
  let pcm = null;
  const heard = sounds.filter((s) => audio[s.name]);
  const bed = music && audio[music.name];
  if ((heard.length || bed) && enc.audio) {
    pcm = new Float32Array(Math.ceil((enc.frameNo / fps) * AUDIO_RATE));
    for (const s of heard) {
      const clip = audio[s.name], at = Math.round(s.time * AUDIO_RATE), g = 10 ** (s.gain / 20);
      for (let i = 0; i < clip.length && at + i < pcm.length; i++) pcm[at + i] += clip[i] * g;
    }
    if (bed) mixMusic(pcm, bed, music, audio);
    // Keep the sum from clipping.
    for (let i = 0; i < pcm.length; i++) pcm[i] = Math.max(-1, Math.min(1, pcm[i]));
  } else if (heard.length || bed) status('This browser cannot encode audio, so the video has no sound.');
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

// Frames of the lesson's video clips, sent (transferred) before a render: {file name: ImageBitmap[]}.
let clipFrames = {};
function closeVideos() { for (const list of Object.values(clipFrames)) for (const b of list) b.close?.(); clipFrames = {}; }

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'init') await (booting ||= boot());
    else if (m.type === 'videos') { closeVideos(); clipFrames = m.videos || {}; }
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
  // Install errors put the useful line (which package) above a trailing "See: <faq>" line.
  const cause = lines.filter((l) => /Error:|Can't find|conflict/i.test(l)).slice(-1);
  return [...new Set([...user, ...cause, lines.at(-1)])].join('\n');
}
