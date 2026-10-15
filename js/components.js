// Object registry. Every object type describes its geometry as a list of
// "local primitives" around its own origin (terminals of two-lead parts sit at
// x = -1 and x = +1). The same primitives drive the SVG preview and the
// exported Manim code, so what you arrange is what Manim renders.

export const TAU = Math.PI * 2;

const L = (...pts) => ({ t: 'line', pts });                       // open polyline
const P = (fill, ...pts) => ({ t: 'poly', pts, fill });          // closed polygon
const A = (cx, cy, r, a0, da) => ({ t: 'arc', cx, cy, r, a0, da }); // arc, radians, CCW positive
const C = (cx, cy, r, fill = null) => ({ t: 'circle', cx, cy, r, fill });
const T = (x, y, text, size, math = false) => ({ t: math ? 'math' : 'text', x, y, text, size });

// Small "+" and "-" glyphs drawn as lines (no fonts needed in Manim).
const plus = (x, y, s = 0.08) => [L([x - s, y], [x + s, y]), L([x, y - s], [x, y + s])];
const minus = (x, y, s = 0.08) => [L([x - s, y], [x + s, y])];

// ---- math expressions (shared by preview and export) -----------------------
const FUNCS = ['sin', 'cos', 'tan', 'exp', 'log', 'sqrt', 'abs', 'floor', 'sign', 'tanh'];
export function checkExpr(src) {
  const s = String(src || '').trim();
  if (!s) return null;
  if (!/^[0-9a-z+\-*/^().,\s]*$/i.test(s)) return null;
  const ids = s.match(/[a-z_]+/gi) || [];
  for (const id of ids) if (id !== 'x' && id !== 'pi' && id !== 'e' && !FUNCS.includes(id)) return null;
  return s;
}
export function exprToJS(src) {
  const s = checkExpr(src);
  if (!s) return null;
  const js = s.replace(/\^/g, '**')
    .replace(/[a-z_]+/gi, (id) => (FUNCS.includes(id) ? 'Math.' + id : id === 'pi' ? 'Math.PI' : id === 'e' ? 'Math.E' : id));
  try { return new Function('x', `return (${js});`); } catch { return null; }
}
export function exprToPy(src) {
  const s = checkExpr(src);
  if (!s) return null;
  return s.replace(/\^/g, '**')
    .replace(/[a-z_]+/gi, (id) => (FUNCS.includes(id) ? 'np.' + id : id === 'pi' ? 'np.pi' : id === 'e' ? 'np.e' : id));
}

// ---- registry ----------------------------------------------------------------
// props: inspector fields specific to the type.
// Common fields every object has: x, y, rot, scale, color, sw (stroke width),
// fill, fo (fill opacity), label, enter, step, emph.
export const REG = {};
function def(type, d) { REG[type] = { type, ...d }; }

const twoLead = { sw: 4, scale: 1 };

