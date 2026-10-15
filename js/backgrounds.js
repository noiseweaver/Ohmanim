// Slide backgrounds: a fill (solid, linear or radial gradient), an optional image,
// a pattern of lines or dots, and a vignette. The same description draws the SVG
// preview and generates the Manim code, so the render matches the editor.
//
// A background is { fill, color, color2, angle, pattern, pcolor, popacity, pspacing,
// pweight, image, fit, iscale, iopacity, dim, vignette }. The lesson's background
// lives in project.background and takes its colour from project.bg (which slide
// themes set); a slide can carry its own in slide.background.

export const FW = 14.222222222222221, FH = 8, HX = FW / 2, HY = FH / 2;
const FR = Math.hypot(FW, FH) / 2;

export const BG_DEFAULT = {
  fill: 'solid', color2: '#1d2b53', angle: 90,
  pattern: 'none', pcolor: null, popacity: 0.22, pspacing: 0.5, pweight: 1,
  image: null, fit: 'cover', iscale: 3, iopacity: 1, dim: 0,
  vignette: 0,
};

export const FILLS = [['solid', 'Solid'], ['linear', 'Linear gradient'], ['radial', 'Radial gradient']];
export const PATTERNS = [
  ['none', 'None'], ['grid', 'Grid'], ['graph', 'Graph paper'], ['dots', 'Dot grid'], ['perfboard', 'Perfboard'],
  ['isometric', 'Isometric'], ['polar', 'Polar (phasors)'], ['ruled', 'Ruled lines'], ['diagonal', 'Diagonal lines'], ['cross', 'Crosshatch'],
];
export const FITS = [['cover', 'Fill the slide'], ['contain', 'Fit inside'], ['stretch', 'Stretch'], ['tile', 'Tile']];

// Presets. "pattern" presets keep the slide's colours; "look" presets set them too.
export const PRESETS = [
  { id: 'plain', name: 'Plain', kind: 'pattern', bg: { pattern: 'none', fill: 'solid', vignette: 0, image: null } },
  { id: 'grid', name: 'Grid', kind: 'pattern', bg: { pattern: 'grid', pspacing: 0.5, popacity: 0.14, pweight: 1 } },
  { id: 'graph', name: 'Graph paper', kind: 'pattern', bg: { pattern: 'graph', pspacing: 0.25, popacity: 0.1, pweight: 1 } },
  { id: 'dots', name: 'Dot grid', kind: 'pattern', bg: { pattern: 'dots', pspacing: 0.5, popacity: 0.35, pweight: 1 } },
  { id: 'perfboard', name: 'Perfboard', kind: 'pattern', bg: { pattern: 'perfboard', pspacing: 0.5, popacity: 0.2, pweight: 1.5 } },
  { id: 'isometric', name: 'Isometric', kind: 'pattern', bg: { pattern: 'isometric', pspacing: 0.6, popacity: 0.12, pweight: 1 } },
  { id: 'polar', name: 'Polar', kind: 'pattern', bg: { pattern: 'polar', pspacing: 0.75, popacity: 0.16, pweight: 1 } },
  { id: 'ruled', name: 'Ruled', kind: 'pattern', bg: { pattern: 'ruled', pspacing: 0.6, popacity: 0.16, pweight: 1 } },
  { id: 'blackboard', name: 'Blackboard', kind: 'look', bg: { fill: 'radial', color: '#2b3a33', color2: '#141c18', pattern: 'none', vignette: 0.35 } },
  { id: 'blueprint', name: 'Blueprint', kind: 'look', bg: { fill: 'solid', color: '#0d3b78', pattern: 'graph', pcolor: '#cfe3ff', pspacing: 0.25, popacity: 0.14, pweight: 1, vignette: 0.2 } },
  { id: 'scope', name: 'Oscilloscope', kind: 'look', bg: { fill: 'radial', color: '#0b2416', color2: '#020805', pattern: 'graph', pcolor: '#3dff8a', pspacing: 0.4, popacity: 0.16, pweight: 1, vignette: 0.45 } },
  { id: 'midnight', name: 'Midnight', kind: 'look', bg: { fill: 'linear', color: '#0b1026', color2: '#27305e', angle: 90, pattern: 'none', vignette: 0 } },
  { id: 'spotlight', name: 'Spotlight', kind: 'look', bg: { fill: 'radial', color: '#30343f', color2: '#0b0c10', pattern: 'none', vignette: 0.3 } },
  { id: 'space', name: 'Deep space', kind: 'look', bg: { fill: 'radial', color: '#1b1640', color2: '#05040d', pattern: 'dots', pcolor: '#ffffff', pspacing: 0.75, popacity: 0.25, pweight: 0.6, vignette: 0.3 } },
  { id: 'sunset', name: 'Sunset', kind: 'look', bg: { fill: 'linear', color: '#2a1036', color2: '#7a2f3a', angle: 60, pattern: 'none', vignette: 0.15 } },
  { id: 'paper', name: 'Paper', kind: 'look', bg: { fill: 'solid', color: '#f5f1e6', pattern: 'ruled', pcolor: '#3b6fb6', pspacing: 0.6, popacity: 0.25, pweight: 1, vignette: 0 } },
];

