// Turns objects into world-space primitives and SVG markup, and builds the
// slide timeline (beats → phases → animations) shared by the preview player
// and the Manim exporter.
import { REG, TAU } from './components.js';
import { assetURL } from './backgrounds.js';

export const FRAME_W = 14.222222, FRAME_H = 8;
export const SW_UNIT = 0.01;   // Manim: stroke_width 4 ≈ 0.04 scene units
export const EM = 0.0144;      // scene units of 1em per font_size point (measured from Manim Text)
export const LABEL_SIZE = 32;
export const DEFAULT_FONT = 'DejaVu Sans';
// The lesson-wide font (set by the editor); objects with no font of their own use it.
export const fonts = { lesson: DEFAULT_FONT };
export const fontOf = (o) => o.font || fonts.lesson;
// The lesson's media (pictures), looked up by asset id when drawing. The app points this at its assets.
export const media = { assets: {} };

const d2r = (d) => (d * Math.PI) / 180;

function sampleArc(cx, cy, r, a0, da) {
  const n = Math.max(8, Math.ceil((Math.abs(da) / TAU) * 64));
  const out = [];
  for (let i = 0; i <= n; i++) { const a = a0 + (da * i) / n; out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return out;
}

// Label position for components: above when horizontal, right when vertical.
export function labelPos(o) {
  const r = ((o.rot % 360) + 360) % 360;
  const s = o.scale || 1;
  const vertical = r === 90 || r === 270;
  const off = o.type === 'npn' ? 0.95 : o.type === 'opamp' ? 1.15 : 0.7;
  return vertical ? [o.x + off * s, o.y] : [o.x, o.y + off * s];
}

export function worldPrims(o) {
  const d = REG[o.type];
  if (!d) return [];
  if (o.type === 'group') {
    // children live in the group's own coordinates; place them like any shape
    const s = o.scale ?? 1, r = d2r(o.rot || 0), c = Math.cos(r), sn = Math.sin(r);
    const tf = ([x, y]) => [o.x + s * (x * c - y * sn), o.y + s * (x * sn + y * c)];
    return (o.children || []).flatMap(worldPrims).map((p) => {
      if (p.k === 'path') return { ...p, pts: p.pts.map(tf) };
      const [x, y] = tf([p.x, p.y]);
      if (p.k === 'image') return { ...p, x, y, w: p.w * s, h: p.h * s, rot: (p.rot || 0) + (o.rot || 0) };
      return { ...p, x, y, size: p.size * s, rot: (p.rot || 0) + (o.rot || 0) };
    });
  }
  const local = d.prims(o);
  const s = o.scale ?? 1, r = d2r(o.rot || 0), c = Math.cos(r), sn = Math.sin(r);
  const tf = ([x, y]) => [o.x + s * (x * c - y * sn), o.y + s * (x * sn + y * c)];
  const out = [];
  for (const p of local) {
    let stroke = o.color, sw = o.sw ?? 4;
    if (p.thin) sw = 2;
    if (p.graph) { stroke = o.gcolor; sw = o.sw ?? 4; }
    const fillOf = (f) => (f === 'stroke' ? [o.color, 1] : f === 'shape' ? [o.fill, o.fo ?? 0] : [null, 0]);
    if (p.t === 'line' || p.t === 'poly') {
      const [fill, fo] = fillOf(p.fill);
      out.push({ k: 'path', pts: p.pts.map(tf), closed: p.t === 'poly', stroke, sw, fill, fo });
    } else if (p.t === 'arc') {
      out.push({ k: 'path', pts: sampleArc(p.cx, p.cy, p.r, p.a0, p.da).map(tf), closed: false, stroke, sw, fill: null, fo: 0 });
    } else if (p.t === 'circle') {
      const [fill, fo] = fillOf(p.fill);
      const pts = sampleArc(p.cx, p.cy, p.r, 0, TAU); pts.pop();
      out.push({ k: 'path', pts: pts.map(tf), closed: true, stroke, sw, fill, fo });
    } else if (p.t === 'image') {
      out.push({ k: 'image', x: o.x, y: o.y, w: p.w * s, h: p.h * s, rot: o.rot || 0, asset: p.asset, opacity: p.opacity, ...(p.video ? { video: true } : {}) });
    } else if (p.t === 'text' || p.t === 'math') {
      const [x, y] = tf([p.x, p.y]);
      out.push({ k: p.t, x, y, text: p.text, size: p.size * s, rot: o.rot || 0, color: o.color, font: fontOf(o), bold: !!o.bold, italic: !!o.italic });
    }
  }
  if (o.label && !d.noLabel) {
    const [x, y] = labelPos(o);
    out.push({ k: 'text', x, y, text: o.label, size: LABEL_SIZE, rot: 0, color: o.color, label: true, font: fonts.lesson });
  }
  return out;
}

let measureCtx = null;
export function textBox(p) {
  const em = p.size * EM;
  if (p.k !== 'math' && typeof document !== 'undefined') {
    measureCtx ||= document.createElement('canvas').getContext('2d');
    measureCtx.font = `${p.italic ? 'italic ' : ''}${p.bold ? '700 ' : ''}100px 'MV ${p.font || DEFAULT_FONT}', 'MV DejaVu Sans', sans-serif`;
    return { w: (measureCtx.measureText(p.text).width / 100) * em, h: em * 1.1 };
  }
  const w = p.k === 'math' ? em * 0.5 * Math.max(1, p.text.replace(/\\[a-z]+|[{}^_ ]/gi, 'x').length) : em * 0.52 * Math.max(1, p.text.length);
  return { w, h: em * 1.1 };
}

export function bbox(prims) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const p of prims) {
    if (p.k === 'path') p.pts.forEach(([x, y]) => add(x, y));
    else if (p.k === 'image') imageCorners(p).forEach(([x, y]) => add(x, y));
    else { const { w, h } = textBox(p); add(p.x - w / 2, p.y - h / 2); add(p.x + w / 2, p.y + h / 2); }
  }
  if (x0 === Infinity) return { x0: 0, y0: 0, x1: 0, y1: 0, cx: 0, cy: 0 };
  return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

