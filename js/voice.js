// Narration: record from the microphone, play clips back, and turn them into the
// forms other parts need (PCM for the in-browser renderer, WAV for desktop Manim).
import { assetURL, assetBytes } from './backgrounds.js';

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

// Play a clip; resolves when it ends or is stopped.
let current = null;
export function playClip(asset) {
  stopClip();
  if (!asset) return Promise.resolve();
  const a = new Audio(assetURL(asset));
  current = a;
  return new Promise((resolve) => {
    a.onended = a.onerror = a.onpause = () => { if (current === a) current = null; resolve(); };
    a.play().catch(() => resolve());
  });
}
export function stopClip() { if (current) { const a = current; current = null; a.pause(); } }

export const fmtDur = (s) => (s >= 60 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : `${s.toFixed(1)} s`);
