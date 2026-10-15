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

export const MAX_VIDEO_MB = 80;

// Read a video file: keeps the file itself, a poster frame for the editor, and whether it has sound.
export async function importVideo(file) {
  if (file.size > MAX_VIDEO_MB * 1e6) throw new Error(`${file.name} is over ${MAX_VIDEO_MB} MB. Trim or compress it first.`);
  const url = URL.createObjectURL(file);
  try {
    const v = document.createElement('video');
    v.muted = true; v.preload = 'auto'; v.src = url;
    await once(v, 'loadeddata');
    const dur = v.duration;
    if (!Number.isFinite(dur) || !v.videoWidth) throw new Error(`${file.name} is not a video this browser can play.`);
    v.currentTime = Math.min(0.05, dur / 2);
    await once(v, 'seeked');
    const k = Math.min(1, 1280 / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(v.videoWidth * k); c.height = Math.round(v.videoHeight * k);
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    let hasAudio = false;
    try { const pcm = await decode(file); hasAudio = pcm.some((x) => Math.abs(x) > 1e-4); } catch {}
    return { src: await blobToDataURL(file), type: file.type || 'video/mp4', kind: 'video', name: file.name, dur: Math.round(dur * 1000) / 1000,
      w: v.videoWidth, h: v.videoHeight, poster: c.toDataURL('image/jpeg', 0.85), hasAudio };
  } finally { URL.revokeObjectURL(url); }
}

export const posterURL = (asset) => (asset?.poster ? assetURL({ src: asset.poster }) : '');
export const videoURL = (asset) => assetURL(asset);

// The clip's soundtrack as mono PCM (for the renderer) — decodeAudioData reads video files too.
export const videoPCM = (asset) => decode(asset);

// Frames for the renderer: `count` frames at `fps`, at most w × h pixels each.
export async function extractFrames(asset, fps, w, h, onFrame = () => {}) {
  const v = document.createElement('video');
  v.muted = true; v.preload = 'auto'; v.src = videoURL(asset);
  await once(v, 'loadeddata');
  const k = Math.min(1, w / v.videoWidth, h / v.videoHeight);
  const rw = Math.max(2, Math.round(v.videoWidth * k)), rh = Math.max(2, Math.round(v.videoHeight * k));
  const count = Math.max(1, Math.ceil(v.duration * fps));
  const frames = [];
  for (let i = 0; i < count; i++) {
    v.currentTime = Math.min(v.duration - 0.001, i / fps + 0.001);
    await once(v, 'seeked');
    frames.push(await createImageBitmap(v, { resizeWidth: rw, resizeHeight: rh, resizeQuality: 'medium' }));
    onFrame(i + 1, count);
  }
  v.removeAttribute('src'); v.load();
  return frames;
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

