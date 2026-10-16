// Audio clean-up and shaping for narration, sound effects and music. Pure functions on mono
// Float32 PCM, so they run the same in the editor preview and when an edit is applied.

export const DEFAULT_EDIT = { start: 0, end: null, fadeIn: 0, fadeOut: 0, gain: 0, declick: 0, denoise: 0, plosive: false, eqLow: 0, eqMid: 0, eqHigh: 0, deess: 0, comp: 0, clean: false, level: false };
// One click to a good voiceover chain.
export const VOICE_PRESET = { declick: 0.5, denoise: 0.5, plosive: true, eqLow: -2, eqMid: 2, eqHigh: 1, deess: 0.5, comp: 2, level: true };
const db = (v) => 10 ** (v / 20);

// Second-order high-pass (RBJ cookbook), in place. Removes rumble, handling noise and hum below `hz`.
function highPass(x, rate, hz = 80) {
  const w = (2 * Math.PI * hz) / rate, c = Math.cos(w), al = Math.sin(w) / (2 * Math.SQRT1_2);
  const a0 = 1 + al, b0 = (1 + c) / 2 / a0, b1 = -(1 + c) / a0, b2 = b0, a1 = (-2 * c) / a0, a2 = (1 - al) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i], y = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = v; y2 = y1; y1 = y; x[i] = y;
  }
}

// RBJ cookbook biquads: [b0, b1, b2, a1, a2] normalised by a0.
function coeffs(type, rate, hz, gainDb = 0, q = Math.SQRT1_2) {
  const w = (2 * Math.PI * Math.min(hz, rate * 0.45)) / rate, c = Math.cos(w), sn = Math.sin(w), al = sn / (2 * q), A = 10 ** (gainDb / 40);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
  else if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
  else if (type === 'peak') { b0 = 1 + al * A; b1 = -2 * c; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * c; a2 = 1 - al / A; }
  else { // shelves (slope 1)
    const sq = 2 * Math.sqrt(A) * al, lo = type === 'low';
    const p = A + 1, m = A - 1, s = lo ? 1 : -1;
    b0 = A * (p - s * m * c + sq); b1 = s * 2 * A * (m - s * p * c); b2 = A * (p - s * m * c - sq);
    a0 = p + s * m * c + sq; a1 = s * -2 * (m + s * p * c); a2 = p + s * m * c - sq;
  }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}
// Filter x through a biquad; into `out` (a new array unless given, which may be x itself).
function biquad(x, [b0, b1, b2, a1, a2], out = new Float32Array(x.length)) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i], y = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = v; y2 = y1; y1 = y; out[i] = y;
  }
  return out;
}
// Peak envelope follower with attack/release in ms.
function envelope(x, rate, attackMs, releaseMs) {
  const at = Math.exp(-1 / ((rate * attackMs) / 1000)), rl = Math.exp(-1 / ((rate * releaseMs) / 1000)), out = new Float32Array(x.length);
  let e = 0;
  for (let i = 0; i < x.length; i++) { const v = Math.abs(x[i]); e = v > e ? v + (e - v) * at : v + (e - v) * rl; out[i] = e; }
  return out;
}

