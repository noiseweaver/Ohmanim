// Video clips: import a file, pull frames out of it for the in-browser renderer, and play
// clips as real <video> elements laid over an SVG slide while previewing or presenting.
import { assetURL } from './backgrounds.js';
import { decode } from './voice.js';
import { route } from './meter.js';

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
// needData: also wait until a frame can be drawn (iOS may refuse until someone taps play).
async function openVideo(url, name = 'That file', needData = true) {
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
    if (needData) await loadData(v, 20000, `${name} took too long to load.`);
    return v;
  } catch (e) { closeVideo(v); throw e.message === 'This browser cannot play that video.' ? new Error(`This browser can't decode ${name}. Phone videos are often HEVC (H.265), which many browsers can't play; export it as MP4 (H.264) or WebM and try again.`) : e; }
}
// iOS only loads picture data once a video plays; a muted inline video may play without a tap.
async function loadData(v, ms, msg) {
  if (v.readyState >= 2) return;
  const data = once(v, 'loadeddata');
  v.play().then(() => v.pause()).catch(() => {});
  try { await timeout(data, ms, msg); } finally { v.pause(); }
}
// A stand-in first frame (dark, with a play mark) for when the browser won't show one yet.
function placeholderPoster(w, h) {
  const k = Math.min(1, 640 / Math.max(w, h)), c = document.createElement('canvas');
  c.width = Math.max(16, Math.round(w * k)); c.height = Math.max(16, Math.round(h * k));
  const x = c.getContext('2d'), r = Math.min(c.width, c.height) * 0.14;
  x.fillStyle = '#1b1f27'; x.fillRect(0, 0, c.width, c.height);
  x.fillStyle = '#ffffff'; x.globalAlpha = 0.8; x.beginPath();
  x.moveTo(c.width / 2 - r * 0.6, c.height / 2 - r); x.lineTo(c.width / 2 + r, c.height / 2); x.lineTo(c.width / 2 - r * 0.6, c.height / 2 + r); x.fill();
  return c.toDataURL('image/jpeg', 0.85);
}
// The frame on screen as a JPEG data URL, at most 1280 px.
function grabPoster(v) {
  const k = Math.min(1, 1280 / Math.max(v.videoWidth, v.videoHeight)), c = document.createElement('canvas');
  c.width = Math.round(v.videoWidth * k); c.height = Math.round(v.videoHeight * k);
  c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85);
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
// onStep(text) reports progress, since a large clip takes a while.
export async function importVideo(file, onStep = () => {}) {
  if (file.size > MAX_VIDEO_MB * 1e6) throw new Error(`${file.name} is over ${MAX_VIDEO_MB} MB. Trim or compress it first.`);
  const url = URL.createObjectURL(file);
  let v = null;
  try {
    onStep(`Opening ${file.name}…`);
    v = await openVideo(url, file.name, false);
    onStep(`Reading the first frame of ${file.name}…`);
    const dur = v.duration;
    // iOS may not hand over a frame until the clip is played with a tap. Then the clip still
    // imports with a stand-in first frame, and the real one is taken the first time it plays.
    let poster = null;
    try {
      await loadData(v, 4000, 'no frame');
      await timeout(seekTo(v, Math.min(0.05, dur / 2)), 4000, 'no frame');
      if (v.readyState >= 2) poster = grabPoster(v);
    } catch {}
    let hasAudio = false;
    onStep(`Checking ${file.name} for sound…`);
    // Some browsers never answer when asked to decode a video's sound; assume it has some then.
    try { const pcm = await timeout(decode(file), 15000, 'slow'); hasAudio = pcm.some((x) => Math.abs(x) > 1e-4); } catch (e) { hasAudio = e.message === 'slow'; }
    onStep(`Saving ${file.name}…`);
    return { src: await blobToDataURL(file), type: file.type || 'video/mp4', kind: 'video', name: file.name, dur: Math.round(dur * 1000) / 1000,
      w: v.videoWidth, h: v.videoHeight, poster: poster || placeholderPoster(v.videoWidth, v.videoHeight), ...(poster ? {} : { posterless: true }), hasAudio };
  } finally { if (v) closeVideo(v); URL.revokeObjectURL(url); }
}

