// Paints recorded Manim frames and encodes them to MP4 with WebCodecs.
import { drawOps } from './draw.js';
import { Muxer, ArrayBufferTarget } from '../../vendor/mp4-muxer.mjs';

async function pickCodec(width, height, fps) {
  // Constrained Baseline H.264 has no B-frames. Some hardware encoders (Windows) emit
  // B-frames for High profile, whose out-of-order timestamps the MP4 muxer rejects.
  // Level 3.1 covers 720p30, 4.0 covers 1080p30 and 4.2 covers 1080p60.
  const rate = width * height * fps;
  const level = rate <= 1280 * 720 * 30 ? '1F' : rate <= 1920 * 1088 * 30 ? '28' : '2A';
  const candidates = [
    { codec: 'avc1.42E0' + level, mux: 'avc' }, // H.264 Constrained Baseline
    { codec: 'vp09.00.40.08', mux: 'vp9' },
  ];
  for (const c of candidates) {
    const cfg = { codec: c.codec, width, height, bitrate: Math.round(width * height * fps * 0.12), framerate: fps };
    if (c.mux === 'avc') cfg.avc = { format: 'avc' };
    try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) return { cfg, mux: c.mux }; } catch {}
  }
  throw new Error('This browser cannot encode video (WebCodecs). Try a recent Chrome, Edge or Safari.');
}

export const AUDIO_RATE = 48000;
async function pickAudioCodec() {
  if (typeof AudioEncoder === 'undefined') return null;
  for (const c of [{ codec: 'mp4a.40.2', mux: 'aac' }, { codec: 'opus', mux: 'opus' }]) {
    const cfg = { codec: c.codec, sampleRate: AUDIO_RATE, numberOfChannels: 1, bitrate: 96000 };
    try { if ((await AudioEncoder.isConfigSupported(cfg)).supported) return { cfg, mux: c.mux }; } catch {}
  }
  return null;
}

export class FrameEncoder {
  constructor(width, height, fps) {
    Object.assign(this, { width, height, fps, frameNo: 0, lastKey: -1e9, forceKey: true, markers: [], error: null, images: [], videos: [] });
    this.canvas = new OffscreenCanvas(width, height);
    this.ctx = this.canvas.getContext('2d');
  }
  // withAudio: add a mono soundtrack (narration) if this browser can encode one.
  async init({ withAudio = false } = {}) {
    if (typeof VideoEncoder === 'undefined') throw new Error('This browser cannot encode video (WebCodecs). Try a recent Chrome, Edge or Safari.');
    const { cfg, mux } = await pickCodec(this.width, this.height, this.fps);
    this.codec = cfg.codec;
    this.audio = withAudio ? await pickAudioCodec() : null;
    this.target = new ArrayBufferTarget();
    this.muxer = new Muxer({
      target: this.target, video: { codec: mux, width: this.width, height: this.height, frameRate: this.fps },
      ...(this.audio ? { audio: { codec: this.audio.mux, numberOfChannels: 1, sampleRate: AUDIO_RATE } } : {}),
      fastStart: 'in-memory', firstTimestampBehavior: 'offset',
    });
    this.encoder = new VideoEncoder({ output: (chunk, meta) => this.muxer.addVideoChunk(chunk, meta), error: (e) => (this.error = e) });
    this.encoder.configure(cfg);
    return this;
  }
  addFrame(ops, n, bg) {
    drawOps(this.ctx, ops, this.width, this.height, bg, this.images, this.videos);
    const us = 1e6 / this.fps;
    const vf = new VideoFrame(this.canvas, { timestamp: Math.round(this.frameNo * us), duration: Math.round(n * us) });
    const key = this.forceKey || this.frameNo - this.lastKey >= this.fps * 2;
    this.encoder.encode(vf, { keyFrame: key });
    vf.close();
    if (key) { this.lastKey = this.frameNo; this.forceKey = false; }
    this.frameNo += n;
  }
  marker(notes = '') {
    this.markers.push({ time: this.frameNo / this.fps, notes });
    this.forceKey = true; // clean seek point at every pause
  }
  abort() { try { this.encoder.close(); } catch {} }
  // Encode the whole soundtrack: Float32 mono PCM at AUDIO_RATE.
  async addAudio(pcm) {
    if (!this.audio) return false;
    const enc = new AudioEncoder({ output: (chunk, meta) => this.muxer.addAudioChunk(chunk, meta), error: (e) => (this.error = e) });
    enc.configure(this.audio.cfg);
    const step = AUDIO_RATE; // one second per AudioData
    for (let i = 0; i < pcm.length; i += step) {
      const part = pcm.subarray(i, Math.min(pcm.length, i + step));
      const ad = new AudioData({ format: 'f32-planar', sampleRate: AUDIO_RATE, numberOfFrames: part.length, numberOfChannels: 1, timestamp: Math.round((i / AUDIO_RATE) * 1e6), data: part });
      enc.encode(ad); ad.close();
    }
    await enc.flush(); enc.close();
    return true;
  }
  async finish(pcm = null) {
    await this.encoder.flush();
    this.encoder.close();
    if (pcm) await this.addAudio(pcm);
    if (this.error) throw this.error;
    this.muxer.finalize();
    const duration = this.frameNo / this.fps;
    if (!this.markers.length || this.markers.at(-1).time < duration - 1e-6) this.markers.push({ time: duration, notes: '' });
    return { mp4: this.target.buffer, markers: this.markers, duration, frames: this.frameNo };
  }
}