function imageCorners(p) {
  const r = (p.rot || 0) * Math.PI / 180, c = Math.cos(r), sn = Math.sin(r);
  return [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([u, v]) => { const x = u * p.w / 2, y = v * p.h / 2; return [p.x + x * c - y * sn, p.y + x * sn + y * c]; });
}

const polyLen = (pts, closed) => {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  if (closed && pts.length > 1) l += Math.hypot(pts[0][0] - pts.at(-1)[0], pts[0][1] - pts.at(-1)[1]);
  return l;
};

const f = (n) => (Math.round(n * 1000) / 1000).toString();
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

let katexCache = new Map();
function katexHTML(tex) {
  if (!window.katex) return null;
  if (!katexCache.has(tex)) {
    try { katexCache.set(tex, window.katex.renderToString(tex, { throwOnError: false, displayMode: false })); }
    catch { katexCache.set(tex, null); }
  }
  return katexCache.get(tex);
}

// opts: { draw: 0..1 (Create progress), flash: {head, width} | null, hit: bool }
export function primsSVG(prims, opts = {}) {
  let out = '';
  for (const p of prims) {
    if (p.k === 'path') {
      const d = 'M' + p.pts.map(([x, y]) => `${f(x)} ${f(-y)}`).join('L') + (p.closed ? 'Z' : '');
      let extra = '';
      let fo = p.fo;
      if (opts.draw != null && opts.draw < 1) {
        const len = polyLen(p.pts, p.closed) || 1e-6;
        extra = ` stroke-dasharray="${f(len)} ${f(len + 1)}" stroke-dashoffset="${f(len * (1 - opts.draw))}"`;
        fo *= opts.draw;
      }
      if (opts.flash) {
        const len = polyLen(p.pts, p.closed) || 1e-6;
        const w = opts.flash.width * len, head = opts.flash.head * (len + w);
        extra = ` stroke-dasharray="0 ${f(Math.max(0, head - w))} ${f(w)} ${f(len * 3)}"`;
        out += `<path d="${d}" fill="none" stroke="${opts.flash.color}" stroke-width="${f(p.sw * SW_UNIT * 2)}" stroke-linecap="round" stroke-linejoin="round"${extra}/>`;
        continue;
      }
      out += `<path d="${d}" fill="${p.fill || 'none'}" fill-opacity="${f(fo)}" stroke="${p.stroke}" stroke-width="${f(p.sw * SW_UNIT)}" stroke-linejoin="round" stroke-linecap="round"${extra}/>`;
      if (opts.hit) out += `<path d="${d}" class="hit" fill="${p.fill && p.fo > 0.05 ? 'transparent' : 'none'}" stroke="transparent" stroke-width="0.25"/>`;
    } else if (p.k === 'image') {
      if (opts.flash) continue;
      const op = (p.opacity ?? 1) * (opts.draw != null && opts.draw < 1 ? opts.draw : 1);
      const a = media.assets?.[p.asset];
      const rot = p.rot ? ` rotate(${f(-p.rot)})` : '';
      const box = `x="${f(-p.w / 2)}" y="${f(-p.h / 2)}" width="${f(p.w)}" height="${f(p.h)}"`;
      const href = a && (p.video ? (a.poster ? assetURL({ src: a.poster }) : '') : assetURL(a));
      out += `<g transform="translate(${f(p.x)} ${f(-p.y)})${rot}"${op < 1 ? ` opacity="${f(op)}"` : ''}>` + (href
        ? `<image href="${href}" ${box} preserveAspectRatio="none"/>` +
          // In the editor a clip shows a play badge so it reads as video, not a picture.
          (p.video && opts.hit ? `<g opacity="0.85"><circle r="${f(Math.min(p.w, p.h) * 0.12)}" fill="#000000" fill-opacity="0.55"/><path d="M${f(-Math.min(p.w, p.h) * 0.04)} ${f(-Math.min(p.w, p.h) * 0.06)}L${f(Math.min(p.w, p.h) * 0.065)} 0L${f(-Math.min(p.w, p.h) * 0.04)} ${f(Math.min(p.w, p.h) * 0.06)}Z" fill="#ffffff"/></g>` : '')
        // No picture yet (or it went missing): a dashed frame with a mountain, so the object stays visible.
        : `<rect ${box} fill="#80808033" stroke="#808080" stroke-width="0.03" stroke-dasharray="0.15 0.1"/>` +
          `<path d="M${f(-p.w * 0.3)} ${f(p.h * 0.25)}L${f(-p.w * 0.08)} ${f(-p.h * 0.1)}L${f(p.w * 0.05)} ${f(p.h * 0.08)}L${f(p.w * 0.15)} ${f(-p.h * 0.02)}L${f(p.w * 0.3)} ${f(p.h * 0.25)}Z" fill="#808080"/>`) + '</g>';
      if (opts.hit) out += `<path class="hit" d="M${imageCorners(p).map(([x, y]) => `${f(x)} ${f(-y)}`).join('L')}Z" fill="transparent"/>`;
    } else {
      const op = opts.draw != null && opts.draw < 1 ? ` opacity="${f(opts.draw)}"` : '';
      if (opts.flash) continue;
      const em = p.size * EM;
      const rot = p.rot ? ` rotate(${f(-p.rot)})` : '';
      const html = p.k === 'math' ? katexHTML(p.text) : null;
      if (html) {
        // foreignObject at 100x scale so browsers don't clamp tiny font sizes.
        out += `<g transform="translate(${f(p.x)} ${f(-p.y)})${rot} scale(0.01)"${op}><foreignObject x="-1500" y="-400" width="3000" height="800">` +
          `<div xmlns="http://www.w3.org/1999/xhtml" class="mathfo" style="font-size:${f(em * 100 * 0.82)}px;color:${p.color}">${html}</div></foreignObject></g>`;
      } else {
        out += `<g transform="translate(${f(p.x)} ${f(-p.y)})${rot}"${op}><text x="0" y="0" font-size="${f(em)}" fill="${p.color}" text-anchor="middle" dominant-baseline="central"${p.k === 'math' ? ' font-style="italic" font-family="serif"' : ` font-family="'MV ${esc(p.font || DEFAULT_FONT)}', 'MV DejaVu Sans', sans-serif"${p.bold ? ' font-weight="700"' : ''}${p.italic ? ' font-style="italic"' : ''}`}>${esc(p.text)}</text></g>`;
      }
      if (opts.hit) { const { w, h } = textBox(p); out += `<rect class="hit" x="${f(p.x - w / 2)}" y="${f(-p.y - h / 2)}" width="${f(w)}" height="${f(h)}" fill="transparent"/>`; }
    }
  }
  return out;
}