export const posterURL = (asset) => (asset?.poster ? assetURL({ src: asset.poster }) : '');
export const videoURL = (asset) => assetURL(asset);

// The clip's soundtrack as mono PCM (for the renderer) — decodeAudioData reads video files too.
export const videoPCM = (asset) => decode(asset);

// Frames for the renderer at `fps`, at most w × h pixels each, from frame `from` up to time `to`.
export async function extractFrames(asset, fps, w, h, onFrame = () => {}, from = 0, to = null) {
  const v = await openVideo(videoURL(asset), asset.name || 'a video clip');
  try {
    const k = Math.min(1, w / v.videoWidth, h / v.videoHeight);
    const rw = Math.max(2, Math.round(v.videoWidth * k)), rh = Math.max(2, Math.round(v.videoHeight * k));
    const dur = asset.dur || v.duration;
    const count = Math.max(1, Math.ceil(Math.min(dur, to ?? dur) * fps) - from);
    const frames = [];
    for (let i = 0; i < count; i++) {
      await seekTo(v, Math.min(v.duration - 0.001, (from + i) / fps + 0.001));
      frames.push(await createImageBitmap(v, { resizeWidth: rw, resizeHeight: rh, resizeQuality: 'medium' }));
      onFrame(i + 1, count);
    }
    return frames;
  } finally { closeVideo(v); }
}

// Real video elements over an SVG slide (scene units, y up). sync() places one per visible
// clip; clips listed in `fresh` start from the beginning.
export class VideoLayer {
  // onPoster(asset): called after a clip without a real first frame got one while playing.
  constructor(svg, onPoster = () => {}) { this.svg = svg; this.els = new Map(); this.muted = false; this.onPoster = onPoster; }
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
        route(v, 'clips');
        v.src = videoURL(a); v.poster = posterURL(a);
        if (a.posterless) v.addEventListener('playing', () => setTimeout(() => {
          if (!a.posterless || v.readyState < 2) return;
          try { a.poster = grabPoster(v); delete a.posterless; this.onPoster(a); } catch {}
        }, 150), { once: true });
        // A trimmed clip stops at its end point and holds that frame.
        v.addEventListener('timeupdate', () => { const end = v._o?.trimOut; if (end != null && v.currentTime >= end - 0.03) { v.pause(); v.currentTime = end; } });
        host.appendChild(v);
        this.els.set(o.id, v);
        fresh = new Set([...fresh, o.id]);
      }
      if (!ctm) continue;
      const s = o.scale ?? 1, px = ctm.a;
      const cx = ctm.a * o.x + ctm.e - hr.left, cy = ctm.d * -o.y + ctm.f - hr.top;
      Object.assign(v.style, { left: cx + 'px', top: cy + 'px', width: o.w * s * px + 'px', height: o.h * s * px + 'px',
        transform: `translate(-50%, -50%) rotate(${-(o.rot || 0)}deg)`, opacity: o.opacity ?? 1 });
      v._o = o;
      v.volume = Math.max(0, Math.min(1, o.vol ?? 1));
      v.muted = this.muted;
      if (fresh.has(o.id)) { v.currentTime = o.trimIn || 0; v.play().catch(() => { v.muted = true; v.play().catch(() => {}); }); /* iOS may only allow it muted */ v.animate?.([{ opacity: 0 }, { opacity: o.opacity ?? 1 }], { duration: 500 }); }
    }
    for (const [id, v] of this.els) if (!keep.has(id)) { v.pause(); v.remove(); this.els.delete(id); }
  }
  pause() { this.els.forEach((v) => v.pause()); }
  clear() { this.els.forEach((v) => { v.pause(); v.remove(); }); this.els.clear(); }
}