def('resistor', {
  name: 'Resistor', sub: 'Passive', cat: 'Electronics', defaults: { ...twoLead, label: 'R' },
  prims: () => [L([-1, 0], [-0.6, 0], [-0.5, 0.2], [-0.3, -0.2], [-0.1, 0.2], [0.1, -0.2], [0.3, 0.2], [0.5, -0.2], [0.6, 0], [1, 0])],
});
def('capacitor', {
  name: 'Capacitor', sub: 'Passive', cat: 'Electronics', defaults: { ...twoLead, label: 'C' },
  prims: () => [L([-1, 0], [-0.12, 0]), L([-0.12, -0.4], [-0.12, 0.4]), L([0.12, -0.4], [0.12, 0.4]), L([0.12, 0], [1, 0])],
});
def('inductor', {
  name: 'Inductor', sub: 'Passive', cat: 'Electronics', defaults: { ...twoLead, label: 'L' },
  prims: () => [L([-1, 0], [-0.6, 0]), ...[-0.45, -0.15, 0.15, 0.45].map((cx) => A(cx, 0, 0.15, Math.PI, -Math.PI)), L([0.6, 0], [1, 0])],
});
def('battery', {
  name: 'Battery', sub: 'Sources', cat: 'Electronics', defaults: { ...twoLead, label: 'V' },
  prims: () => [L([-1, 0], [-0.12, 0]), L([-0.12, -0.45], [-0.12, 0.45]), P('stroke', [0.08, -0.22], [0.16, -0.22], [0.16, 0.22], [0.08, 0.22]), L([0.16, 0], [1, 0]), ...plus(-0.35, 0.4)],
});
def('vsource', {
  name: 'DC source', sub: 'Sources', cat: 'Electronics', defaults: { ...twoLead, label: 'V' },
  prims: () => [L([-1, 0], [-0.45, 0]), C(0, 0, 0.45), L([0.45, 0], [1, 0]), ...plus(-0.2, 0), ...minus(0.2, 0)],
});
def('acsource', {
  name: 'AC source', sub: 'Sources', cat: 'Electronics', defaults: { ...twoLead, label: '' },
  prims: () => {
    const wave = [];
    for (let i = 0; i <= 24; i++) { const t = i / 24; wave.push([-0.28 + 0.56 * t, 0.15 * Math.sin(t * TAU)]); }
    return [L([-1, 0], [-0.45, 0]), C(0, 0, 0.45), L([0.45, 0], [1, 0]), L(...wave)];
  },
});
def('diode', {
  name: 'Diode', sub: 'Semiconductors', cat: 'Electronics', defaults: { ...twoLead, label: 'D' },
  prims: () => [L([-1, 0], [-0.3, 0]), P('stroke', [-0.3, 0.3], [-0.3, -0.3], [0.25, 0]), L([0.25, -0.3], [0.25, 0.3]), L([0.25, 0], [1, 0])],
});
def('led', {
  name: 'LED', sub: 'Semiconductors', cat: 'Electronics', defaults: { ...twoLead, label: 'LED' },
  prims: () => [L([-1, 0], [-0.3, 0]), P('stroke', [-0.3, 0.3], [-0.3, -0.3], [0.25, 0]), L([0.25, -0.3], [0.25, 0.3]), L([0.25, 0], [1, 0]),
    L([0.0, 0.35], [0.25, 0.6]), P('stroke', [0.25, 0.6], [0.13, 0.56], [0.21, 0.48]),
    L([0.2, 0.3], [0.45, 0.55]), P('stroke', [0.45, 0.55], [0.33, 0.51], [0.41, 0.43])],
});
def('switch', {
  name: 'Switch', sub: 'Wiring', cat: 'Electronics', defaults: { ...twoLead, label: 'S', closed: false },
  props: [{ key: 'closed', label: 'Closed', type: 'bool' }],
  prims: (o) => [L([-1, 0], [-0.4, 0]), C(-0.4, 0, 0.06, 'stroke'), o.closed ? L([-0.4, 0], [0.4, 0.02]) : L([-0.4, 0], [0.3, 0.42]), C(0.4, 0, 0.06, 'stroke'), L([0.4, 0], [1, 0])],
});
def('lamp', {
  name: 'Lamp', sub: 'Passive', cat: 'Electronics', defaults: { ...twoLead, label: '' },
  prims: () => [L([-1, 0], [-0.4, 0]), C(0, 0, 0.4), L([-0.28, -0.28], [0.28, 0.28]), L([-0.28, 0.28], [0.28, -0.28]), L([0.4, 0], [1, 0])],
});
def('ground', {
  name: 'Ground', sub: 'Sources', cat: 'Electronics', defaults: { sw: 4, scale: 1, label: '' },
  prims: () => [L([0, 0.5], [0, 0]), L([-0.35, 0], [0.35, 0]), L([-0.22, -0.13], [0.22, -0.13]), L([-0.09, -0.26], [0.09, -0.26])],
});
def('npn', {
  name: 'NPN transistor', sub: 'Semiconductors', cat: 'Electronics', defaults: { sw: 4, scale: 1, label: 'Q' },
  prims: () => [C(0.2, 0, 0.62), L([-1, 0], [-0.15, 0]), L([-0.15, -0.35], [-0.15, 0.35]), L([-0.15, 0.15], [0.5, 0.5], [0.5, 1]),
    L([-0.15, -0.15], [0.5, -0.5], [0.5, -1]), P('stroke', [0.5, -0.5], [0.27, -0.47], [0.38, -0.3])],
});
def('opamp', {
  name: 'Op-amp', sub: 'Semiconductors', cat: 'Electronics', defaults: { sw: 4, scale: 1, label: '' },
  prims: () => [P(null, [-0.8, 0.9], [-0.8, -0.9], [0.9, 0]), L([-1.4, 0.45], [-0.8, 0.45]), L([-1.4, -0.45], [-0.8, -0.45]), L([0.9, 0], [1.4, 0]),
    ...minus(-0.6, 0.45), ...plus(-0.6, -0.45)],
});
def('node', {
  name: 'Junction', sub: 'Wiring', cat: 'Electronics', defaults: { sw: 4, scale: 1 }, noLabel: true,
  prims: () => [C(0, 0, 0.08, 'stroke')],
});
def('wire', {
  name: 'Wire', sub: 'Wiring', cat: 'Electronics', ends: true, noLabel: true, defaults: { sw: 4, dx: 2, dy: 0, route: 'hv' },
  props: [{ key: 'route', label: 'Routing', type: 'select', options: [['hv', 'Horizontal first'], ['vh', 'Vertical first'], ['straight', 'Straight']] }],
  prims: (o) => [L(...wirePts(o))],
});
export function wirePts(o) {
  const a = [0, 0], b = [o.dx, o.dy];
  if (o.route === 'straight' || o.dx === 0 || o.dy === 0) return [a, b];
  return o.route === 'vh' ? [a, [0, o.dy], b] : [a, [o.dx, 0], b];
}