export function objectSVG(o, opts = {}) {
  return primsSVG(worldPrims(o), opts);
}

// ---- morphing ----------------------------------------------------------------
function subdivideTo(pts, n, closed) {
  const p = pts.map((q) => q.slice());
  if (closed) p.push(p[0].slice());
  while (p.length < n + (closed ? 1 : 0)) {
    let best = 0, bl = -1;
    for (let i = 1; i < p.length; i++) { const l = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); if (l > bl) { bl = l; best = i; } }
    p.splice(best, 0, [(p[best][0] + p[best - 1][0]) / 2, (p[best][1] + p[best - 1][1]) / 2]);
  }
  if (closed) p.pop();
  return p;
}
const lerp = (a, b, t) => a + (b - a) * t;
function lerpColor(a, b, t) {
  const pa = hex(a), pb = hex(b);
  if (!pa || !pb) return t < 0.5 ? a : b;
  return '#' + pa.map((v, i) => Math.round(lerp(v, pb[i], t)).toString(16).padStart(2, '0')).join('');
}
function hex(c) { const m = /^#?([0-9a-f]{6})$/i.exec(c || ''); return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : null; }

export function morphPrims(A, B, t) {
  // Compatible if same prim kinds in the same order; otherwise caller crossfades.
  if (A.length !== B.length || A.some((p, i) => p.k !== B[i].k || (p.k === 'path' && p.closed !== B[i].closed) || (p.k !== 'path' && p.text !== B[i].text) || p.asset !== B[i].asset)) return null;
  return A.map((a, i) => {
    const b = B[i];
    if (a.k === 'path') {
      const n = Math.max(a.pts.length, b.pts.length);
      const pa = subdivideTo(a.pts, n, a.closed), pb = subdivideTo(b.pts, n, b.closed);
      return { ...b, pts: pa.map((q, j) => [lerp(q[0], pb[j][0], t), lerp(q[1], pb[j][1], t)]), stroke: lerpColor(a.stroke, b.stroke, t),
        fill: a.fill || b.fill ? lerpColor(a.fill || b.fill, b.fill || a.fill, t) : null, fo: lerp(a.fo, b.fo, t), sw: lerp(a.sw, b.sw, t) };
    }
    if (a.k === 'image') return { ...b, x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t), rot: lerp(a.rot, b.rot, t), opacity: lerp(a.opacity ?? 1, b.opacity ?? 1, t) };
    return { ...b, x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), size: lerp(a.size, b.size, t), rot: lerp(a.rot, b.rot, t), color: lerpColor(a.color, b.color, t) };
  });
}

