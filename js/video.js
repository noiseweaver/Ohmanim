// Video clips: import a file, pull frames out of it for the in-browser renderer, and play
// clips as real <video> elements laid over an SVG slide while previewing or presenting.
import { assetURL } from './backgrounds.js';
import { decode } from './voice.js';

const blobToDataURL = (blob) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(r.error); r.readAsDataURL(blob); });
const once = (el, ev) => new Promise((resolve, reject) => {
  const ok = () => { el.removeEventListener('error', bad); resolve(); };
  const bad = () => { el.removeEventListener(ev, ok); reject(new Error('This browser cannot play that video.')); };
  el.addEventListener(ev, ok, { once: true }); el.addEventListener('error', bad, { once: true });
});

const timeout = (p, ms, msg) => Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error(msg)), ms))]);

// Open a video for reading frames. Safari only decodes videos that are in the page and marked
// inline, and recordings (MediaRecorder WebM) often report an Infinity duration until the
// browser has seen the end, so seek there once to learn it.
async function openVideo(url, name = 'That file') {
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto';
  v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
  Object.assign(v.style, { position: 'fixed', left: '-10px', top: '-10px', width: '2px', height: '2px', opacity: '0', pointerEvents: 'none' });
  document.body.appendChild(v);
  v.src = url;
  try {
    await timeout(once(v, 'loadedmetadata'), 20000, `${name} took too long to open.`);
    if (!Number.isFinite(v.duration)) {
      const known = new Promise((resolve) => { const f = () => { if (Number.isFinite(v.duration)) { v.removeEventListener('durationchange', f); resolve(); } }; v.addEventListener('durationchange', f); });
      v.currentTime = 1e7;
      await timeout(known, 20000, `Could not find how long ${name} is.`);
    }
    if (!v.videoWidth || !(v.duration > 0)) throw new Error(`${name} has no picture this browser can show.`);
    if (v.readyState < 2) await timeout(once(v, 'loadeddata'), 20000, `${name} took too long to load.`);
    return v;
  } catch (e) { closeVideo(v); throw e.message === 'This browser cannot play that video.' ? new Error(`This browser can't decode ${name}. Phone videos are often HEVC (H.265), which many browsers can't play; export it as MP4 (H.264) or WebM and try again.`) : e; }
}
function closeVideo(v) { v.removeAttribute('src'); v.load(); v.remove(); }
// Show the frame at time t (seconds) and wait until it is ready to draw.
async function seekTo(v, t) {
  const done = once(v, 'seeked');
  v.currentTime = t;
  await timeout(done, 10000, 'The video stopped responding while reading frames.');
  if (v.requestVideoFrameCallback && v.readyState < 2) await timeout(new Promise((r) => v.requestVideoFrameCallback(r)), 2000, 'x').catch(() => {});
}

export const MAX_VIDEO_MB = 80;

// Read a video file: keeps the file itself, a poster frame for the editor, and whether it has sound.
export async function importVideo(file) {
  if (file.size > MAX_VIDEO_MB * 1e6) throw new Error(`${file.name} is over ${MAX_VIDEO_MB} MB. Trim or compress it first.`);
  const url = URL.createObjectURL(file);
  let v = null;
  try {
    v = await openVideo(url, file.name);
    const dur = v.duration;
    await seekTo(v, Math.min(0.05, dur / 2));
    const k = Math.min(1, 1280 / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(v.videoWidth * k); c.height = Math.round(v.videoHeight * k);
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    let hasAudio = false;
    try { const pcm = await decode(file); hasAudio = pcm.some((x) => Math.abs(x) > 1e-4); } catch {}
    return { src: await blobToDataURL(file), type: file.type || 'video/mp4', kind: 'video', name: file.name, dur: Math.round(dur * 1000) / 1000,
      w: v.videoWidth, h: v.videoHeight, poster: c.toDataURL('image/jpeg', 0.85), hasAudio };
  } finally { if (v) closeVideo(v); URL.revokeObjectURL(url); }
}

export const posterURL = (asset) => (asset?.poster ? assetURL({ src: asset.poster }) : '');
export const videoURL = (asset) => assetURL(asset);

// The clip's soundtrack as mono PCM (for the renderer) — decodeAudioData reads video files too.
export const videoPCM = (asset) => decode(asset);

// Frames for the renderer: `count` frames at `fps`, at most w × h pixels each.
export async function extractFrames(asset, fps, w, h, onFrame = () => {}) {
  const v = await openVideo(videoURL(asset), asset.name || 'a video clip');
  try {
    const k = Math.min(1, w / v.videoWidth, h / v.videoHeight);
    const rw = Math.max(2, Math.round(v.videoWidth * k)), rh = Math.max(2, Math.round(v.videoHeight * k));
    const dur = asset.dur || v.duration;
    const count = Math.max(1, Math.ceil(dur * fps));
    const frames = [];
    for (let i = 0; i < count; i++) {
      await seekTo(v, Math.min(v.duration - 0.001, i / fps + 0.001));
      frames.push(await createImageBitmap(v, { resizeWidth: rw, resizeHeight: rh, resizeQuality: 'medium' }));
      onFrame(i + 1, count);
    }
    return frames;
  } finally { closeVideo(v); }
}

// Real video elements over an SVG slide (scene units, y up). sync() places one per visible
// clip; clips listed in `fresh` start from the beginning.
export class VideoLayer {
  constructor(svg) { this.svg = svg; this.els = new Map(); this.muted = false; }
  sync(objs, assets, fresh = new Set()) {
    const host = this.svg.parentElement;
    const ctm = this.svg.getScreenCTM(), hr = host.getBoundingClientRect();
    const keep = new Set();
    for (const o of objs) {
      const a = assets?.[o.asset];
      if (o.type !== 'video' || !a) continue;
      keep.add(o.id);
      let v = this.els.get(o.id);
      if (!v) {
        v = document.createElement('video');
        v.className = 'clipvid'; v.playsInline = true; v.preload = 'auto';
        v.src = videoURL(a); v.poster = posterURL(a);
        host.appendChild(v);
        this.els.set(o.id, v);
        fresh = new Set([...fresh, o.id]);
      }
      if (!ctm) continue;
      const s = o.scale ?? 1, px = ctm.a;
      const cx = ctm.a * o.x + ctm.e - hr.left, cy = ctm.d * -o.y + ctm.f - hr.top;
      Object.assign(v.style, { left: cx + 'px', top: cy + 'px', width: o.w * s * px + 'px', height: o.h * s * px + 'px',
        transform: `translate(-50%, -50%) rotate(${-(o.rot || 0)}deg)`, opacity: o.opacity ?? 1 });
      v.volume = Math.max(0, Math.min(1, o.vol ?? 1));
      v.muted = this.muted;
      if (fresh.has(o.id)) { v.currentTime = 0; v.play().catch(() => {}); v.animate?.([{ opacity: 0 }, { opacity: o.opacity ?? 1 }], { duration: 500 }); }
    }
    for (const [id, v] of this.els) if (!keep.has(id)) { v.pause(); v.remove(); this.els.delete(id); }
  }
  pause() { this.els.forEach((v) => v.pause()); }
  clear() { this.els.forEach((v) => { v.pause(); v.remove(); }); this.els.clear(); }
}