// ---- general shapes --------------------------------------------------------
def('text', {
  name: 'Text', sub: 'Text', cat: 'Text', noLabel: true, defaults: { text: 'Text', size: 48, color: '#ffffff', font: '', bold: false, italic: false },
  props: [{ key: 'text', label: 'Text', type: 'text' }, { key: 'font', label: 'Font', type: 'font' }, { key: 'size', label: 'Font size', type: 'number', step: 2 },
    { key: 'bold', label: 'Bold', type: 'bool' }, { key: 'italic', label: 'Italic', type: 'bool' }],
  prims: (o) => [T(0, 0, o.text, o.size)],
});
def('math', {
  name: 'Math (LaTeX)', sub: 'Text', cat: 'Text', noLabel: true, defaults: { text: 'V = IR', size: 48, color: '#ffffff' },
  props: [{ key: 'text', label: 'LaTeX', type: 'text' }, { key: 'size', label: 'Font size', type: 'number', step: 2 }],
  prims: (o) => [T(0, 0, o.text, o.size, true)],
});
// A picture from the lesson's media. w and h are its size in scene units; the image
// itself lives in project.assets so undo snapshots and saved lessons stay small.
def('image', {
  name: 'Picture', sub: 'Pictures', cat: 'Media', noLabel: true, icon: 'image', defaults: { asset: null, w: 4, h: 3, opacity: 1, enter: 'FadeIn' },
  props: [{ key: 'w', label: 'Width', type: 'number', step: 0.25, min: 0.1 }, { key: 'h', label: 'Height', type: 'number', step: 0.25, min: 0.1 },
    { key: 'opacity', label: 'Opacity', type: 'range', step: 0.05, min: 0, max: 1 }],
  prims: (o) => [{ t: 'image', asset: o.asset, w: o.w, h: o.h, opacity: o.opacity ?? 1 }],
});
// A video clip. It starts playing on the click it enters and that click lasts until it ends.
def('video', {
  name: 'Video clip', sub: 'Video', cat: 'Media', noLabel: true, icon: 'film', defaults: { asset: null, w: 6, h: 3.375, opacity: 1, vol: 1, enter: 'FadeIn' },
  props: [{ key: 'w', label: 'Width', type: 'number', step: 0.25, min: 0.1 }, { key: 'h', label: 'Height', type: 'number', step: 0.25, min: 0.1 },
    { key: 'opacity', label: 'Opacity', type: 'range', step: 0.05, min: 0, max: 1 }, { key: 'vol', label: 'Volume', type: 'range', step: 0.05, min: 0, max: 1 }],
  prims: (o) => [{ t: 'image', asset: o.asset, w: o.w, h: o.h, opacity: o.opacity ?? 1, video: true }],
});
def('circle', {
  name: 'Circle', sub: 'Basic', cat: 'Shapes', fillable: true, noLabel: true, defaults: { r: 1, color: '#58c4dd', fill: '#58c4dd', fo: 0 },
  props: [{ key: 'r', label: 'Radius', type: 'number', step: 0.25 }],
  prims: (o) => [C(0, 0, o.r, 'shape')],
});
def('rect', {
  name: 'Rectangle', sub: 'Basic', cat: 'Shapes', fillable: true, noLabel: true, defaults: { w: 3, h: 2, color: '#83c167', fill: '#83c167', fo: 0 },
  props: [{ key: 'w', label: 'Width', type: 'number', step: 0.25 }, { key: 'h', label: 'Height', type: 'number', step: 0.25 }],
  prims: (o) => [P('shape', [-o.w / 2, o.h / 2], [-o.w / 2, -o.h / 2], [o.w / 2, -o.h / 2], [o.w / 2, o.h / 2])],
});
def('triangle', {
  name: 'Triangle', sub: 'Basic', cat: 'Shapes', fillable: true, noLabel: true, defaults: { r: 1, color: '#fc6255', fill: '#fc6255', fo: 0 },
  props: [{ key: 'r', label: 'Size', type: 'number', step: 0.25 }],
  prims: (o) => [P('shape', ...[90, 210, 330].map((d) => [o.r * Math.cos(d * Math.PI / 180), o.r * Math.sin(d * Math.PI / 180)]))],
});
def('ellipse', {
  name: 'Ellipse', sub: 'Basic', cat: 'Shapes', fillable: true, noLabel: true, defaults: { w: 3, h: 1.6, color: '#9a72ac', fill: '#9a72ac', fo: 0 },
  props: [{ key: 'w', label: 'Width', type: 'number', step: 0.25 }, { key: 'h', label: 'Height', type: 'number', step: 0.25 }],
  prims: (o) => {
    const pts = [];
    for (let i = 0; i < 64; i++) { const a = (i / 64) * TAU; pts.push([(o.w / 2) * Math.cos(a), (o.h / 2) * Math.sin(a)]); }
    return [P('shape', ...pts)];
  },
});
def('ngon', {
  name: 'Polygon', sub: 'Basic', cat: 'Shapes', fillable: true, noLabel: true, defaults: { r: 1, n: 6, color: '#e8c11c', fill: '#e8c11c', fo: 0 },
  props: [{ key: 'n', label: 'Sides', type: 'number', step: 1, min: 3 }, { key: 'r', label: 'Size', type: 'number', step: 0.25 }],
  prims: (o) => {
    const n = Math.max(3, Math.min(64, Math.round(o.n || 6)));
    return [P('shape', ...Array.from({ length: n }, (_, i) => { const a = Math.PI / 2 + (i / n) * TAU; return [o.r * Math.cos(a), o.r * Math.sin(a)]; }))];
  },
});
def('star', {
  name: 'Star', sub: 'Basic', cat: 'Shapes', fillable: true, noLabel: true, defaults: { r: 1, n: 5, inner: 0.45, color: '#ffff00', fill: '#ffff00', fo: 0 },
  props: [{ key: 'n', label: 'Points', type: 'number', step: 1, min: 3 }, { key: 'r', label: 'Size', type: 'number', step: 0.25 }, { key: 'inner', label: 'Inner ratio', type: 'number', step: 0.05, min: 0.1 }],
  prims: (o) => {
    const n = Math.max(3, Math.min(32, Math.round(o.n || 5)));
    return [P('shape', ...Array.from({ length: 2 * n }, (_, i) => { const a = Math.PI / 2 + (i / (2 * n)) * TAU, r = i % 2 ? o.r * o.inner : o.r; return [r * Math.cos(a), r * Math.sin(a)]; }))];
  },
});
def('darrow', {
  name: 'Double arrow', sub: 'Lines', cat: 'Shapes', ends: true, noLabel: true, defaults: { dx: 2, dy: 0, color: '#ffff00' },
  prims: (o) => {
    const len = Math.hypot(o.dx, o.dy) || 1e-6, ux = o.dx / len, uy = o.dy / len;
    const tl = Math.min(0.35, 0.2 * len), tw = tl * 0.9;
    const tip = (px, py, dx, dy) => { const bx = px - dx * tl, by = py - dy * tl; return P('stroke', [px, py], [bx - dy * tw / 2, by + dx * tw / 2], [bx + dy * tw / 2, by - dx * tw / 2]); };
    return [L([ux * tl, uy * tl], [o.dx - ux * tl, o.dy - uy * tl]), tip(o.dx, o.dy, ux, uy), tip(0, 0, -ux, -uy)];
  },
});
def('poly', {
  name: 'Freeform', sub: 'Draw', cat: 'Shapes', fillable: true, noLabel: true, draw: true,
  defaults: { pts: [[-1, -0.6], [1, -0.6], [0.4, 0.8]], closed: true, color: '#ffffff', fill: '#ffffff', fo: 0 },
  props: [{ key: 'closed', label: 'Closed', type: 'bool' }],
  prims: (o) => [o.closed ? P('shape', ...o.pts) : L(...o.pts)],
});
// A saved or grouped shape: children are ordinary objects in the group's own coordinates.
def('group', { name: 'Group', sub: 'Group', cat: null, noLabel: true, defaults: {}, prims: () => [] });
def('arrow', {
  name: 'Arrow', sub: 'Lines', cat: 'Shapes', ends: true, noLabel: true, defaults: { dx: 2, dy: 0, color: '#ffff00' },
  prims: (o) => {
    const len = Math.hypot(o.dx, o.dy) || 1e-6, ux = o.dx / len, uy = o.dy / len;
    const tl = Math.min(0.35, 0.25 * len), tw = tl * 0.9;
    const bx = o.dx - ux * tl, by = o.dy - uy * tl;
    return [L([0, 0], [bx, by]), P('stroke', [o.dx, o.dy], [bx - uy * tw / 2, by + ux * tw / 2], [bx + uy * tw / 2, by - ux * tw / 2])];
  },
});
def('line', {
  name: 'Line', sub: 'Lines', cat: 'Shapes', ends: true, noLabel: true, defaults: { dx: 2, dy: 0, color: '#ffffff' },
  prims: (o) => [L([0, 0], [o.dx, o.dy])],
});
def('dot', {
  name: 'Dot', sub: 'Lines', cat: 'Shapes', noLabel: true, defaults: { color: '#ffffff' },
  prims: () => [C(0, 0, 0.08, 'stroke')],
});
def('axes', {
  name: 'Graph', sub: 'Plots', cat: 'Graphs', noLabel: true,
  defaults: { w: 6, h: 3.5, xmin: 0, xmax: 6, xstep: 1, ymin: -1.5, ymax: 1.5, ystep: 0.5, fx: 'sin(x)', gcolor: '#ffff00', color: '#bbbbbb', sw: 4 },
  props: [
    { key: 'fx', label: 'y = f(x)', type: 'text', hint: 'e.g. 5*(1-exp(-x)), sin(2*pi*x)' },
    { key: 'gcolor', label: 'Curve colour', type: 'color' },
    { key: 'w', label: 'Width', type: 'number', step: 0.5 }, { key: 'h', label: 'Height', type: 'number', step: 0.5 },
    { key: 'xmin', label: 'x min', type: 'number' }, { key: 'xmax', label: 'x max', type: 'number' }, { key: 'xstep', label: 'x step', type: 'number' },
    { key: 'ymin', label: 'y min', type: 'number' }, { key: 'ymax', label: 'y max', type: 'number' }, { key: 'ystep', label: 'y step', type: 'number' },
  ],
  prims: (o) => {
    const { w, h, xmin, xmax, ymin, ymax } = o;
    const X = (v) => -w / 2 + (w * (v - xmin)) / (xmax - xmin || 1);
    const Y = (v) => -h / 2 + (h * (v - ymin)) / (ymax - ymin || 1);
    const x0 = X(Math.min(Math.max(0, xmin), xmax)), y0 = Y(Math.min(Math.max(0, ymin), ymax));
    const out = [L([-w / 2, y0], [w / 2, y0]), L([x0, -h / 2], [x0, h / 2])];
    for (const t of ticks(xmin, xmax, o.xstep)) out.push({ ...L([X(t), y0 - 0.1], [X(t), y0 + 0.1]), axis: true });
    for (const t of ticks(ymin, ymax, o.ystep)) out.push({ ...L([x0 - 0.1, Y(t)], [x0 + 0.1, Y(t)]), axis: true });
    out.forEach((p) => (p.thin = true));
    const f = exprToJS(o.fx);
    if (f) {
      const pts = [];
      for (let i = 0; i <= 120; i++) {
        const xv = xmin + ((xmax - xmin) * i) / 120;
        let yv; try { yv = f(xv); } catch { yv = NaN; }
        if (Number.isFinite(yv)) pts.push([X(xv), Y(yv)]);
      }
      if (pts.length > 1) out.push({ ...L(...pts), graph: true });
    }
    return out;
  },
});
function ticks(a, b, s) {
  const out = [];
  if (!(s > 0) || (b - a) / s > 200) return out;
  for (let v = a; v <= b + 1e-9; v += s) out.push(v);
  return out;
}

export const CATEGORIES = [
  { name: 'Electronics', subs: ['Passive', 'Sources', 'Semiconductors', 'Wiring'] },
  { name: 'Shapes', subs: ['Basic', 'Lines', 'Draw'] },
  { name: 'Text', subs: ['Text'] },
  { name: 'Graphs', subs: ['Plots'] },
  { name: 'Media', subs: ['Pictures', 'Video'] },
];

export const ENTER_ANIMS = ['Create', 'FadeIn', 'Write', 'GrowFromCenter', 'DrawBorderThenFill', 'None'];
export const EMPH_ANIMS = ['None', 'Indicate', 'Circumscribe', 'Wiggle', 'Flash', 'FlowCurrent'];

let seq = 0;
export function uid() { return Date.now().toString(36).slice(-5) + (seq++).toString(36) + Math.random().toString(36).slice(2, 5); }

export function makeObject(type, extra = {}) {
  const d = REG[type];
  return {
    id: uid(), type, x: 0, y: 0, rot: 0, scale: 1, color: '#ffffff', sw: 4, fill: '#ffffff', fo: 0, label: '',
    enter: type === 'text' || type === 'math' ? 'Write' : 'Create', step: 1, emph: 'None',
    ...d.defaults, ...extra,
  };
}