// ---- timeline ----------------------------------------------------------------
// A beat is what one click plays. Beats contain sequential phases; each phase
// is a list of animations that run together (one `self.play(...)` in Manim).
const stateKey = (o) => { const { enter, step, emph, emphs, mstep, name, role, ...rest } = o; return JSON.stringify(rest); };

// An object's emphasis animations, each at its own step. Older lessons stored one `emph`
// that played at the object's own step.
export function emphList(o) {
  if (Array.isArray(o.emphs)) return o.emphs.filter((e) => e && e.anim && e.anim !== 'None');
  return o.emph && o.emph !== 'None' ? [{ anim: o.emph, step: o.step || 1 }] : [];
}
const stepOf = (v) => Math.max(1, Math.round(v || 1));

// Each slide plays as a list of beats (one per click). A beat runs its phases in order:
// morphs and fade-outs from the previous slide, then entrances, then emphasis.
// Morphs and fade-outs play on the slide's first beat unless given their own step
// (`o.mstep` on a carried object, `slide.outSteps[id]` for one that left).
// The shortest a click lasts, in seconds: its own hold time, else the lesson's. A click also
// lasts as long as its animations and its narration.
export const DEFAULT_HOLD = 2;
export const holdOf = (project, slide, k) => slide.holds?.[k] ?? project.hold ?? DEFAULT_HOLD;