// Clicks: mouse and keyboard clicks, mouth clicks and other short ticks. Finds moments where
// the sound above 2.5 kHz jumps far above its level over the surrounding 40 ms for under
// 40 ms, which speech and sibilance don't do. amount 0..1 sets the sensitivity.
// Returns [[start, end], ...] in samples.
export function findClicks(x, rate, amount = 0.5) {
  const hp = biquad(biquad(x, coeffs('hp', rate, 2500)), coeffs('hp', rate, 2500));
  const fast = envelope(hp, rate, 0.05, 1.5);
  // Centred 40 ms RMS of the high band, as the background a click stands out from.
  const W = Math.round(rate * 0.02), sq = new Float64Array(hp.length + 1);
  for (let i = 0; i < hp.length; i++) sq[i + 1] = sq[i] + hp[i] * hp[i];
  const thr = 12 - 7 * amount, floor = 2e-4, maxLen = rate * 0.04, gap = rate * 0.002, pad = Math.round(rate * 0.001);
  const out = [];
  let a = -1, last = -1;
  for (let i = 0; i < hp.length; i++) {
    const lo = Math.max(0, i - W), hi = Math.min(hp.length, i + W);
    const ref = Math.sqrt((sq[hi] - sq[lo]) / (hi - lo));
    if (fast[i] > thr * ref * 0.5 + floor && fast[i] > ref * 2.5) { if (a < 0 || i - last > gap) { if (a >= 0) out.push([a, last]); a = i; } last = i; }
  }
  if (a >= 0) out.push([a, last]);
  return out.filter(([s, e]) => e - s < maxLen).map(([s, e]) => [Math.max(0, s - pad), Math.min(x.length, e + pad * 5)]);
}
// Remove clicks: inside each click, the sound above 2.5 kHz is turned down to the level around it
// and any thump is brought down to the level just before it, with short ramps so nothing pops.
export function declick(x, rate, amount = 0.5) {
  const clicks = findClicks(x, rate, amount);
  if (!clicks.length) return clicks;
  const low = biquad(x, coeffs('lp', rate, 2500));
  const ramp = Math.round(rate * 0.001), look = Math.round(rate * 0.01);
  for (const [s, e] of clicks) {
    // Level just before (and after) the click, to bring its loudness back to.
    let ref = 0;
    for (let i = Math.max(0, s - look); i < s; i++) ref = Math.max(ref, Math.abs(x[i]));
    for (let i = e; i < Math.min(x.length, e + look); i++) ref = Math.max(ref, Math.abs(x[i]));
    let pk = 0;
    for (let i = s; i < e; i++) pk = Math.max(pk, Math.abs(low[i]));
    const gLow = pk > ref * 1.2 && pk > 0 ? Math.max(0.05, (ref * 1.2) / pk) : 1;
    const gHigh = 1 - Math.min(0.97, 0.8 + 0.2 * amount);
    for (let i = Math.max(0, s - ramp); i < Math.min(x.length, e + ramp); i++) {
      const w = i < s ? (i - (s - ramp)) / ramp : i >= e ? 1 - (i - e) / ramp : 1, sm = 0.5 - 0.5 * Math.cos(Math.PI * w);
      const hi = x[i] - low[i];
      x[i] = low[i] * (1 - sm * (1 - gLow)) + hi * (1 - sm * (1 - gHigh));
    }
  }
  return clicks;
}

// Plosives ("p" and "b" pops) and rumble: a high-pass at 80 Hz, then any burst below 150 Hz
// that is louder than the voice above it is turned down to match.
function plosives(x, rate) {
  biquad(x, coeffs('hp', rate, 80), x);
  const low = biquad(x, coeffs('lp', rate, 150));
  const eLow = envelope(low, rate, 1, 40), eHigh = envelope(x.map((v, i) => v - low[i]), rate, 1, 40);
  const rl = Math.exp(-1 / (rate * 0.06));
  let g = 1;
  for (let i = 0; i < x.length; i++) {
    const want = Math.min(1, (eHigh[i] * 0.7 + 1e-4) / (eLow[i] + 1e-9));
    g = want < g ? want : want + (g - want) * rl;
    x[i] -= low[i] * (1 - g);
  }
}
// Three-band voice EQ: low shelf at 120 Hz (warmth/boom), presence peak at 3 kHz (clarity),
// high shelf at 10 kHz (air). Gains in dB.
function eq(x, rate, low, mid, high) {
  if (low) biquad(x, coeffs('low', rate, 120, low), x);
  if (mid) biquad(x, coeffs('peak', rate, 3000, mid, 0.8), x);
  if (high) biquad(x, coeffs('high', rate, 10000, high), x);
}
// De-esser: when the 5–10 kHz band (s, sh, t) jumps out above the rest of the voice, turn only
// that band down. amount 0..1, up to 12 dB of reduction.
function deEss(x, rate, amount) {
  const det = biquad(biquad(x, coeffs('hp', rate, 5000)), coeffs('hp', rate, 5000));
  const eEss = envelope(det, rate, 0.5, 60), eAll = envelope(x, rate, 0.5, 60);
  // The band that gets turned down is x minus its low-passed self, so the two parts add back to x exactly.
  const lowPart = biquad(x, coeffs('lp', rate, 4000)), ess = x.map((v, i) => v - lowPart[i]);
  const maxCut = db(-12 * amount), ratio = 0.35 / (0.5 + amount);
  for (let i = 0; i < x.length; i++) {
    // Sibilance when the band is a large share of the whole signal.
    const share = eEss[i] / (eAll[i] + 1e-9);
    const g = share > ratio ? Math.max(maxCut, ratio / share) : 1;
    x[i] -= ess[i] * (1 - g);
  }
}
// Compressor: levels 1–3 = light 2:1, medium 3:1, strong 4:1, with the threshold set from the
// clip's own loud parts and make-up gain so the overall level stays about the same.
function compress(x, rate, level) {
  const ratio = [1, 2, 3, 4][level] || 1;
  const { lv, hop } = levels(x, rate);
  const loud = percentile(lv, 0.95), thr = loud - [0, 8, 12, 16][level];
  const target = lv.map((l) => (l > thr ? -(l - thr) * (1 - 1 / ratio) : 0));
  const makeup = ((loud - thr) * (1 - 1 / ratio)) / 2;
  for (let k = 0; k < target.length; k++) target[k] += makeup;
  applyGain(x, rate, hop, target, 5, 120);
}

