// Output levels: every sound the app plays (narration, sound effects, music, video clips) runs
// through one Web Audio graph with a level analyser per channel, and small mixers draw the
// levels while anything plays.
//
// Routing is careful about iOS: an element is only routed once the audio context is running
// (it starts on a tap), so if the context can't start, sound still plays straight out and
// only the meter stays still.

export const CHANNELS = [
  { id: 'voice', name: 'Voice', short: 'V' },
  { id: 'sfx', name: 'Sounds', short: 'S' },
  { id: 'music', name: 'Music', short: 'M' },
  { id: 'clips', name: 'Clips', short: 'C' },
];

let ctx = null, master = null;
const ch = {};
const routed = new WeakSet();
const mixers = new Set();
let raf = 0, quietSince = 0;

function context() {
  if (ctx) return ctx;
  try {
    ctx = new AudioContext();
    master = ctx.createAnalyser(); master.fftSize = 1024; master.smoothingTimeConstant = 0;
    master.connect(ctx.destination);
    for (const c of CHANNELS) {
      const an = ctx.createAnalyser(); an.fftSize = 1024; an.smoothingTimeConstant = 0;
      an.connect(master);
      ch[c.id] = an;
    }
  } catch { ctx = null; }
  return ctx;
}
// The context may only start from a tap or key press.
const wake = () => { const c = context(); if (c?.state === 'suspended') c.resume().catch(() => {}); };
for (const ev of ['pointerdown', 'keydown', 'touchend']) addEventListener(ev, wake, { capture: true, passive: true });

// For Web Audio playback (the audio editor's preview): the shared context and a channel's input.
export function channelInput(id) { const c = context(); return c ? { ctx: c, node: ch[id], start } : null; }

// Send a media element's sound through channel `id`. Safe to call more than once per element.
export function route(el, id) {
  const go = () => {
    if (routed.has(el)) { if (ctx.state !== 'running') ctx.resume().catch(() => {}); return start(); }
    const c = context();
    if (!c || c.state !== 'running') return; // plays straight out, unmetered
    try { c.createMediaElementSource(el).connect(ch[id]); routed.add(el); } catch {}
    start();
  };
  el.addEventListener('play', go);
  if (!el.paused) go();
}

// Peak and RMS of an analyser, in dB.
const bufs = new WeakMap();
function level(an) {
  let b = bufs.get(an);
  if (!b) bufs.set(an, (b = new Float32Array(an.fftSize)));
  an.getFloatTimeDomainData(b);
  let pk = 0, sq = 0;
  for (let i = 0; i < b.length; i++) { const v = Math.abs(b[i]); if (v > pk) pk = v; sq += v * v; }
  const dB = (v) => (v > 1e-6 ? 20 * Math.log10(v) : -120);
  return { peak: dB(pk), rms: dB(Math.sqrt(sq / b.length)) };
}

function start() {
  if (!raf) raf = requestAnimationFrame(frame);
  quietSince = 0;
}
function frame(t) {
  raf = 0;
  if (!ctx) return;
  const lv = { master: level(master) };
  for (const c of CHANNELS) lv[c.id] = level(ch[c.id]);
  for (const m of mixers) m.draw(lv, t);
  // Keep drawing until it has been quiet for a moment, so the bars fall back to zero.
  if (lv.master.peak > -70) quietSince = 0; else quietSince ||= t;
  if (!quietSince || t - quietSince < 1500) raf = requestAnimationFrame(frame);
  else for (const m of mixers) m.idle();
}

// A mixer: one bar per channel and a wider master bar, -60 to 0 dB, with peak hold.
// compact: master only (for tight spots).
export class Mixer {
  constructor(host, { compact = false } = {}) {
    this.compact = compact;
    this.el = document.createElement('div');
    this.el.className = 'mixer' + (compact ? ' compact' : '');
    this.el.setAttribute('role', 'img');
    this.el.setAttribute('aria-label', 'Sound output level');
    this.el.title = compact ? 'Sound output level' : 'Sound output: ' + CHANNELS.map((c) => c.name).join(', ') + ' and the total';
    const bars = compact ? [{ id: 'master', short: '' }] : [...CHANNELS, { id: 'master', short: '' }];
    this.el.innerHTML = bars.map((c) => `<div class="mbar${c.id === 'master' ? ' master' : ''}" data-ch="${c.id}"><i></i><b></b>${c.short ? `<em>${c.short}</em>` : ''}</div>`).join('');
    this.bars = {};
    for (const s of this.el.querySelectorAll('.mbar')) this.bars[s.dataset.ch] = { fill: s.querySelector('i'), hold: s.querySelector('b'), held: -120, at: 0, shown: -120 };
    host.appendChild(this.el);
    mixers.add(this);
  }
  draw(lv, t) {
    for (const id in this.bars) {
      const bar = this.bars[id], l = lv[id];
      if (!l) continue;
      // Fast up, smooth fall, like a real meter.
      const target = Math.max(l.rms + 3, l.peak - 6);
      bar.shown = target > bar.shown ? target : bar.shown - 1.2;
      if (l.peak >= bar.held || t - bar.at > 900) { bar.held = l.peak; bar.at = t; }
      const pos = (v) => Math.max(0, Math.min(1, (v + 60) / 60));
      bar.fill.style.clipPath = `inset(${((1 - pos(bar.shown)) * 100).toFixed(1)}% 0 0 0)`;
      bar.hold.style.bottom = pos(bar.held) * 100 + '%';
      bar.hold.className = bar.held > -1 ? 'clip' : bar.held > -9 ? 'hot' : '';
      bar.hold.style.opacity = bar.held > -60 ? 1 : 0;
    }
    this.el.classList.add('live');
  }
  idle() { this.el.classList.remove('live'); }
  remove() { mixers.delete(this); this.el.remove(); }
}
