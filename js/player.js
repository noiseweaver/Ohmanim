// Browser approximation of the Manim animations, used by "Play slide" and the
// presenter. It walks the same timeline the exporter writes out.
import { worldPrims, primsSVG, objectSVG, bbox, morphPrims, smooth, timeline } from './render.js';

const YELLOW = '#ffff00';
const f = (v) => (Math.round(v * 1000) / 1000).toString();

function hex(c) { const m = /^#?([0-9a-f]{6})$/i.exec(c || ''); return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : null; }
function mix(a, b, t) {
  const pa = hex(a), pb = hex(b);
  if (!pa || !pb) return a;
  return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('');
}
const thereAndBack = (t) => smooth(t < 0.5 ? 2 * t : 2 * (1 - t));
const about = (c, s, extra = '') => `translate(${f(c.cx)} ${f(-c.cy)})${extra} scale(${f(s)}) translate(${f(-c.cx)} ${f(c.cy)})`;

export function runTime(a) { return a.kind === 'emph' && a.anim === 'FlowCurrent' ? 1.5 : 1; }

function animSVG(a, t) {
  const e = smooth(t);
  if (a.kind === 'fadeout') return `<g opacity="${f(1 - e)}">${objectSVG(a.obj)}</g>`;
  if (a.kind === 'transform') {
    const A = worldPrims(a.from), B = worldPrims(a.to);
    const m = morphPrims(A, B, e);
    if (m) return primsSVG(m);
    return `<g opacity="${f(1 - e)}">${primsSVG(A)}</g><g opacity="${f(e)}">${primsSVG(B)}</g>`;
  }
  const o = a.obj, prims = worldPrims(o);
  if (a.kind === 'enter') {
    switch (a.anim) {
      case 'FadeIn': return `<g opacity="${f(e)}">${primsSVG(prims)}</g>`;
      case 'GrowFromCenter': return `<g transform="${about(bbox(prims), Math.max(e, 0.001))}">${primsSVG(prims)}</g>`;
      case 'None': return primsSVG(prims);
      default: return primsSVG(prims, { draw: e });
    }
  }
  // emphasis
  const c = bbox(prims);
  const k = thereAndBack(t);
  switch (a.anim) {
    case 'Indicate': {
      const tinted = prims.map((p) => ({ ...p, stroke: p.stroke && mix(p.stroke, YELLOW, k), fill: p.fill && mix(p.fill, YELLOW, k), color: p.color && mix(p.color, YELLOW, k) }));
      return `<g transform="${about(c, 1 + 0.2 * k)}">${primsSVG(tinted)}</g>`;
    }
    case 'Wiggle': {
      const ang = 0.03 * 360 * Math.sin(t * Math.PI * 6) * k;
      return `<g transform="${about(c, 1 + 0.1 * k, ` rotate(${f(-ang)})`)}">${primsSVG(prims)}</g>`;
    }
    case 'Circumscribe': {
      const b = 0.15;
      const rect = [{ k: 'path', closed: true, stroke: YELLOW, sw: 4, fill: null, fo: 0,
        pts: [[c.x0 - b, c.y1 + b], [c.x0 - b, c.y0 - b], [c.x1 + b, c.y0 - b], [c.x1 + b, c.y1 + b]] }];
      return primsSVG(prims) + primsSVG(rect, { flash: { head: e, width: 1, color: YELLOW } }).replace(/stroke-width="[^"]+"/, 'stroke-width="0.04"');
    }
    case 'Flash': {
      let s = primsSVG(prims);
      const r0 = 0.3 + 0.8 * e, r1 = Math.min(r0 + 0.3 * (1 - e) + 0.05, 1.1 + 0.3);
      for (let i = 0; i < 12; i++) {
        const ang = (i / 12) * Math.PI * 2, cx = Math.cos(ang), sy = Math.sin(ang);
        s += `<line x1="${f(c.cx + cx * r0)}" y1="${f(-(c.cy + sy * r0))}" x2="${f(c.cx + cx * r1)}" y2="${f(-(c.cy + sy * r1))}" stroke="${YELLOW}" stroke-width="0.03" stroke-linecap="round" opacity="${f(1 - e)}"/>`;
      }
      return s;
    }
    case 'FlowCurrent': {
      const body = prims.filter((p) => p.k === 'path' && !p.label);
      return primsSVG(prims) + primsSVG(body, { flash: { head: t, width: 0.5, color: YELLOW } });
    }
  }
  return primsSVG(prims);
}

// Visible objects after a beat. state: Map id -> obj (insertion order = z order)
export function applyBeat(state, beat) {
  const s = new Map(state);
  for (const phase of beat.phases) for (const a of phase) {
    if (a.kind === 'transform') s.set(a.id, a.to);
    else if (a.kind === 'fadeout') s.delete(a.id);
    else if (a.kind === 'enter') s.set(a.id, a.obj);
  }
  return s;
}

export function stateSVG(state) { let s = ''; for (const o of state.values()) s += objectSVG(o); return s; }

export class Player {
  constructor(target) { this.target = target; this.token = 0; }
  stop() { this.token++; }
  show(state) { this.stop(); this.target.innerHTML = stateSVG(state); }

  // Plays a beat starting from `state`; resolves to the new state (or null if interrupted).
  async play(state, beat, speed = 1) {
    const my = ++this.token;
    let cur = new Map(state);
    for (const phase of beat.phases) {
      const dur = (Math.max(...phase.map(runTime)) * 1000) / speed;
      const ids = new Set(phase.map((a) => a.id));
      const t0 = performance.now();
      await new Promise((resolve) => {
        const frame = (now) => {
          if (my !== this.token) return resolve();
          const t = Math.min(1, (now - t0) / dur);
          let s = '';
          for (const [id, o] of cur) if (!ids.has(id)) s += objectSVG(o);
          for (const a of phase) s += animSVG(a, t);
          this.target.innerHTML = s;
          if (t < 1) requestAnimationFrame(frame); else resolve();
        };
        requestAnimationFrame(frame);
      });
      if (my !== this.token) return null;
      cur = applyBeat(cur, { phases: [phase] });
    }
    this.target.innerHTML = stateSVG(cur);
    return cur;
  }
}

export { timeline };