// Short-window RMS level in dB for every `hop` samples.
function levels(x, rate, ms = 10) {
  const hop = Math.max(1, Math.round((rate * ms) / 1000)), n = Math.ceil(x.length / hop), out = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    let s = 0; const a = k * hop, b = Math.min(x.length, a + hop);
    for (let i = a; i < b; i++) s += x[i] * x[i];
    out[k] = 10 * Math.log10(s / Math.max(1, b - a) + 1e-12);
  }
  return { lv: out, hop };
}
const percentile = (arr, p) => { const s = Float32Array.from(arr).sort(); return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? -120; };

// Apply a per-window gain curve (in dB) with attack/release smoothing, sample by sample.
function applyGain(x, rate, hop, target, attackMs, releaseMs) {
  const att = Math.exp(-1 / ((rate * attackMs) / 1000)), rel = Math.exp(-1 / ((rate * releaseMs) / 1000));
  let g = target[0] ?? 0;
  for (let i = 0; i < x.length; i++) {
    const t = target[Math.min(target.length - 1, Math.floor(i / hop))];
    g = t < g ? t + (g - t) * att : t + (g - t) * rel; // falling gain uses attack, rising uses release
    x[i] *= db(g);
  }
}

// Voice clean-up: high-pass, a soft noise gate that dips the room noise between phrases, and
// gentle compression so quiet and loud words sit closer together.
function cleanVoice(x, rate) {
  highPass(x, rate, 80);
  const { lv, hop } = levels(x, rate);
  const floor = percentile(lv, 0.15), loud = percentile(lv, 0.95);
  const open = Math.max(-60, Math.min(floor + 10, loud - 12));
  // Gate: hold it open briefly after speech so word endings aren't clipped.
  const holdN = Math.round(120 / 10), gate = new Float32Array(lv.length);
  let held = 0;
  for (let k = 0; k < lv.length; k++) { if (lv[k] > open) held = holdN; gate[k] = held-- > 0 ? 0 : -18; }
  applyGain(x, rate, hop, gate, 4, 150);
  // Compressor: 3:1 above -24 dB.
  const lv2 = levels(x, rate).lv, comp = lv2.map((l) => (l > -24 ? -(l + 24) * (1 - 1 / 3) : 0));
  applyGain(x, rate, hop, comp, 10, 160);
}

// Loudness: bring the clip's active parts (where someone is talking or something is playing)
// to about -19 dB RMS, then keep peaks under -1 dB with a fast limiter.
function evenLevel(x, rate) {
  const { lv } = levels(x, rate, 50);
  const floor = percentile(lv, 0.2), loud = percentile(lv, 0.97);
  const active = lv.filter((l) => l > Math.max(floor + 6, loud - 30));
  if (!active.length) return;
  const rms = 10 * Math.log10(active.reduce((t, l) => t + 10 ** (l / 10), 0) / active.length);
  const g = db(Math.max(-20, Math.min(24, -19 - rms)));
  for (let i = 0; i < x.length; i++) x[i] *= g;
  limit(x, rate);
}
function limit(x, rate, ceiling = db(-1)) {
  const rel = Math.exp(-1 / (rate * 0.08));
  let env = 1; // gain reduction, 1 = none
  for (let i = 0; i < x.length; i++) {
    const need = Math.abs(x[i]) > ceiling ? ceiling / Math.abs(x[i]) : 1;
    env = need < env ? need : 1 - (1 - env) * rel;
    x[i] *= env;
  }
}

// In-place radix-2 complex FFT (n a power of two).
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

