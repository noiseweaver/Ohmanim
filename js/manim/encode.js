// Paints recorded Manim frames and encodes them to MP4 with WebCodecs.
import { drawOps } from './draw.js';
import { Muxer, ArrayBufferTarget } from '../../vendor/mp4-muxer.mjs';

async function pickCodec(width, height, fps) {
  const candidates = [
    { codec: 'avc1.640028', mux: 'avc' }, // H.264 High 4.0 (up to 1080p)
    { codec: 'avc1.42E01F', mux: 'avc' }, // H.264 Baseline 3.1
    { codec: 'vp09.00.40.08', mux: 'vp9' },
  ];
  for (const c of candidates) {
    const cfg = { codec: c.codec, width, height, bitrate: Math.round(width * height * fps * 0.12), framerate: fps };
    if (c.mux === 'avc') cfg.avc = { format: 'avc' };
    try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) return { cfg, mux: c.mux }; } catch {}
  }
  throw new Error('This browser cannot encode video (WebCodecs). Try a recent Chrome, Edge or Safari.');
}

export class FrameEncoder {
  constructor(width, height, fps) {
    Object.assign(this, { width, height, fps, frameNo: 0, lastKey: -1e9, forceKey: true, markers: [], error: null, images: [] });
    this.canvas = new OffscreenCanvas(width, height);
    this.ctx = this.canvas.getContext('2d');
  }
  async init() {
    if (typeof VideoEncoder === 'undefined') throw new Error('This browser cannot encode video (WebCodecs). Try a recent Chrome, Edge or Safari.');
    const { cfg, mux } = await pickCodec(this.width, this.height, this.fps);
    this.codec = cfg.codec;
    this.target = new ArrayBufferTarget();
    this.muxer = new Muxer({ target: this.target, video: { codec: mux, width: this.width, height: this.height, frameRate: this.fps }, fastStart: 'in-memory', firstTimestampBehavior: 'offset' });
    this.encoder = new VideoEncoder({ output: (chunk, meta) => this.muxer.addVideoChunk(chunk, meta), error: (e) => (this.error = e) });
    this.encoder.configure(cfg);
    return this;
  }
  addFrame(ops, n, bg) {
    drawOps(this.ctx, ops, this.width, this.height, bg, this.images);
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
  async finish() {
    await this.encoder.flush();
    this.encoder.close();
    if (this.error) throw this.error;
    this.muxer.finalize();
    const duration = this.frameNo / this.fps;
    if (!this.markers.length || this.markers.at(-1).time < duration - 1e-6) this.markers.push({ time: duration, notes: '' });
    return { mp4: this.target.buffer, markers: this.markers, duration, frames: this.frameNo };
  }
}