export function timeline(project) {
  const beats = [];
  project.slides.forEach((slide, si) => {
    const prev = si > 0 ? project.slides[si - 1].objects : [];
    const prevById = new Map(prev.map((o) => [o.id, o]));
    const curIds = new Set(slide.objects.map((o) => o.id));
    const outSteps = slide.outSteps || {};
    const steps = new Map();
    const at = (k) => { if (!steps.has(k)) steps.set(k, { trans: [], enter: [], emph: [] }); return steps.get(k); };
    const firstTrans = [];
    for (const o of slide.objects) {
      const p = prevById.get(o.id);
      if (p && stateKey(p) !== stateKey(o)) {
        const a = { kind: 'transform', id: o.id, from: p, to: o };
        o.mstep ? at(stepOf(o.mstep)).trans.push(a) : firstTrans.push(a);
      }
      if (!p) at(stepOf(o.step)).enter.push({ kind: 'enter', id: o.id, obj: o, anim: o.enter || 'Create' });
      for (const e of emphList(o)) at(stepOf(e.step)).emph.push({ kind: 'emph', id: o.id, obj: o, anim: e.anim });
    }
    for (const p of prev) {
      if (curIds.has(p.id)) continue;
      const a = { kind: 'fadeout', id: p.id, obj: p };
      outSteps[p.id] ? at(stepOf(outSteps[p.id])).trans.push(a) : firstTrans.push(a);
    }
    // A click with narration is a beat even when nothing animates on it.
    const voice = slide.voice || {};
    for (const k in voice) if (voice[k]) at(stepOf(+k));
    // So is a click given its own hold time.
    for (const k in slide.holds || {}) at(stepOf(+k));
    // And a click with a sound effect.
    const sounds = slide.sounds || {};
    for (const k in sounds) if (sounds[k]?.length) at(stepOf(+k));
    const keys = [...steps.keys()].sort((a, b) => a - b);
    if (!keys.length) keys.push(1), at(1);
    keys.forEach((k, i) => {
      const s = steps.get(k);
      const trans = i === 0 ? [...firstTrans, ...s.trans] : s.trans;
      const phases = [];
      if (trans.length) phases.push(trans);
      if (s.enter.length) phases.push(s.enter);
      if (s.emph.length) phases.push(s.emph);
      // Video clips that enter on this click play to their end before the next one.
      const clip = Math.max(0, ...s.enter.filter((a) => a.obj.type === 'video').map((a) => project.assets?.[a.obj.asset]?.dur || 0));
      beats.push({ slide: si, step: k, first: i === 0, phases, clip, voice: voice[k] || null, caption: (voice[k] && slide.captions?.[k]) || '', hold: holdOf(project, slide, k), sounds: sounds[k] || [] });
    });
  });
  return beats;
}

export function smooth(t, inflection = 10) {
  const sig = (x) => 1 / (1 + Math.exp(-x));
  const err = sig(-inflection / 2);
  return Math.min(1, Math.max(0, (sig(inflection * (t - 0.5)) - err) / (1 - 2 * err)));
}