// Effective background of a slide (or of the lesson when slide is null).
export function bgOf(project, slide) {
  const own = slide && slide.background;
  const b = { ...BG_DEFAULT, ...(own || project.background || {}) };
  if (!own || !own.color) b.color = project.bg || '#000000';
  return b;
}
export const bgKey = (b) => JSON.stringify(b);
export const isPlain = (b) => b.fill === 'solid' && b.pattern === 'none' && !b.image && !(b.vignette > 0);

function lum(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return 0;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
// Whether the slide reads as light, for picking lines that contrast with it.
export const isLight = (b) => (b.fill === 'solid' ? lum(b.color) : (lum(b.color) + lum(b.color2)) / 2) > 0.55;
// Pattern lines default to black on light slides and white on dark ones.
export const patternColor = (b) => b.pcolor || (isLight(b) ? '#000000' : '#ffffff');

// ---- geometry shared by the preview and the export -----------------------------
function family(theta, d, every, out) {
  const t = (theta * Math.PI) / 180, u = [Math.cos(t), Math.sin(t)], nv = [-u[1], u[0]];
  const K = Math.ceil(FR / d);
  for (let k = -K; k <= K; k++) {
    const c = [nv[0] * k * d, nv[1] * k * d];
    (every && k % every === 0 ? out.major : out.minor).push([c[0] - u[0] * FR, c[1] - u[1] * FR, c[0] + u[0] * FR, c[1] + u[1] * FR]);
  }
}
function lattice(s) {
  const pts = [];
  for (let i = -Math.ceil(HX / s); i <= Math.ceil(HX / s); i++) for (let j = -Math.ceil(HY / s); j <= Math.ceil(HY / s); j++) pts.push([i * s, j * s]);
  return pts;
}
// {minor: [[x0,y0,x1,y1]], major: [...], rings: [[cx,cy,r]], dots: [[cx,cy,r]]} in Manim units.
export function patternGeometry(b) {
  const s = Math.max(0.1, +b.pspacing || 0.5);
  const g = { minor: [], major: [], rings: [], dots: [] };
  switch (b.pattern) {
    case 'grid': family(0, s, 0, g); family(90, s, 0, g); break;
    case 'graph': family(0, s, 5, g); family(90, s, 5, g); break;
    case 'ruled': family(0, s, 0, g); break;
    case 'diagonal': family(45, s, 0, g); break;
    case 'cross': family(45, s, 0, g); family(135, s, 0, g); break;
    case 'isometric': { const d = (s * Math.sqrt(3)) / 2; family(90, d, 0, g); family(30, d, 0, g); family(150, d, 0, g); break; }
    case 'polar':
      for (let k = 1; k * s <= FR; k++) g.rings.push([0, 0, k * s]);
      for (let a = 0; a < 360; a += 15) {
        const t = (a * Math.PI) / 180;
        (a % 90 === 0 ? g.major : g.minor).push([0, 0, Math.cos(t) * FR, Math.sin(t) * FR]);
      }
      break;
    case 'dots': for (const [x, y] of lattice(s)) g.dots.push([x, y, 0.012 + 0.018 * (+b.pweight || 1)]); break;
    case 'perfboard': for (const [x, y] of lattice(s)) g.rings.push([x, y, s * 0.24]); break;
  }
  return g;
}

// Size and position of the image (Manim units, centre-based) for each fit.
export function imageLayout(b, asset) {
  const a = asset.w / asset.h, fa = FW / FH;
  if (b.fit === 'stretch') return [{ x: 0, y: 0, w: FW, h: FH }];
  if (b.fit === 'contain') return [a > fa ? { x: 0, y: 0, w: FW, h: FW / a } : { x: 0, y: 0, w: FH * a, h: FH }];
  if (b.fit === 'tile') {
    const tw = Math.max(0.25, +b.iscale || 3), th = tw / a, out = [];
    for (let i = -Math.ceil(HX / tw); i < Math.ceil(HX / tw); i++)
      for (let j = -Math.ceil(HY / th); j < Math.ceil(HY / th); j++) out.push({ x: (i + 0.5) * tw, y: (j + 0.5) * th, w: tw, h: th });
    return out;
  }
  return [a > fa ? { x: 0, y: 0, w: FH * a, h: FH } : { x: 0, y: 0, w: FW, h: FW / a }];
}

// ---- SVG ------------------------------------------------------------------------
const r4 = (v) => Math.round(v * 10000) / 10000;
let uid = 0;
const urls = new Map();
// Blob URLs keep large data: URIs out of the DOM (thumbnails repeat them).
export function assetURL(asset) {
  if (!asset) return '';
  let u = urls.get(asset.src);
  if (!u) {
    try {
      const [head, data] = asset.src.split(',');
      const bin = atob(data), u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      u = URL.createObjectURL(new Blob([u8], { type: /data:([^;]+)/.exec(head)?.[1] || 'image/png' }));
    } catch { u = asset.src; }
    urls.set(asset.src, u);
  }
  return u;
}

export function bgSVG(b, project, { assets = project.assets || {} } = {}) {
  const id = 'bg' + (++uid).toString(36);
  let defs = '', s = '';
  const box = `x="${r4(-HX)}" y="${-HY}" width="${r4(FW)}" height="${FH}"`;
  if (b.fill === 'linear') {
    const t = (b.angle * Math.PI) / 180, ox = HX * Math.cos(t), oy = HY * Math.sin(t);
    defs += `<linearGradient id="${id}f" gradientUnits="userSpaceOnUse" x1="${r4(-ox)}" y1="${r4(oy)}" x2="${r4(ox)}" y2="${r4(-oy)}"><stop offset="0" stop-color="${b.color}"/><stop offset="1" stop-color="${b.color2}"/></linearGradient>`;
    s += `<rect ${box} fill="url(#${id}f)"/>`;
  } else if (b.fill === 'radial') {
    defs += `<radialGradient id="${id}f" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="${r4(FR)}"><stop offset="0" stop-color="${b.color}"/><stop offset="1" stop-color="${b.color2}"/></radialGradient>`;
    s += `<rect ${box} fill="url(#${id}f)"/>`;
  } else s += `<rect ${box} fill="${b.color}"/>`;
  const asset = b.image && assets[b.image];
  if (asset) {
    const href = assetURL(asset), op = +b.iopacity;
    for (const L of imageLayout(b, asset))
      s += `<image href="${href}" x="${r4(L.x - L.w / 2)}" y="${r4(-L.y - L.h / 2)}" width="${r4(L.w)}" height="${r4(L.h)}" preserveAspectRatio="none" opacity="${op}"/>`;
    if (b.dim > 0) s += `<rect ${box} fill="${b.color}" opacity="${b.dim}"/>`;
  }
  if (b.pattern !== 'none') {
    const g = patternGeometry(b), c = patternColor(b), w = (+b.pweight || 1) * 0.01, op = +b.popacity;
    const seg = (L) => L.map(([x0, y0, x1, y1]) => `M${r4(x0)} ${r4(-y0)}L${r4(x1)} ${r4(-y1)}`).join('');
    if (g.minor.length) s += `<path d="${seg(g.minor)}" stroke="${c}" stroke-width="${r4(w)}" stroke-opacity="${op}" fill="none"/>`;
    if (g.major.length) s += `<path d="${seg(g.major)}" stroke="${c}" stroke-width="${r4(w * 2)}" stroke-opacity="${Math.min(1, op * 1.8)}" fill="none"/>`;
    if (g.rings.length) s += `<g fill="none" stroke="${c}" stroke-width="${r4(w * (b.pattern === 'perfboard' ? 2 : 1))}" stroke-opacity="${op}">${g.rings.map(([x, y, r]) => `<circle cx="${r4(x)}" cy="${r4(-y)}" r="${r4(r)}"/>`).join('')}</g>`;
    if (g.dots.length) s += `<g fill="${c}" fill-opacity="${op}">${g.dots.map(([x, y, r]) => `<circle cx="${r4(x)}" cy="${r4(-y)}" r="${r4(r)}"/>`).join('')}</g>`;
  }
  if (b.vignette > 0) {
    const v = +b.vignette, r0 = 0.35;
    defs += `<radialGradient id="${id}v" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="${r4(FR)}"><stop offset="${r0}" stop-color="#000" stop-opacity="0"/>` +
      [0.25, 0.5, 0.75, 1].map((t) => `<stop offset="${r4(r0 + (1 - r0) * t)}" stop-color="#000" stop-opacity="${r4(v * t * t)}"/>`).join('') + '</radialGradient>';
    s += `<rect ${box} fill="url(#${id}v)"/>`;
  }
  return (defs ? `<defs>${defs}</defs>` : '') + s;
}

// ---- images ---------------------------------------------------------------------
// Read an image file, scaled down so the lesson stays small enough to save in the browser.
export function importImage(file, max = 1920) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      // Keep PNG when the image has transparency; everything else becomes JPEG.
      let alpha = false;
      if (/png|webp|gif|svg/.test(file.type)) {
        const d = ctx.getImageData(0, 0, w, h).data;
        for (let i = 3; i < d.length; i += 4 * 7) if (d[i] < 250) { alpha = true; break; }
      }
      const type = alpha ? 'image/png' : 'image/jpeg';
      resolve({ src: c.toDataURL(type, 0.86), w, h, type, name: file.name || 'image' });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not an image this browser can read')); };
    img.src = url;
  });
}
export const assetFile = (id, asset) => `bg-${id}.${asset.type === 'image/png' ? 'png' : 'jpg'}`;
export function assetBytes(asset) {
  const bin = atob(asset.src.split(',')[1]), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}
