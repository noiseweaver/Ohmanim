// Narration: record from the microphone, play clips back, and turn them into the
// forms other parts need (PCM for the in-browser renderer, WAV for desktop Manim).
import { assetURL, assetBytes } from './backgrounds.js';
import { route } from './meter.js';

export const SAMPLE_RATE = 48000;

function pickType() {
  const types = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'];
  return types.find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || '';
}

let stream = null;
async function mic() {
  if (stream && stream.active) return stream;
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot record audio here.');
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (e) {
    throw new Error(e.name === 'NotAllowedError' ? 'Microphone access was blocked. Allow it in the browser to record.' : 'No microphone found.');
  }
  return stream;
}
export function releaseMic() { stream?.getTracks().forEach((t) => t.stop()); stream = null; }

// Start recording one clip. Resolves to {stop(): Promise<asset>, cancel(), level(): 0..1}.
export async function startRecording() {
  const s = await mic();
  const type = pickType();
  const rec = new MediaRecorder(s, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 64000 });
  const parts = [];
  rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
  rec.start(250);
  // A level meter so people can see the microphone is live.
  let ctx = null, an = null, buf = null;
  try {
    ctx = new AudioContext();
    an = ctx.createAnalyser(); an.fftSize = 512; buf = new Float32Array(an.fftSize);
    ctx.createMediaStreamSource(s).connect(an);
  } catch {}
  const t0 = performance.now();
  return {
    started: t0,
    level() { if (!an) return 0; an.getFloatTimeDomainData(buf); let m = 0; for (const v of buf) m = Math.max(m, Math.abs(v)); return Math.min(1, m * 1.6); },
    cancel() { try { rec.stop(); } catch {} ctx?.close(); },
    stop() {
      return new Promise((resolve, reject) => {
        rec.onstop = async () => {
          ctx?.close();
          try {
            const blob = new Blob(parts, { type: rec.mimeType || type || 'audio/webm' });
            const src = await blobToDataURL(blob);
            const pcm = await decode(blob);
            resolve({ src, type: blob.type, dur: Math.round((pcm.length / SAMPLE_RATE) * 1000) / 1000, name: 'narration', kind: 'audio' });
          } catch (e) { reject(e); }
        };
        try { rec.stop(); } catch (e) { reject(e); }
      });
    },
  };
}

const blobToDataURL = (blob) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(r.error); r.readAsDataURL(blob); });

// Decode audio to mono Float32 PCM at SAMPLE_RATE.
const pcmCache = new Map();
export async function decode(blobOrAsset) {
  const key = blobOrAsset.src;
  if (key && pcmCache.has(key)) return pcmCache.get(key);
  const bytes = blobOrAsset instanceof Blob ? await blobOrAsset.arrayBuffer() : assetBytes(blobOrAsset).buffer;
  const ctx = new OfflineAudioContext(1, SAMPLE_RATE, SAMPLE_RATE);
  const ab = await ctx.decodeAudioData(bytes.slice(0));
  const n = Math.ceil(ab.duration * SAMPLE_RATE);
  const off = new OfflineAudioContext(1, Math.max(1, n), SAMPLE_RATE);
  const src = off.createBufferSource(); src.buffer = ab; src.connect(off.destination); src.start();
  const pcm = (await off.startRendering()).getChannelData(0);
  if (key) pcmCache.set(key, pcm);
  return pcm;
}

// 16-bit mono WAV, the format desktop Manim reads without extra tools.
export async function toWav(asset) {
  const pcm = await decode(asset);
  const buf = new ArrayBuffer(44 + pcm.length * 2), v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, SAMPLE_RATE, true);
  v.setUint32(28, SAMPLE_RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
  return new Blob([buf], { type: 'audio/wav' });
}

// Read an audio file someone picked: narration recorded elsewhere, a sound effect or music.
export async function importAudio(file) {
  if (file.size > 40e6) throw new Error(`${file.name} is over 40 MB. Trim or compress it first.`);
  let pcm;
  try { pcm = await decode(file); } catch { throw new Error(`${file.name} is not audio this browser can read.`); }
  const src = await blobToDataURL(file);
  return { src, type: file.type || 'audio/mpeg', dur: Math.round((pcm.length / SAMPLE_RATE) * 1000) / 1000, name: file.name, kind: 'audio' };
}

// Play a clip; resolves when it ends or is stopped.
// Narration plays through one shared audio element, so a new clip always replaces the one
// playing (two clips can never overlap) and iOS, which only lets a page start sound from a
// tap, keeps letting it play once the first clip started from one.
let narr = null, current = null, finish = null, playingAsset = null;
let onStart = () => {};
// fn(asset) runs whenever a narration clip starts.
export const onClipStart = (fn) => { onStart = fn; };
export function playClip(asset) {
  stopClip();
  if (!asset) return Promise.resolve();
  if (!narr) { narr = new Audio(); route(narr, 'voice'); }
  const a = narr;
  return new Promise((resolve) => {
    let timer = 0;
    const done = () => { if (finish !== done) return; finish = null; current = null; playingAsset = null; clearTimeout(timer); a.onended = a.onerror = null; resolve(); };
    finish = done; current = a; playingAsset = asset;
    a.onended = a.onerror = done;
    a.src = assetURL(asset);
    // A stalled clip doesn't hold the slide up forever.
    timer = setTimeout(done, ((asset.dur || 0) + 2) * 1000);
    a.play().catch(done);
    onStart(asset);
  });
}
// The narration clip playing and how far through it is (0..1), or null when none is playing.
export const nowPlaying = () => (current ? { asset: playingAsset, progress: clipProgress() } : null);
const clipProgress = () => (current && current.duration > 0 && Number.isFinite(current.duration) ? current.currentTime / current.duration : current ? 0 : null);
export function stopClip() { if (narr) narr.pause(); finish?.(); }

export const fmtDur = (s) => (s >= 60 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : `${s.toFixed(1)} s`);

// Sound effects play over everything else and don't stop each other.
const effects = new Set();
export function playSound(asset, vol = 1) {
  if (!asset) return;
  const a = new Audio(assetURL(asset));
  route(a, 'sfx');
  a.volume = Math.max(0, Math.min(1, vol));
  effects.add(a);
  a.onended = a.onerror = () => effects.delete(a);
  a.play().catch(() => effects.delete(a));
}
export function stopSounds() { effects.forEach((a) => a.pause()); effects.clear(); }

// Background music: loops under the lesson and dips while narration plays.
let bed = null;
export function startMusic(m, asset) {
  stopMusic();
  if (!m || !asset) return;
  const a = new Audio(assetURL(asset));
  route(a, 'music');
  a.loop = true;
  a.volume = m.vol ?? 0.3;
  a.play().catch(() => {});
  bed = { a, timer: setInterval(() => {
    const want = (m.vol ?? 0.3) * (current && m.duck ? m.duck : 1);
    a.volume = Math.max(0, Math.min(1, a.volume + (want - a.volume) * 0.25));
  }, 50) };
}
export function stopMusic() { if (bed) { clearInterval(bed.timer); bed.a.pause(); bed = null; } }