// Noise removal by spectral gating: learn the steady background (hiss, hum, fans, room tone)
// from the quietest moments of the clip, then turn each frequency down wherever it is not
// clearly above that background. amount 0..1 sets how far the noise is pushed down (up to 30 dB).
export function denoise(x, rate, amount = 0.6) {
  if (!(amount > 0) || x.length < 4096) return x;
  const N = rate > 32000 ? 2048 : 1024, hop = N / 4, bins = N / 2 + 1;
  const win = new Float32Array(N).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  const frames = Math.ceil((x.length + N) / hop);
  const pad = new Float32Array(frames * hop + N); pad.set(x, N / 2);
  const re = new Float64Array(N), im = new Float64Array(N);
  // Pass 1: magnitude per frame, and each frame's energy.
  const mags = new Array(frames), energy = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < N; i++) { re[i] = pad[f * hop + i] * win[i]; im[i] = 0; }
    fft(re, im);
    const m = new Float32Array(bins);
    for (let k = 0; k < bins; k++) { m[k] = Math.hypot(re[k], im[k]); energy[f] += m[k] * m[k]; }
    mags[f] = m;
  }
  // Noise profile: the average spectrum of the quietest 10% of frames.
  const order = [...energy.keys()].sort((a, b) => energy[a] - energy[b]);
  const quiet = order.slice(0, Math.max(4, Math.floor(frames * 0.1)));
  const noise = new Float32Array(bins);
  for (const f of quiet) for (let k = 0; k < bins; k++) noise[k] += mags[f][k] / quiet.length;
  // Pass 2: gain per bin, smoothed across frequency and time so it doesn't warble.
  const floor = db(-30 * amount), over = 1 + 1.5 * amount;
  const out = new Float32Array(pad.length), prev = new Float32Array(bins).fill(1), g = new Float32Array(bins);
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < N; i++) { re[i] = pad[f * hop + i] * win[i]; im[i] = 0; }
    fft(re, im);
    const m = mags[f];
    for (let k = 0; k < bins; k++) g[k] = Math.max(floor, 1 - (over * noise[k]) / (m[k] + 1e-9));
    for (let k = 0; k < bins; k++) {
      const s = (g[Math.max(0, k - 1)] + 2 * g[k] + g[Math.min(bins - 1, k + 1)]) / 4;
      // Open fast for speech, close slowly so word tails aren't chopped.
      prev[k] = s > prev[k] ? s : prev[k] * 0.6 + s * 0.4;
      const G = prev[k];
      re[k] *= G; im[k] *= G;
      if (k > 0 && k < N / 2) { re[N - k] *= G; im[N - k] *= G; }
    }
    // Inverse FFT through the forward one: conj, fft, conj, /N.
    for (let i = 0; i < N; i++) im[i] = -im[i];
    fft(re, im);
    for (let i = 0; i < N; i++) out[f * hop + i] += re[i] / N;
  }
  // A Hann window at 75% overlap sums to 2.
  for (let i = 0; i < x.length; i++) x[i] = out[i + N / 2] / 2;
  return x;
}

// Run an edit on PCM. Returns a new array; the input is left alone.
export function processAudio(pcm, rate, edit = {}) {
  const e = { ...DEFAULT_EDIT, ...edit };
  const dur = pcm.length / rate;
  const a = Math.max(0, Math.min(dur, e.start || 0)), b = Math.max(a, Math.min(dur, e.end ?? dur));
  const x = pcm.slice(Math.round(a * rate), Math.round(b * rate));
  if (e.declick) declick(x, rate, e.declick);
  if (e.denoise) denoise(x, rate, e.denoise);
  if (e.clean) cleanVoice(x, rate); // older edits
  if (e.plosive) plosives(x, rate);
  if (e.eqLow || e.eqMid || e.eqHigh) eq(x, rate, e.eqLow, e.eqMid, e.eqHigh);
  if (e.deess) deEss(x, rate, e.deess);
  if (e.comp) compress(x, rate, e.comp);
  if (e.gain) { const g = db(e.gain); for (let i = 0; i < x.length; i++) x[i] *= g; }
  if (e.level) evenLevel(x, rate);
  else if (e.gain > 0 || e.clean || e.comp || e.eqLow > 0 || e.eqMid > 0 || e.eqHigh > 0) limit(x, rate);
  // Equal-power fades.
  const fi = Math.min(x.length, Math.round((e.fadeIn || 0) * rate)), fo = Math.min(x.length, Math.round((e.fadeOut || 0) * rate));
  for (let i = 0; i < fi; i++) x[i] *= Math.sin((i / fi) * Math.PI / 2);
  for (let i = 0; i < fo; i++) x[x.length - 1 - i] *= Math.sin((i / fo) * Math.PI / 2);
  return x;
}

// Peaks for drawing a waveform: [min, max] per column.
export function peaks(pcm, cols) {
  const out = [], step = pcm.length / cols;
  for (let c = 0; c < cols; c++) {
    let lo = 0, hi = 0;
    const a = Math.floor(c * step), b = Math.min(pcm.length, Math.floor((c + 1) * step));
    for (let i = a; i < b; i++) { const v = pcm[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
    out.push([lo, hi]);
  }
  return out;
}

// 16-bit mono WAV bytes.
export function wavBytes(pcm, rate) {
  const buf = new ArrayBuffer(44 + pcm.length * 2), v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
  return new Uint8Array(buf);
}