// Asset ids the lesson uses: background images, pictures, narration, sound effects and music.
export function usedAssets(project, kind = null) {
  const ids = new Set();
  if (kind !== 'audio') for (const b of [project.background, ...project.slides.map((s) => s.background)]) if (b && b.image && project.assets?.[b.image]) ids.add(b.image);
  const pics = (objs) => { for (const o of objs || []) { if (o.type === 'image' && o.asset && project.assets?.[o.asset]) ids.add(o.asset); if (o.children) pics(o.children); } };
  if (kind !== 'audio') for (const s of project.slides) pics(s.objects);
  const audio = (id) => id && project.assets?.[id] && ids.add(id);
  if (kind !== 'image') {
    for (const s of project.slides) {
      Object.values(s.voice || {}).forEach(audio);
      Object.values(s.sounds || {}).forEach((list) => (list || []).forEach((sd) => audio(sd.asset)));
    }
    audio(project.music?.asset);
  }
  return [...ids];
}
// File name an asset gets next to the exported code.
export const mediaFile = (id, asset) => (asset.kind === 'audio' ? `audio-${id}.wav` : assetFile(id, asset));

// ---- Manim export ---------------------------------------------------------------
export const BG_HELPERS = `
# --- backgrounds -------------------------------------------------------------
from pathlib import Path as _Path
_HERE = _Path(__file__).parent if "__file__" in globals() else _Path(".")
_FW, _FH = 14.222222222222221, 8.0
_FR = float(np.hypot(_FW, _FH) / 2)


def _bg_fill(kind, c1, c2, angle):
    if kind == "radial":
        g, n = VGroup(), 48
        for i in range(n):
            col = interpolate_color(ManimColor(c2), ManimColor(c1), i / (n - 1))
            g.add(Circle(radius=_FR * (1 - i / n) + 0.01).set_stroke(width=0).set_fill(col, 1))
        return g
    r = Rectangle(width=_FW + 0.02, height=_FH + 0.02).set_stroke(width=0)
    if kind == "linear":
        r.set_fill([ManimColor(c1), ManimColor(c2)], 1)
        r.set_sheen_direction([np.cos(angle * DEGREES), np.sin(angle * DEGREES), 0])
    else:
        r.set_fill(c1, 1)
    return r


def _bg_lines(segs, color, width, opacity):
    pts = []
    for x0, y0, x1, y1 in segs:
        a, b = np.array([x0, y0, 0.0]), np.array([x1, y1, 0.0])
        pts += [a, a + (b - a) / 3, a + 2 * (b - a) / 3, b]
    m = VMobject()
    if pts:
        m.set_points(np.array(pts))
    return m.set_stroke(color, width=width, opacity=opacity).set_fill(opacity=0)


def _bg_circles(circles, color, width, opacity, fill=False):
    unit = Circle(radius=1).points
    m = VMobject()
    if circles:
        m.set_points(np.concatenate([unit * r + np.array([x, y, 0.0]) for x, y, r in circles]))
    if fill:
        return m.set_fill(color, opacity).set_stroke(width=0)
    return m.set_stroke(color, width=width, opacity=opacity).set_fill(opacity=0)


def _bg_family(theta, d, every, minor, major):
    t = theta * DEGREES
    u, nv = np.array([np.cos(t), np.sin(t)]), np.array([-np.sin(t), np.cos(t)])
    k_max = int(np.ceil(_FR / d))
    for k in range(-k_max, k_max + 1):
        c = nv * k * d
        p0, p1 = c - u * _FR, c + u * _FR
        (major if every and k % every == 0 else minor).append((p0[0], p0[1], p1[0], p1[1]))


def _bg_pattern(kind, s, color, opacity, w):
    minor, major, rings, dots = [], [], [], []
    lattice = [(i * s, j * s) for i in range(-int(np.ceil(_FW / 2 / s)), int(np.ceil(_FW / 2 / s)) + 1)
               for j in range(-int(np.ceil(_FH / 2 / s)), int(np.ceil(_FH / 2 / s)) + 1)]
    if kind in ("grid", "graph"):
        _bg_family(0, s, 5 if kind == "graph" else 0, minor, major)
        _bg_family(90, s, 5 if kind == "graph" else 0, minor, major)
    elif kind == "ruled":
        _bg_family(0, s, 0, minor, major)
    elif kind == "diagonal":
        _bg_family(45, s, 0, minor, major)
    elif kind == "cross":
        _bg_family(45, s, 0, minor, major)
        _bg_family(135, s, 0, minor, major)
    elif kind == "isometric":
        for a in (90, 30, 150):
            _bg_family(a, s * np.sqrt(3) / 2, 0, minor, major)
    elif kind == "polar":
        k = 1
        while k * s <= _FR:
            rings.append((0, 0, k * s))
            k += 1
        for a in range(0, 360, 15):
            t = a * DEGREES
            (major if a % 90 == 0 else minor).append((0, 0, np.cos(t) * _FR, np.sin(t) * _FR))
    elif kind == "dots":
        dots = [(x, y, 0.012 + 0.018 * w) for x, y in lattice]
    elif kind == "perfboard":
        rings = [(x, y, s * 0.24) for x, y in lattice]
    g = VGroup()
    if minor:
        g.add(_bg_lines(minor, color, w, opacity))
    if major:
        g.add(_bg_lines(major, color, 2 * w, min(1.0, opacity * 1.8)))
    if rings:
        g.add(_bg_circles(rings, color, w * (2 if kind == "perfboard" else 1), opacity))
    if dots:
        g.add(_bg_circles(dots, color, 0, opacity, fill=True))
    return g


def _bg_image(name, places, opacity):
    first = ImageMobject(str(_HERE / name))
    first._mv_src = name
    out = []
    for x, y, w, h in places:
        m = first.copy() if out else first
        m._mv_src = name
        m.stretch_to_fit_width(w).stretch_to_fit_height(h).move_to([x, y, 0])
        if opacity < 1:
            m.set_opacity(opacity)
        out.append(m)
    return out


def _bg_tiles(tw, th):
    nx, ny = int(np.ceil(_FW / 2 / tw)), int(np.ceil(_FH / 2 / th))
    return [((i + 0.5) * tw, (j + 0.5) * th, tw, th) for i in range(-nx, nx) for j in range(-ny, ny)]


def _bg_dim(color, opacity):
    return Rectangle(width=_FW + 0.02, height=_FH + 0.02).set_stroke(width=0).set_fill(color, opacity)


def _bg_vignette(strength, n=24):
    g, r0 = VGroup(), _FR * 0.35
    for i in range(n):
        a, b = r0 + (_FR - r0) * i / n, r0 + (_FR - r0) * (i + 1) / n
        t = (i + 0.5) / n
        g.add(Annulus(inner_radius=a, outer_radius=b + 0.003, stroke_width=0, fill_color=BLACK, fill_opacity=strength * t * t))
    return g
`;

const pn = (v) => { const r = Math.round(v * 10000) / 10000; return Number.isInteger(r) ? r.toFixed(1) : String(r); };
const ps = (s) => JSON.stringify(String(s));

// Python expression for a whole-frame background Group, drawn behind everything.
export function bgPy(b, project) {
  const parts = [`_bg_fill(${ps(b.fill)}, ${ps(b.color)}, ${ps(b.color2)}, ${pn(+b.angle || 0)})`];
  const asset = b.image && project.assets?.[b.image];
  if (asset) {
    const L = imageLayout(b, asset);
    const places = b.fit === 'tile' ? `_bg_tiles(${pn(L[0].w)}, ${pn(L[0].h)})` : `[${L.map((q) => `(${pn(q.x)}, ${pn(q.y)}, ${pn(q.w)}, ${pn(q.h)})`).join(', ')}]`;
    parts.push(`*_bg_image(${ps(assetFile(b.image, asset))}, ${places}, ${pn(+b.iopacity)})`);
    if (b.dim > 0) parts.push(`_bg_dim(${ps(b.color)}, ${pn(+b.dim)})`);
  }
  if (b.pattern !== 'none') parts.push(`_bg_pattern(${ps(b.pattern)}, ${pn(+b.pspacing)}, ${ps(patternColor(b))}, ${pn(+b.popacity)}, ${pn(+b.pweight || 1)})`);
  if (b.vignette > 0) parts.push(`_bg_vignette(${pn(+b.vignette)})`);
  return `Group(${parts.join(', ')}).set_z_index(-100)`;
}
