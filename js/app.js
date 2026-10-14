import { REG, CATEGORIES, ENTER_ANIMS, EMPH_ANIMS, makeObject, uid, checkExpr } from './components.js';
import { worldPrims, primsSVG, objectSVG, bbox, timeline, emphList, fonts, DEFAULT_FONT, FRAME_W, FRAME_H } from './render.js';
import { Player, applyBeat, stateSVG } from './player.js';
import { exportPython } from './export.js';
import { demoProject } from './demo.js';
import { renderCode, warmUp, onEngine } from './manim/engine.js';
import { icon, installIcons } from './icons.js';
import { pop, flash, appear, flip, shake } from './motion.js';
import { bgOf, bgSVG, bgKey, isLight, BG_DEFAULT, FILLS, PATTERNS, FITS, PRESETS, importImage, usedAssets, assetFile, assetBytes, mediaFile } from './backgrounds.js';
import { saveAssets, loadAssets, pruneAssets } from './store.js';
import { startRecording, releaseMic, playClip, stopClip, decode, toWav, fmtDur } from './voice.js';
import { THEMES, STYLES, loadLook, saveLook, applyLook, themeSwatch, TEXT_ROLES, applySlideTheme, applyRole, slideSwatch, slidePalette } from './themes.js';

installIcons();
let look = loadLook();
applyLook(look);

const $ = (s) => document.querySelector(s);
const STORE = 'manimvis.project.v1';

// Bundled fonts (fonts/fonts.json). @font-face rules let the browser fetch a
// family only when something on screen uses it. The "MV " prefix keeps them
// from replacing fonts the page UI asks for by name (e.g. Roboto).
let FONTS = [];
try { FONTS = await (await fetch('fonts/fonts.json')).json(); } catch { FONTS = [{ family: DEFAULT_FONT, group: 'Sans', file: 'DejaVuSans', bold: true }]; }
{
  const css = FONTS.map((f) => `@font-face{font-family:'MV ${f.family}';src:url(fonts/files/${f.file}-Regular.ttf) format('truetype');font-weight:400;font-display:swap}` +
    (f.bold ? `@font-face{font-family:'MV ${f.family}';src:url(fonts/files/${f.file}-Bold.ttf) format('truetype');font-weight:700;font-display:swap}` : '')).join('\n');
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
}
function fontOptions(value, inheritLabel) {
  let h = inheritLabel ? `<option value=""${!value ? ' selected' : ''}>${inheritLabel}</option>` : '';
  for (const g of [...new Set(FONTS.map((f) => f.group))]) {
    h += `<optgroup label="${g}">` + FONTS.filter((f) => f.group === g).map((f) => `<option value="${f.family}"${f.family === value ? ' selected' : ''} style="font-family:'MV ${f.family}'">${f.family}</option>`).join('') + '</optgroup>';
  }
  return h;
}
// Redraw once fonts arrive so previews and hit boxes use the real glyphs.
document.fonts?.addEventListener?.('loadingdone', () => { renderStage(); renderSlides(); });
const clone = (x) => JSON.parse(JSON.stringify(x));
const round = (v, s) => Math.round(v / s) * s;
const fx = (v) => Math.round(v * 1000) / 1000;

// ---- state -------------------------------------------------------------------
let project = load() || demoProject();
// Images and narration are kept in IndexedDB (see store.js); older lessons carried them inline.
project.assets = { ...(await loadAssets()), ...(project.assets || {}) };
let cur = 0;          // slide index
let sel = null;       // primary selected object id
let extra = new Set(); // further selected ids (multi-select)
let tool = 'select';
const undoStack = [], redoStack = [];
let lastCoalesce = null;

const slide = () => project.slides[cur];
const selected = () => slide().objects.find((o) => o.id === sel) || null;
const selectionIds = () => (sel ? [sel, ...extra] : []);
const isSel = (id) => id === sel || extra.has(id);
const selectedAll = () => slide().objects.filter((o) => isSel(o.id));
function setSelection(ids) { sel = ids[0] ?? null; extra = new Set(ids.slice(1)); }
const prevSlide = () => (cur > 0 ? project.slides[cur - 1] : null);
const carried = (o) => !!prevSlide()?.objects.some((p) => p.id === o.id);

function load() { try { const p = JSON.parse(localStorage.getItem(STORE)); return p?.slides?.length ? p : null; } catch { return null; } }
let saveTimer = 0;
let warnedFull = false;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const full = () => { if (!warnedFull) { warnedFull = true; toast('The browser is out of room for this lesson. Use Save to keep a copy.'); } };
    try { localStorage.setItem(STORE, JSON.stringify({ ...project, assets: undefined })); warnedFull = false; } catch { full(); }
    saveAssets(project.assets).then((ok) => ok || full());
  }, 250);
}
// Background images live in project.assets. Undo snapshots leave them out (they can be
// large); every image seen this session stays in the pool so undo can bring it back.
const assetPool = {};
function attachAssets() {
  Object.assign(assetPool, project.assets || {});
  const a = {};
  for (const id of usedAssets({ ...project, assets: assetPool })) a[id] = assetPool[id];
  project.assets = a;
}

// Record an undo point, then apply fn. Edits with the same `coalesce` key
// within 1.2s share one undo step (typing in a field, dragging a slider).
function edit(fn, coalesce = null) {
  const now = Date.now();
  if (!(coalesce && lastCoalesce && lastCoalesce.key === coalesce && now - lastCoalesce.t < 1200)) {
    undoStack.push(snapshot());
    if (undoStack.length > 200) undoStack.shift();
    redoStack.length = 0;
  }
  lastCoalesce = coalesce ? { key: coalesce, t: now } : null;
  fn();
  persist();
}
function restore(snap) { const s = JSON.parse(snap); project = s.project; attachAssets(); cur = Math.min(s.cur, project.slides.length - 1); sel = s.sel; extra = new Set(s.extra || []); renderAll(); persist(); }
function undo() { if (!undoStack.length) return; redoStack.push(snapshot()); restore(undoStack.pop()); lastCoalesce = null; }
function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); restore(redoStack.pop()); lastCoalesce = null; }

function toast(msg) { const t = $('#toast'); t.textContent = msg; if (t.hidden) pop(t, 'bottom'); t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2200); }

// ---- stage -------------------------------------------------------------------
const stage = $('#stage');
const player = new Player($('#playLayer'));

// Editor grid: a guide that is never part of the slides. Lines contrast with the slide.
const GRID_KEY = 'manimvis.grid.v1';
let grid = { show: true, spacing: 0.5 };
try { Object.assign(grid, JSON.parse(localStorage.getItem(GRID_KEY)) || {}); } catch {}
function drawGrid() {
  const g = $('#grid');
  g.style.display = grid.show ? '' : 'none';
  g.style.color = isLight(bgOf(project, slide())) ? '#000' : '#fff';
  let s = '';
  const d = grid.spacing, n = (v) => Math.round(v * 1000) / 1000;
  for (let k = -Math.floor(7.12 / d); k * d <= 7.12; k++) s += `<line x1="${n(k * d)}" y1="-4" x2="${n(k * d)}" y2="4"${k === 0 ? ' class="axis"' : ''}/>`;
  for (let k = -Math.floor(4 / d); k * d <= 4; k++) s += `<line x1="-7.12" y1="${n(k * d)}" x2="7.12" y2="${n(k * d)}"${k === 0 ? ' class="axis"' : ''}/>`;
  g.innerHTML = s;
}
function setGrid(patch) {
  Object.assign(grid, patch);
  try { localStorage.setItem(GRID_KEY, JSON.stringify(grid)); } catch {}
  drawGrid();
  $('#gridBtn').classList.toggle('on', grid.show);
}
let stageBg = '';
function drawStageBg() {
  const b = bgOf(project, slide()), k = bgKey(b);
  if (k === stageBg) return;
  stageBg = k;
  $('#bg').innerHTML = bgSVG(b, project);
  drawGrid();
}

function renderStage() {
  player.stop();
  $('#playLayer').innerHTML = '';
  drawStageBg();
  const ghost = $('#ghost').checked && prevSlide();
  $('#ghostLayer').innerHTML = ghost ? prevSlide().objects.filter((p) => !slide().objects.some((o) => o.id === p.id)).map((o) => objectSVG(o)).join('') : '';
  $('#objLayer').innerHTML = slide().objects.map((o) => `<g data-id="${o.id}"${isSel(o.id) ? ' class="sel"' : ''}>${objectSVG(o, { hit: true })}</g>`).join('');
  renderOverlay();
}

const boxRect = (b, p, cls) => `<rect class="${cls}" x="${fx(b.x0 - p)}" y="${fx(-b.y1 - p)}" width="${fx(b.x1 - b.x0 + 2 * p)}" height="${fx(b.y1 - b.y0 + 2 * p)}"/>`;
function renderOverlay() {
  let s = '';
  const objs = selectedAll();
  for (const o of objs) {
    const b = bbox(worldPrims(o));
    s += boxRect(b, 0.12, carried(o) ? 'carried' : 'selbox');
    if (carried(o)) s += boxRect(b, 0.17, 'selbox');
  }
  const o = selected();
  if (o && objs.length === 1 && REG[o.type].ends) {
    s += `<circle class="handle" data-handle="a" cx="${fx(o.x)}" cy="${fx(-o.y)}" r="0.11"/>`;
    s += `<circle class="handle" data-handle="b" cx="${fx(o.x + o.dx)}" cy="${fx(-(o.y + o.dy))}" r="0.11"/>`;
  }
  if (o && objs.length === 1 && o.type === 'poly') {
    o.pts.forEach(([px, py], i) => (s += `<circle class="handle" data-vertex="${i}" cx="${fx(o.x + px)}" cy="${fx(-(o.y + py))}" r="0.09"/>`));
  }
  if (drag?.kind === 'marquee') {
    const { x0, y0, x1, y1 } = drag;
    s += boxRect({ x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) }, 0, 'marquee');
  }
  if (drawing) {
    const pts = drawing.pts.concat(drawing.hover ? [drawing.hover] : []);
    s += `<polyline class="drawline" points="${pts.map(([x, y]) => `${fx(x)},${fx(-y)}`).join(' ')}"/>`;
    drawing.pts.forEach(([x, y], i) => (s += `<circle class="handle${i === 0 ? ' first' : ''}" cx="${fx(x)}" cy="${fx(-y)}" r="${i === 0 ? 0.12 : 0.07}"/>`));
  }
  $('#overlay').innerHTML = s;
}

function svgPoint(evt) {
  const pt = stage.createSVGPoint();
  pt.x = evt.clientX; pt.y = evt.clientY;
  const p = pt.matrixTransform(stage.getScreenCTM().inverse());
  return [p.x, -p.y];
}
const snapOn = () => $('#snap').checked;
const snap = (v) => (snapOn() ? round(v, grid.spacing / 2) : fx(v));
const snapshot = () => JSON.stringify({ project: { ...project, assets: undefined }, cur, sel, extra: [...extra] });

// Freeform drawing: click to add points, click the first point (or press
// Enter / double-click) to finish, Esc to cancel.
let drawing = null;
function finishDrawing(closed) {
  const d = drawing; drawing = null;
  if (!d || d.pts.length < 2) { renderOverlay(); return; }
  const [ox, oy] = d.pts[0];
  edit(() => {
    const o = makeObject('poly', { x: ox, y: oy, pts: d.pts.map(([x, y]) => [fx(x - ox), fx(y - oy)]), closed: closed && d.pts.length > 2 });
    slide().objects.push(o);
    setSelection([o.id]);
  });
  setTool('select');
  renderAll();
}

let drag = null;
stage.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const [x, y] = svgPoint(e);
  const handle = e.target.closest('[data-handle]');
  const vertex = e.target.closest('[data-vertex]');
  const g = e.target.closest('#objLayer > g');
  stage.setPointerCapture(e.pointerId);
  if (tool === 'draw') {
    const p = [snap(x), snap(y)];
    if (!drawing) drawing = { pts: [p] };
    else if (drawing.pts.length > 2 && Math.hypot(p[0] - drawing.pts[0][0], p[1] - drawing.pts[0][1]) < 0.2) return finishDrawing(true);
    else drawing.pts.push(p);
    renderOverlay();
    return;
  }
  if (handle && selected()) {
    const o = selected();
    drag = { kind: 'handle', which: handle.dataset.handle, id: o.id, start: snapshot(), moved: false, ex: o.x + o.dx, ey: o.y + o.dy };
    return;
  }
  if (vertex && selected()) {
    drag = { kind: 'vertex', i: +vertex.dataset.vertex, id: selected().id, start: snapshot(), moved: false };
    return;
  }
  if (tool === 'wire') {
    const start = snapshot();
    const o = makeObject('wire', { x: snap(x), y: snap(y), dx: 0, dy: 0, color: lastWireColor() });
    drag = { kind: 'newwire', id: o.id, start };
    slide().objects.push(o); setSelection([o.id]);
    renderStage();
    return;
  }
  if (g) {
    const id = g.dataset.id;
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      // toggle in a multi-selection
      const ids = selectionIds();
      setSelection(ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id]);
      renderStage(); renderInspector();
      return;
    }
    if (!isSel(id)) setSelection([id]);
    const start = snapshot();
    drag = { kind: 'move', px: x, py: y, start, moved: false, orig: selectedAll().map((o) => ({ o, x: o.x, y: o.y })) };
    renderStage(); renderInspector();
  } else {
    if (!e.shiftKey) setSelection([]);
    drag = { kind: 'marquee', x0: x, y0: y, x1: x, y1: y, add: e.shiftKey ? selectionIds() : [] };
    renderStage(); renderInspector();
  }
});
stage.addEventListener('pointermove', (e) => {
  const [x, y] = svgPoint(e);
  if (drawing) { drawing.hover = [snap(x), snap(y)]; renderOverlay(); return; }
  if (!drag) return;
  if (drag.kind === 'marquee') {
    drag.x1 = x; drag.y1 = y;
    const r = { x0: Math.min(drag.x0, x), y0: Math.min(drag.y0, y), x1: Math.max(drag.x0, x), y1: Math.max(drag.y0, y) };
    const hit = slide().objects.filter((o) => { const b = bbox(worldPrims(o)); return b.x0 < r.x1 && b.x1 > r.x0 && b.y0 < r.y1 && b.y1 > r.y0; }).map((o) => o.id);
    setSelection([...new Set([...drag.add, ...hit])]);
    document.querySelectorAll('#objLayer > g').forEach((gg) => gg.classList.toggle('sel', isSel(gg.dataset.id)));
    renderOverlay();
    return;
  }
  if (drag.kind === 'move') {
    const dx = x - drag.px, dy = y - drag.py;
    for (const m of drag.orig) {
      const nx = snap(m.x + dx), ny = snap(m.y + dy);
      if (nx !== m.o.x || ny !== m.o.y) { m.o.x = nx; m.o.y = ny; drag.moved = true; }
      const gg = $(`#objLayer > g[data-id="${m.o.id}"]`);
      if (gg) gg.innerHTML = objectSVG(m.o, { hit: true });
    }
    renderOverlay();
    return;
  }
  const o = slide().objects.find((q) => q.id === drag.id);
  if (!o) return;
  if (drag.kind === 'newwire') {
    o.dx = snap(x) - o.x; o.dy = snap(y) - o.y;
    o.route = Math.abs(o.dx) >= Math.abs(o.dy) ? 'hv' : 'vh';
  } else if (drag.kind === 'handle') {
    drag.moved = true;
    if (drag.which === 'b') { o.dx = snap(x) - o.x; o.dy = snap(y) - o.y; }
    else { o.x = snap(x); o.y = snap(y); o.dx = drag.ex - o.x; o.dy = drag.ey - o.y; }
  } else if (drag.kind === 'vertex') {
    drag.moved = true;
    o.pts[drag.i] = [fx(snap(x) - o.x), fx(snap(y) - o.y)];
  }
  const gg = $(`#objLayer > g[data-id="${o.id}"]`);
  if (gg) gg.innerHTML = objectSVG(o, { hit: true });
  renderOverlay();
});
stage.addEventListener('pointerup', () => {
  if (!drag) return;
  const d = drag; drag = null;
  if (d.kind === 'marquee') { renderAll(); return; }
  if (d.kind === 'newwire') {
    const o = slide().objects.find((q) => q.id === d.id);
    if (o && o.dx === 0 && o.dy === 0) { slide().objects = slide().objects.filter((q) => q !== o); setSelection([]); }
    else pushUndo(d.start);
  } else if (d.moved) pushUndo(d.start);
  persist();
  renderAll();
});
stage.addEventListener('dblclick', () => { if (drawing) finishDrawing(false); });
function pushUndo(snap) { undoStack.push(snap); redoStack.length = 0; lastCoalesce = null; }
function lastWireColor() { const w = [...slide().objects].reverse().find((o) => o.type === 'wire'); return w ? w.color : '#ffffff'; }

// drag from palette
stage.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/x-manimvis')) e.preventDefault(); });
stage.addEventListener('drop', (e) => {
  const key = e.dataTransfer.getData('text/x-manimvis');
  e.preventDefault();
  const [x, y] = svgPoint(e);
  if (key.startsWith('lib:')) addLibraryShape(key.slice(4), snap(x), snap(y));
  else if (REG[key]) addObject(key, snap(x), snap(y));
});

function staggered() {
  // stagger new objects so repeated clicks don't stack exactly
  const n = slide().objects.length % 6;
  return [(n - 2.5) * 0.5, -n * 0.25];
}
function appearObj(id) { const g = $(`#objLayer > g[data-id="${CSS.escape(id)}"]`); appear(g); flash($(`#timeline .tl-name[data-row="${CSS.escape(id)}"]`)); }
function addObject(type, x, y) {
  edit(() => {
    if (x == null) [x, y] = staggered();
    const o = makeObject(type, { x, y });
    if (project.ink && (o.color || '').toLowerCase() === '#ffffff') { o.color = project.ink; if ((o.fill || '').toLowerCase() === '#ffffff') o.fill = project.ink; }
    if (REG[type].ends) { o.x -= o.dx / 2; o.y -= o.dy / 2; o.x = snap(o.x); o.y = snap(o.y); }
    if (!REG[type].noLabel && o.label) o.label = nextLabel(o.label);
    slide().objects.push(o);
    setSelection([o.id]);
  });
  renderAll();
  appearObj(sel);
}
function nextLabel(prefix) {
  const used = new Set(project.slides.flatMap((s) => s.objects.map((o) => o.label)));
  for (let i = 1; ; i++) if (!used.has(prefix + i)) return prefix + i;
}

// ---- groups -------------------------------------------------------------------
// Children of a group are stored relative to the group's origin.
function makeGroup(objs, name = '') {
  const b = bbox(objs.flatMap(worldPrims));
  const cx = snap(b.cx), cy = snap(b.cy);
  const children = objs.map((o) => ({ ...clone(o), x: fx(o.x - cx), y: fx(o.y - cy) }));
  return { ...makeObject('group'), x: cx, y: cy, name, children, color: objs[0]?.color || '#ffffff' };
}
function ungroup(g) {
  const s = g.scale ?? 1, r = ((g.rot || 0) * Math.PI) / 180, c = Math.cos(r), sn = Math.sin(r);
  return g.children.map((ch) => {
    const o = { ...clone(ch), id: uid() };
    o.x = fx(g.x + s * (ch.x * c - ch.y * sn)); o.y = fx(g.y + s * (ch.x * sn + ch.y * c));
    if (REG[o.type].ends) { o.dx = fx(s * (ch.dx * c - ch.dy * sn)); o.dy = fx(s * (ch.dx * sn + ch.dy * c)); }
    else { o.rot = ((ch.rot || 0) + (g.rot || 0)) % 360; o.scale = fx((ch.scale ?? 1) * s); }
    if (o.type === 'poly') o.pts = o.pts.map(([x, y]) => [fx(s * (x * c - y * sn)), fx(s * (x * sn + y * c))]), (o.rot = 0), (o.scale = 1);
    return o;
  });
}
function recolor(o, color) {
  o.color = color;
  if (REG[o.type]?.fillable) o.fill = color;
  if (o.type === 'axes') o.gcolor = color;
  (o.children || []).forEach((c) => recolor(c, color));
}
// Fresh ids all the way down, so every placed copy is its own object.
function reId(o) { o.id = uid(); (o.children || []).forEach(reId); return o; }

// ---- shape library (your saved shapes) -------------------------------------------
const LIBRARY = 'manimvis.library.v1';
let library = (() => { try { return JSON.parse(localStorage.getItem(LIBRARY)) || null; } catch { return null; } })() || { categories: [], shapes: [] };
function saveLibrary() { try { localStorage.setItem(LIBRARY, JSON.stringify(library)); } catch { toast('Could not save the shape library in this browser'); } }
const allCategories = () => [...CATEGORIES.map((c) => c.name), ...library.categories.filter((c) => !CATEGORIES.some((b) => b.name === c))];

function addLibraryShape(id, x, y) {
  const shape = library.shapes.find((s) => s.id === id);
  if (!shape) return;
  edit(() => {
    if (x == null) [x, y] = staggered();
    const o = reId(clone(shape.obj));
    o.x = x; o.y = y; o.name = shape.name;
    slide().objects.push(o);
    setSelection([o.id]);
  });
  renderAll();
  appearObj(sel);
}

function openSaveShape() {
  const objs = selectedAll();
  if (!objs.length) return toast('Select one or more objects first');
  const cats = allCategories();
  $('#shapeName').value = objs.length === 1 && objs[0].type === 'group' && objs[0].name ? objs[0].name : '';
  $('#shapeCat').innerHTML = cats.map((c) => `<option>${escapeHTML(c)}</option>`).join('') + '<option value="__new">New category…</option>';
  $('#shapeCat').value = lastShapeCat && cats.includes(lastShapeCat) ? lastShapeCat : (objs.some((o) => REG[o.type].cat === 'Electronics') ? 'Electronics' : 'Shapes');
  $('#newCatRow').hidden = true;
  $('#shapePreview').innerHTML = shapeIcon(objs.length === 1 && objs[0].type === 'group' ? objs[0] : makeGroup(objs));
  $('#shapeDlg').showModal();
  $('#shapeName').focus();
}
let lastShapeCat = '';
$('#shapeCat').addEventListener('change', () => { $('#newCatRow').hidden = $('#shapeCat').value !== '__new'; if (!$('#newCatRow').hidden) $('#newCat').focus(); });
$('#shapeForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const objs = selectedAll();
  const name = $('#shapeName').value.trim() || 'My shape';
  let cat = $('#shapeCat').value;
  if (cat === '__new') {
    cat = $('#newCat').value.trim();
    if (!cat) { $('#newCat').focus(); return; }
    if (!allCategories().includes(cat)) library.categories.push(cat);
  }
  lastShapeCat = cat;
  const g = objs.length === 1 && objs[0].type === 'group' ? clone(objs[0]) : makeGroup(objs);
  Object.assign(g, { x: 0, y: 0, name, enter: 'Create', step: 1, emphs: [] }); delete g.emph; delete g.mstep;
  library.shapes.push({ id: uid(), name, category: cat, obj: g });
  saveLibrary();
  $('#shapeDlg').close();
  renderPalette();
  flash($(`#catBar [data-cat="${CSS.escape(cat)}"]`));
  toast(`Saved "${name}" to ${cat}`);
});

// ---- shape menus (dock under the canvas) ----------------------------------------------
// Each category is a button in the dock that opens its shapes in a menu above it.
const CAT_ICONS = { Electronics: 'zap', Shapes: 'shapes', Text: 'type', Graphs: 'chart-spline' };
let openCat = null;

function iconFor(o) {
  const prims = worldPrims(o);
  const b = bbox(prims), pad = 0.25;
  const w = Math.max(b.x1 - b.x0, 0.6) + 2 * pad, h = Math.max(b.y1 - b.y0, 0.6) + 2 * pad;
  return `<svg viewBox="${fx(b.cx - w / 2)} ${fx(-b.cy - h / 2)} ${fx(w)} ${fx(h)}">${primsSVG(prims)}</svg>`;
}
function iconSVG(type) {
  const o = makeObject(type, { label: '', color: 'currentColor', fill: 'currentColor', sw: 6 });
  if (type === 'text') o.text = 'Aa';
  if (type === 'math') o.text = 'x^2';
  return iconFor(o);
}
function shapeIcon(obj) { const o = clone(obj); o.x = 0; o.y = 0; return iconFor(o); }

function renderCatBar() {
  $('#catBar').innerHTML = allCategories().map((c) => `<button data-cat="${escapeHTML(c)}" class="${openCat === c ? 'open' : ''}" aria-expanded="${openCat === c}" aria-haspopup="true">` +
    `${icon(CAT_ICONS[c] || 'folder')}<span>${escapeHTML(c)}</span>${icon('chevron-up', 'chev')}</button>`).join('');
}

function renderPalette() {
  renderCatBar();
  if (!openCat) return;
  const q = ($('#paletteSearch').value || '').trim().toLowerCase();
  const match = (name) => !q || name.toLowerCase().includes(q);
  const item = (d) => d.type === 'wire'
    ? `<button class="tool" data-add="wire" title="Wire tool: drag between terminals to connect parts (W)">${icon('cable')}<span>Wire tool</span></button>`
    : `<button draggable="true" data-add="${d.type}" title="Add ${d.name} (or drag onto the slide)">${iconSVG(d.type)}<span>${d.name}</span></button>`;
  const libItem = (s) => `<span class="libitem"><button draggable="true" data-lib="${s.id}" title="Add ${escapeHTML(s.name)} (or drag onto the slide)">${shapeIcon(s.obj)}<span>${escapeHTML(s.name)}</span></button>` +
    `<button class="del" data-libdel="${s.id}" title="Remove from library" aria-label="Remove ${escapeHTML(s.name)}">${icon('trash-2')}</button></span>`;
  const section = (cat, withTitle) => {
    const def = CATEGORIES.find((c) => c.name === cat);
    let body = '';
    for (const sub of def?.subs || []) {
      const items = Object.values(REG).filter((d) => d.cat === cat && d.sub === sub && match(d.name));
      if (items.length) body += `<h4>${sub}</h4><div class="items">${items.map(item).join('')}</div>`;
    }
    if (cat === 'Text') {
      const roles = TEXT_ROLES.filter((r) => r.id && match(r.name));
      const pal = slidePalette(project.slideTheme);
      if (roles.length) body += `<h4>Styles</h4><div class="items">${roles.map((r) => `<button data-addrole="${r.id}" title="Add ${r.name} text"><svg viewBox="0 0 60 30"><text x="30" y="21" text-anchor="middle" font-size="${Math.round(r.size / 3.2)}" font-weight="${r.bold ? 700 : 400}" fill="${pal[r.id]}">Aa</text></svg><span>${r.name}</span></button>`).join('')}</div>`;
    }
    const mine = library.shapes.filter((s) => s.category === cat && match(s.name));
    if (mine.length) body += `<h4>${icon('bookmark-plus')}Saved</h4><div class="items">${mine.map(libItem).join('')}</div>`;
    if (!body) return q ? '' : `<p class="empty">Nothing here yet. Select objects on a slide and choose <b>Save as shape</b> to add them to ${escapeHTML(cat)}.</p>`;
    return (withTitle ? `<h5>${escapeHTML(cat)}</h5>` : '') + body;
  };
  const html = q ? allCategories().map((c) => section(c, true)).join('') : section(openCat, false);
  $('#palette').innerHTML = html || '<p class="empty">Nothing matches.</p>';
}

function placeShelf() {
  const btn = openCat && $(`#catBar [data-cat="${CSS.escape(openCat)}"]`);
  const shelf = $('#shelf');
  if (!btn) return;
  const r = btn.getBoundingClientRect(), dock = $('.dock').getBoundingClientRect();
  const w = shelf.offsetWidth;
  shelf.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
  // open upward when there is room above the dock, otherwise below it
  const above = dock.top - 14, below = window.innerHeight - dock.bottom - 14;
  if (above >= Math.min(320, below)) { shelf.style.bottom = (window.innerHeight - dock.top + 6) + 'px'; shelf.style.top = ''; shelf.style.maxHeight = Math.min(560, above) + 'px'; }
  else { shelf.style.top = (dock.bottom + 6) + 'px'; shelf.style.bottom = ''; shelf.style.maxHeight = Math.min(560, below) + 'px'; }
}
function openShelf(cat) {
  openCat = cat;
  $('#shelf').hidden = !cat;
  $('#shelf').classList.remove('dragging');
  renderPalette();
  if (cat) { placeShelf(); pop($('#shelf'), $('#shelf').style.bottom ? 'bottom' : 'top'); }
}
$('#catBar').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cat]');
  if (b) openShelf(openCat === b.dataset.cat ? null : b.dataset.cat);
});
$('#searchBtn').addEventListener('click', () => { openShelf(openCat || allCategories()[0]); $('#paletteSearch').focus(); });
$('#shelfClose').addEventListener('click', () => openShelf(null));
$('#paletteSearch').addEventListener('input', renderPalette);
window.addEventListener('resize', () => openCat && placeShelf());
window.addEventListener('scroll', () => openCat && placeShelf(), { passive: true });
document.addEventListener('pointerdown', (e) => {
  if (openCat && !e.target.closest('#shelf, #catBar, #searchBtn')) openShelf(null);
});
$('#palette').addEventListener('click', (e) => {
  const del = e.target.closest('[data-libdel]');
  if (del) {
    // two-step delete: first click arms, second click removes
    if (!del.classList.contains('armed')) { del.classList.add('armed'); del.innerHTML = icon('trash-2') + 'Delete?'; setTimeout(() => { del.classList.remove('armed'); del.innerHTML = icon('trash-2'); }, 2500); return; }
    library.shapes = library.shapes.filter((s) => s.id !== del.dataset.libdel);
    saveLibrary(); renderPalette();
    return;
  }
  const lib = e.target.closest('[data-lib]');
  if (lib) { openShelf(null); return addLibraryShape(lib.dataset.lib); }
  const role = e.target.closest('[data-addrole]');
  if (role) {
    openShelf(null);
    const r = TEXT_ROLES.find((x) => x.id === role.dataset.addrole);
    edit(() => {
      const [x, y] = staggered();
      const o = makeObject('text', { x, y, text: r.name === 'Body' || r.name === 'Caption' ? r.name + ' text' : r.name });
      applyRole(project, o, r.id);
      slide().objects.push(o); setSelection([o.id]);
    });
    renderAll();
    return;
  }
  const b = e.target.closest('[data-add]');
  if (!b) return;
  openShelf(null);
  if (b.dataset.add === 'wire') { setTool('wire'); return; }
  if (b.dataset.add === 'poly') { setTool('draw'); return; }
  addObject(b.dataset.add);
});
$('#palette').addEventListener('dragstart', (e) => {
  const lib = e.target.closest('[data-lib]');
  const b = e.target.closest('[data-add]');
  if (lib) e.dataTransfer.setData('text/x-manimvis', 'lib:' + lib.dataset.lib);
  else if (b) e.dataTransfer.setData('text/x-manimvis', b.dataset.add);
  else return;
  // get the menu out of the way of the drop without removing the drag source
  requestAnimationFrame(() => $('#shelf').classList.add('dragging'));
});
$('#palette').addEventListener('dragend', () => openShelf(null));
$('#libExport').addEventListener('click', () => {
  download(new Blob([JSON.stringify({ kind: 'manimvis-library', version: 1, ...library }, null, 1)], { type: 'application/json' }), 'manim-visual-shapes.json');
});
$('#libImport').addEventListener('click', () => $('#libFile').click());
$('#libFile').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (!Array.isArray(data.shapes)) throw new Error();
    let added = 0;
    for (const s of data.shapes) {
      if (!s?.obj || s.obj.type !== 'group' || library.shapes.some((x) => x.id === s.id)) continue;
      library.shapes.push({ id: s.id || uid(), name: String(s.name || 'Shape'), category: String(s.category || 'Shapes'), obj: s.obj });
      if (!allCategories().includes(s.category)) library.categories.push(String(s.category));
      added++;
    }
    saveLibrary(); renderPalette();
    toast(`Added ${added} shape${added === 1 ? '' : 's'} to your library`);
  } catch { toast('That file is not a Manim Visual shape library'); }
  e.target.value = '';
});

// ---- slides list ---------------------------------------------------------------
function thumbSVG(s) {
  return `<svg viewBox="-7.1111 -4 14.2222 8">${bgSVG(bgOf(project, s), project)}${s.objects.map((o) => objectSVG(o)).join('')}</svg>`;
}
function renderSlides() {
  $('#slideList').innerHTML = project.slides.map((s, i) => `<li data-i="${i}" data-key="${s.id || 'i' + i}"${i === cur ? ' class="on"' : ''}>
    <span class="thumb">${thumbSVG(s)}</span><div class="name">${escapeHTML(s.name || 'Untitled')}</div>
    <span class="ops"><button data-op="up" title="Move up" aria-label="Move up">${icon('arrow-up')}</button><button data-op="down" title="Move down" aria-label="Move down">${icon('arrow-down')}</button><button data-op="del" title="Delete slide" aria-label="Delete slide">${icon('trash-2')}</button></span></li>`).join('');
}
const escapeHTML = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
$('#slideList').addEventListener('click', (e) => {
  const li = e.target.closest('li');
  if (!li) return;
  const i = +li.dataset.i;
  const op = e.target.closest('[data-op]')?.dataset.op;
  if (op === 'del') {
    if (project.slides.length === 1) { shake(li); return toast('A lesson needs at least one slide'); }
    const go = () => { edit(() => { project.slides.splice(i, 1); cur = Math.min(cur, project.slides.length - 1); setSelection([]); }); flip($('#slideList'), renderAll); switchFx(); };
    const a = li.animate?.([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(-24px) scale(.9)' }], { duration: 160, easing: 'ease-in' });
    if (a && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) a.onfinish = go; else go();
    return;
  }
  if (op === 'up' && i > 0) edit(() => { const [s] = project.slides.splice(i, 1); project.slides.splice(i - 1, 0, s); cur = i - 1; });
  else if (op === 'down' && i < project.slides.length - 1) edit(() => { const [s] = project.slides.splice(i, 1); project.slides.splice(i + 1, 0, s); cur = i + 1; });
  else if (op) { shake(li); return; }
  else { if (cur === i) return; cur = i; setSelection([]); }
  flip($('#slideList'), renderAll);
  if (!op) switchFx();
});
// A quick cross-fade on the canvas when the slide changes.
function switchFx() {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  $('#stage').animate([{ opacity: 0.25, transform: 'scale(.985)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'ease-out' });
}
function addSlide(dup) {
  edit(() => {
    const s = dup ? { ...clone(slide()), id: uid(), name: (slide().name || 'Slide') + ' (next)', notes: '' }
      : { id: uid(), name: 'Slide ' + (project.slides.length + 1), notes: '', objects: [] };
    if (dup) { s.objects.forEach((o) => { delete o.emph; o.emphs = []; o.step = 1; delete o.mstep; }); delete s.outSteps; }
    project.slides.splice(cur + 1, 0, s);
    cur++; setSelection([]);
  });
  flip($('#slideList'), renderAll);
  switchFx();
  $('#slideList li.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  if (dup) toast('Duplicated: move or change things and they will animate from the previous slide');
}

// ---- inspector -----------------------------------------------------------------
function field(label, key, type, value, extra = {}) {
  const id = 'f_' + key;
  let input;
  if (type === 'font') input = `<select id="${id}" data-key="${key}">${fontOptions(value, 'inherit' in extra ? extra.inherit : `Lesson font (${fonts.lesson})`)}</select>`;
  else if (type === 'select') input = `<select id="${id}" data-key="${key}">${extra.options.map((o) => { const [v, t] = Array.isArray(o) ? o : [o, o]; return `<option value="${v}"${v === value ? ' selected' : ''}>${t}</option>`; }).join('')}</select>`;
  else if (type === 'bool') input = `<input type="checkbox" id="${id}" data-key="${key}"${value ? ' checked' : ''}>`;
  else if (type === 'textarea') input = `<textarea id="${id}" data-key="${key}" placeholder="${extra.placeholder || ''}">${escapeHTML(value ?? '')}</textarea>`;
  else input = `<input id="${id}" data-key="${key}" type="${type}" value="${escapeHTML(value ?? '')}"${extra.step ? ` step="${extra.step}"` : ''}${extra.min != null ? ` min="${extra.min}"` : ''}${extra.placeholder ? ` placeholder="${extra.placeholder}"` : ''}>`;
  return `<label class="${type === 'textarea' ? 'wide' : ''}"><span>${label}</span>${input}</label>`;
}

function renderInspector() {
  const o = selected();
  const box = $('#inspector');
  const many = selectedAll();
  if (many.length > 1) {
    $('#inspTitle').textContent = `${many.length} selected`;
    const same = many.every((q) => q.color === many[0].color);
    box.innerHTML = `<div class="sec" data-scope="multi">${field('Colour', 'color', 'color', same ? many[0].color : '#ffffff')}</div>
      <div class="btnrow"><button data-act="group" class="accent">${icon('group')}Group</button><button data-act="saveShape">${icon('bookmark-plus')}Save as shape</button><button data-act="tgroup" title="Group their tracks in the timeline; the objects stay separate">${icon('folder')}Group in timeline</button></div>
      <div class="btnrow"><button data-act="rotate">${icon('rotate-cw')}Rotate 90°</button><button data-act="dup">${icon('copy')}Duplicate</button><button data-act="del">${icon('trash-2')}Delete</button></div>
      <div class="help">Shift-click or drag a box to change the selection. <kbd>Ctrl G</kbd> groups.</div>`;
    return;
  }
  if (!o) {
    $('#inspTitle').textContent = `Slide ${cur + 1}`;
    const s = slide();
    box.innerHTML = `<div class="sec" data-scope="slide">
      ${field('Name', 'name', 'text', s.name)}
      ${field('Speaker notes', 'notes', 'textarea', s.notes, { placeholder: 'Shown in presenter mode and exported to manim-slides' })}
      </div>
      <button type="button" class="slidetheme" data-slideact="bg"><svg viewBox="-7.1111 -4 14.2222 8" aria-hidden="true">${bgSVG(bgOf(project, s), project)}</svg><span><b>Background</b><br>${s.background ? 'This slide has its own' : 'Lesson background'}</span></button>
      <h4>Lesson</h4><div class="sec" data-scope="project">${field('Font', 'font', 'font', project.font || DEFAULT_FONT, { inherit: null })}</div>
      <button type="button" class="slidetheme" data-slideact="theme">${slideSwatch(project.slideTheme)}<span><b>Slide theme</b><br>${escapeHTML(project.slideTheme ? THEMES.find((t) => t.id === project.slideTheme)?.name || 'Custom' : 'Your own colours')}</span></button>
      <div class="note">
        <b>How slides animate</b><br>
        The <i>timeline</i> under the canvas shows every animation on this slide: one track per object and one column per click. Drag a block to another click, click it to change the animation, or use <b>+</b> to add an emphasis.<br><br>
        <b>Duplicate slide</b> (${icon('copy')}) continues a scene: anything you move, recolour or change (like closing a switch) morphs smoothly into place, and anything you delete fades out.
      </div>
      <div class="help"><kbd>W</kbd> wire · <kbd>P</kbd> draw · <kbd>V</kbd> select · <kbd>R</kbd> rotate · <kbd>Del</kbd> delete · <kbd>Ctrl D</kbd> duplicate · <kbd>Ctrl G</kbd> group · <kbd>Ctrl A</kbd> select all · arrows nudge</div>`;
    return;
  }
  const d = REG[o.type];
  $('#inspTitle').textContent = d.name;
  const isCarried = carried(o);
  let h = '';
  if (isCarried) h += `<div class="note carry">Continues from the previous slide. Changes you make here animate as a smooth transform.</div>`;
  h += '<div class="sec" data-scope="obj">';
  if (o.type === 'text' || o.type === 'math') h += field('Style', 'role', 'select', o.role || '', { options: TEXT_ROLES.map((r) => [r.id, r.name]) });
  for (const p of d.props || []) h += field(p.label, p.key, p.type, o[p.key], p);
  if (!d.noLabel) h += field('Label', 'label', 'text', o.label);
  if (o.type !== 'group') h += `<div class="pair">${field('Colour', 'color', 'color', o.color)}${d.fillable ? field('Fill', 'fill', 'color', o.fill) : ''}</div>`;
  if (d.fillable) h += field('Fill opacity', 'fo', 'range', o.fo, { step: 0.05, min: 0 }).replace('type="range"', 'type="range" max="1"');
  if (o.type !== 'text' && o.type !== 'math' && o.type !== 'group') h += field('Line width', 'sw', 'number', o.sw, { step: 0.5, min: 0 });
  h += '<h4>Position</h4><div class="pair">' + field('x', 'x', 'number', o.x, { step: 0.25 }) + field('y', 'y', 'number', o.y, { step: 0.25 }) + '</div>';
  if (d.ends) h += '<div class="pair">' + field('Δx', 'dx', 'number', o.dx, { step: 0.25 }) + field('Δy', 'dy', 'number', o.dy, { step: 0.25 }) + '</div>';
  else h += '<div class="pair">' + field('Rotate°', 'rot', 'number', o.rot, { step: 15 }) + field('Scale', 'scale', 'number', o.scale, { step: 0.1, min: 0.1 }) + '</div>';
  h += '<h4>Animation</h4>';
  if (!isCarried) h += field('Enter', 'enter', 'select', o.enter, { options: ENTER_ANIMS });
  if (!isCarried) h += field('Enter on click', 'step', 'number', o.step, { step: 1, min: 1 });
  const em = emphList(o);
  h += field('Emphasis', 'emph', 'select', em[0]?.anim || 'None', { options: EMPH_ANIMS.map((a) => [a, emphName(a)]) });
  if (em.length) h += field('Emphasis on click', 'emphStep', 'number', em[0].step || 1, { step: 1, min: 1 });
  if (em.length > 1) h += `<div class="help">${em.length - 1} more emphasis animation${em.length > 2 ? 's' : ''} on this object. Edit them in the timeline.</div>`;
  h += `</div><div class="btnrow"><button data-act="rotate">${icon('rotate-cw')}Rotate 90°</button><button data-act="dup">${icon('copy')}Duplicate</button><button data-act="front">${icon('bring-to-front')}To front</button><button data-act="del">${icon('trash-2')}Delete</button></div>`;
  h += `<div class="btnrow"><button data-act="saveShape">${icon('bookmark-plus')}Save as shape</button>${o.type === 'group' ? `<button data-act="ungroup">${icon('ungroup')}Ungroup</button>` : ''}</div>`;
  if (o.type === 'group') h = h.replace('<div class="sec" data-scope="obj">', `<div class="sec" data-scope="obj">${field('Name', 'name', 'text', o.name || '')}${field('Recolour all', 'recolor', 'color', o.color)}`);
  if (o.type === 'axes' && !checkExpr(o.fx)) h += `<div class="note">The function uses something unsupported. Use x, numbers, + − * / ^, pi, e and sin cos tan exp log sqrt abs.</div>`;
  if (o.type === 'math') h += `<div class="help">Exported as MathTex, which needs LaTeX installed where you render.</div>`;
  box.innerHTML = h;
}

function readInput(el) {
  if (el.type === 'checkbox') return el.checked;
  if (el.type === 'number' || el.type === 'range') { const v = parseFloat(el.value); return Number.isFinite(v) ? v : null; }
  return el.value;
}
$('#inspector').addEventListener('input', (e) => {
  const el = e.target.closest('[data-key]');
  if (!el) return;
  const scope = el.closest('[data-scope]')?.dataset.scope;
  const key = el.dataset.key, v = readInput(el);
  if (v === null) return;
  if (scope === 'slide') { edit(() => (slide()[key] = v), 'slide' + key); renderSlides(); return; }
  if (scope === 'multi') { const objs = selectedAll(); edit(() => objs.forEach((q) => recolor(q, v)), 'multicolor'); renderStage(); renderSlides(); return; }
  if (scope === 'project') { edit(() => (project[key] = v), 'proj' + key); fonts.lesson = project.font || DEFAULT_FONT; renderStage(); renderSlides(); return; }
  const o = selected();
  if (!o) return;
  if (key === 'role') edit(() => applyRole(project, o, v));
  else if (key === 'recolor') edit(() => recolor(o, v), o.id + key);
  else if (key === 'emph' || key === 'emphStep') edit(() => {
    const em = emphList(o).map((e) => ({ ...e }));
    if (key === 'emph') { if (v === 'None') em.shift(); else if (em[0]) em[0].anim = v; else em.unshift({ anim: v, step: o.step || 1 }); }
    else if (em[0]) em[0].step = Math.max(1, Math.round(v));
    o.emphs = em; delete o.emph;
  }, o.id + key);
  else edit(() => { o[key] = key === 'step' ? Math.max(1, Math.round(v)) : v; if (key === 'color' && o.role) o.role = undefined; }, o.id + key);
  renderStage(); renderSlides();
  if (el.tagName === 'SELECT' || el.type === 'checkbox' || key === 'fx') renderInspector();
  renderTimeline();
});
$('#inspector').addEventListener('click', (e) => {
  if (e.target.closest('[data-slideact="theme"]')) { renderSlideThemes(); $('#slideThemeDlg').showModal(); return; }
  if (e.target.closest('[data-slideact="bg"]')) { openBg(); return; }
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act) objAction(act);
});
function objAction(act) {
  const objs = selectedAll();
  if (!objs.length) return;
  const o = objs[0];
  const rot = (q, back) => { if (REG[q.type].ends) { [q.dx, q.dy] = back ? [q.dy, -q.dx] : [-q.dy, q.dx]; } else q.rot = ((q.rot || 0) + (back ? 270 : 90)) % 360; };
  if (act === 'saveShape') return openSaveShape();
  if (act === 'tgroup') return groupTracks();
  if (act === 'del') edit(() => { slide().objects = slide().objects.filter((q) => !isSel(q.id)); setSelection([]); });
  if (act === 'rotate' || act === 'rotateBack') {
    const back = act === 'rotateBack';
    if (objs.length === 1) edit(() => rot(o, back));
    else edit(() => {
      // turn the whole selection about its centre
      const b = bbox(objs.flatMap(worldPrims)), cx = snap(b.cx), cy = snap(b.cy);
      for (const q of objs) { const dx = q.x - cx, dy = q.y - cy; [q.x, q.y] = back ? [fx(cx + dy), fx(cy - dx)] : [fx(cx - dy), fx(cy + dx)]; rot(q, back); }
    });
  }
  if (act === 'front') edit(() => { slide().objects = slide().objects.filter((q) => !isSel(q.id)).concat(objs); });
  if (act === 'dup') edit(() => {
    const copies = objs.map((q) => {
      const c = { ...reId(clone(q)), x: q.x + 0.5, y: q.y - 0.5 };
      if (c.label && !REG[c.type].noLabel) c.label = nextLabel(c.label.replace(/\d+$/, ''));
      return c;
    });
    slide().objects.push(...copies); setSelection(copies.map((c) => c.id));
  });
  if (act === 'group') {
    if (objs.length < 2) return toast('Select two or more objects to group');
    edit(() => {
      const at = slide().objects.findIndex((q) => isSel(q.id));
      const g = makeGroup(objs);
      Object.assign(g, { enter: o.enter, step: Math.min(...objs.map((q) => q.step || 1)) });
      slide().objects = slide().objects.filter((q) => !isSel(q.id));
      slide().objects.splice(at, 0, g);
      setSelection([g.id]);
    });
  }
  if (act === 'ungroup') {
    const groups = objs.filter((q) => q.type === 'group');
    if (!groups.length) return;
    edit(() => {
      const ids = [];
      for (const g of groups) {
        const kids = ungroup(g);
        const at = slide().objects.indexOf(g);
        slide().objects.splice(at, 1, ...kids);
        ids.push(...kids.map((k) => k.id));
      }
      setSelection(ids);
    });
  }
  renderAll();
}

// ---- commands ----------------------------------------------------------------
function setTool(t) {
  tool = t;
  document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t || (t === 'wire' && b.dataset.tool === 'select')));
  if (t === 'wire' && $('#wireChip').hidden) requestAnimationFrame(() => appear($('#wireChip')));
  $('#wireChip').hidden = t !== 'wire';
  stage.classList.toggle('wire', t === 'wire');
  stage.classList.toggle('draw', t === 'draw');
  if (t !== 'draw' && drawing) { drawing = null; renderOverlay(); }
  const hint = t === 'wire' ? 'Drag between terminals to draw a wire. Esc to stop.'
    : t === 'draw' ? 'Click to place points. Click the first point to close the shape, Enter or double-click to leave it open, Esc to cancel.' : '';
  $('#hint').textContent = hint; $('#hint').hidden = !hint;
}
document.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
$('#wireChip').addEventListener('click', () => setTool('select'));
for (const [btn, box, after] of [['#snapBtn', '#snap', () => {}], ['#ghostBtn', '#ghost', () => renderStage()]]) {
  $(btn).addEventListener('click', () => {
    const on = !$(box).checked;
    $(box).checked = on;
    $(btn).classList.toggle('on', on); $(btn).setAttribute('aria-pressed', on);
    after();
  });
}

const commands = {
  new() { edit(() => { project = { title: 'Untitled lesson', bg: '#0e1116', version: 1, slides: [{ id: uid(), name: 'Slide 1', notes: '', objects: [] }] }; cur = 0; setSelection([]); }); renderAll(); toast('Started a new lesson. Undo (Ctrl+Z) brings the old one back.'); },
  demo() { edit(() => { project = demoProject(); cur = 0; setSelection([]); }); renderAll(); },
  open() { $('#fileInput').click(); },
  save() {
    const blob = new Blob([JSON.stringify(project, null, 1)], { type: 'application/json' });
    download(blob, slug(project.title) + '.manimvis.json');
  },
  undo, redo,
  addSlide() { addSlide(false); },
  dupSlide() { addSlide(true); },
  async play() {
    const beats = timeline(project).filter((b) => b.slide === cur);
    let state = stateBefore(beats[0]);
    $('#objLayer').style.opacity = 0; $('#ghostLayer').style.opacity = 0; $('#overlay').style.display = 'none';
    for (const b of beats) {
      const v = playClip(project.assets?.[b.voice]);
      state = await player.play(state, b);
      if (!state) { stopClip(); break; }
      await v; await sleep(350);
    }
    $('#objLayer').style.opacity = ''; $('#ghostLayer').style.opacity = ''; $('#overlay').style.display = '';
    renderStage();
  },
  present() { presenter.open(cur); },
  code() { openCode(); },
  render() { openRender(); },
  appearance() { renderLook(); $('#lookDlg').showModal(); },
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
document.querySelectorAll('[data-cmd]').forEach((b) => b.addEventListener('click', () => commands[b.dataset.cmd]()));
$('#fileInput').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const p = JSON.parse(await f.text());
    if (!Array.isArray(p.slides)) throw new Error('not a lesson');
    for (const s of p.slides) s.objects = (s.objects || []).filter((o) => REG[o.type]);
    edit(() => { project = p; cur = 0; setSelection([]); });
    renderAll();
    toast('Opened ' + f.name);
  } catch { toast('That file is not a Manim Visual lesson'); }
  e.target.value = '';
});
$('#title').addEventListener('input', (e) => edit(() => (project.title = e.target.value), 'title'));

function slug(s) { return String(s || 'lesson').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'lesson'; }
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---- code dialog -----------------------------------------------------------------
let exportMode = 'slides';
const generatedCode = (mode = 'slides') => exportPython(project, { mode });
// What gets rendered: hand-edited code if there is any, otherwise generated from the slides.
const currentCode = () => project.customCode || generatedCode('slides');

// Background image files the code loads: [{name, type, bytes}].
function renderAssets() { return usedAssets(project, 'image').map((id) => { const a = project.assets[id]; return { name: assetFile(id, a), type: a.type, bytes: assetBytes(a).buffer }; }); }
// Narration as PCM for the in-browser renderer, keyed by the file name the code uses.
async function narrationPCM() {
  const out = {};
  for (const id of usedAssets(project, 'audio')) { try { out[mediaFile(id, project.assets[id])] = await decode(project.assets[id]); } catch {} }
  return out;
}
$('#dlAssets').addEventListener('click', async () => {
  let i = 0;
  for (const id of usedAssets(project)) {
    const a = project.assets[id];
    const blob = a.kind === 'audio' ? await toWav(a) : new Blob([assetBytes(a)], { type: a.type });
    setTimeout(() => download(blob, mediaFile(id, a)), i++ * 300);
  }
});
function openCode() {
  const n = usedAssets(project).length;
  $('#dlAssets').hidden = !n;
  $('#dlAssets').querySelector('span').textContent = n > 1 ? `Download ${n} media files` : 'Download media file';
  $('#code').value = project.customCode || generatedCode(exportMode);
  refreshCodeHelp();
  $('#exportDlg').showModal();
}
function refreshCodeHelp() {
  const code = $('#code').value;
  const cls = /class (\w+)\(/.exec(code)?.[1] || 'Lesson';
  const edited = project.customCode ? '<b>You have edited this code.</b> Rendering uses your version until you regenerate it from the slides.\n' : '';
  $('#exportHelp').innerHTML = edited + (exportMode === 'slides'
    ? `"Render this code" runs it right here. To render on a computer instead: <code>pip install "manim&lt;0.22" manim-slides</code>, then <code>manim-slides render lesson.py ${cls}</code>.`
    : `"Render this code" runs it right here. To render on a computer instead: <code>pip install manim</code>, then <code>manim -qh lesson.py ${cls}</code>.`);
  document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === exportMode));
}
document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
  exportMode = b.dataset.mode;
  if (project.customCode) edit(() => (project.customCode = null));
  $('#code').value = generatedCode(exportMode);
  refreshCodeHelp();
}));
$('#code').addEventListener('input', () => { edit(() => (project.customCode = $('#code').value), 'code'); });
$('#code').addEventListener('change', refreshCodeHelp);
$('#resetCode').addEventListener('click', () => { edit(() => (project.customCode = null)); $('#code').value = generatedCode(exportMode); refreshCodeHelp(); toast('Regenerated from the slides'); });
$('#copyCode').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('#code').value); toast('Copied'); } catch { $('#code').select(); document.execCommand('copy'); toast('Copied'); } });
$('#dlCode').addEventListener('click', () => download(new Blob([$('#code').value], { type: 'text/x-python' }), 'lesson.py'));
$('#renderCode').addEventListener('click', () => {
  const code = $('#code').value;
  if (code !== generatedCode(exportMode)) edit(() => (project.customCode = code));
  $('#exportDlg').close();
  openRender(code, true);
});

// ---- render dialog (real Manim in the browser) ----------------------------------
let lastRender = null;     // { code, url, blob, markers, duration }
let renderCodeText = '';
let rendering = false;
const previewCtx = $('#renderPreview').getContext('2d');

function openRender(code = currentCode(), autostart = false) {
  renderCodeText = code;
  const have = lastRender && lastRender.code === code;
  $('#renderError').hidden = true;
  showRenderResult(have);
  if (!have && !rendering) {
    previewCtx.fillStyle = project.bg || '#000'; previewCtx.fillRect(0, 0, 1280, 720);
    $('#renderStatus').textContent = 'Ready to render.';
  }
  $('#renderDlg').showModal();
  warmUp();
  if (autostart && !have) startRender();
}
function showRenderResult(on) {
  $('#renderVideo').hidden = !on;
  $('#renderPreview').hidden = on;
  $('#dlVideo').hidden = !on;
  $('#presentVideoBtn').hidden = !on;
  if (on) {
    if ($('#renderVideo').src !== lastRender.url) $('#renderVideo').src = lastRender.url;
    $('#renderStatus').textContent = `Rendered ${lastRender.duration.toFixed(1)} s of video with ${lastRender.markers.length} click${lastRender.markers.length === 1 ? '' : 's'}.`;
  }
}
async function startRender() {
  if (rendering) return;
  rendering = true;
  $('#startRender').disabled = true;
  $('#renderError').hidden = true;
  showRenderResult(false);
  const [width, height, fps] = $('#quality').value.split('x').map(Number);
  const t0 = performance.now();
  try {
    const audio = await narrationPCM();
    const res = await renderCode(renderCodeText, { width, height, fps, assets: renderAssets(), audio }, (m) => {
      if (m.type === 'status') $('#renderStatus').textContent = m.text;
      if (m.type === 'preview') {
        previewCtx.drawImage(m.bitmap, 0, 0, 1280, 720); m.bitmap.close();
        $('#renderStatus').textContent = `Rendering with Manim… ${m.time.toFixed(1)} s of video`;
      }
    });
    if (lastRender) URL.revokeObjectURL(lastRender.url);
    lastRender = { ...res, code: renderCodeText };
    showRenderResult(true);
    $('#renderStatus').textContent += ` Took ${((performance.now() - t0) / 1000).toFixed(0)} s.`;
  } catch (err) {
    $('#renderStatus').textContent = 'Manim stopped with an error:';
    $('#renderError').textContent = err.message;
    $('#renderError').hidden = false;
  } finally {
    rendering = false;
    $('#startRender').disabled = false;
  }
}
$('#startRender').addEventListener('click', startRender);
$('#dlVideo').addEventListener('click', () => download(lastRender.blob, slug(project.title) + '.mp4'));
$('#presentVideoBtn').addEventListener('click', () => { $('#renderDlg').close(); presenter.open(0, true); });
onEngine((m) => { if (m.type === 'status' && !rendering && $('#renderDlg').open) $('#renderStatus').textContent = m.text; if (m.type === 'ready' && !rendering && $('#renderDlg').open && !(lastRender && lastRender.code === renderCodeText)) $('#renderStatus').textContent = 'Manim is loaded. Ready to render.'; });

// ---- presenter -------------------------------------------------------------------
function stateBefore(beat) {
  const beats = timeline(project);
  let st = new Map();
  for (const b of beats) { if (b === beat || (b.slide === beat.slide && b.step === beat.step)) break; st = applyBeat(st, b); }
  return st;
}
const video = $('#presentVideo');
const presenter = {
  beats: [], i: -1, state: new Map(), player: new Player($('#presentLayer')), busy: false, mode: 'live', raf: 0,
  // forceVideo: present the latest render even if the slides changed since.
  open(fromSlide, forceVideo = false) {
    this.beats = timeline(project);
    const useVideo = !this.take && lastRender && (forceVideo || lastRender.code === currentCode());
    $('#presentRec').hidden = !this.take;
    this.mode = useVideo ? 'video' : 'live';
    $('#present').hidden = false;
    document.documentElement.requestFullscreen?.().catch(() => {});
    $('#presentSvg').style.display = useVideo ? 'none' : '';
    video.hidden = !useVideo;
    if (useVideo) {
      this.markers = lastRender.markers;
      // Generated code pauses once per beat, so slide N starts at that beat's index.
      const sameShape = !project.customCode && this.markers.length === this.beats.length;
      const start = sameShape ? Math.max(0, this.beats.findIndex((b) => b.slide === fromSlide)) : 0;
      this.i = start - 1;
      if (video.src !== lastRender.url) video.src = lastRender.url;
      video.pause();
      video.currentTime = start > 0 ? this.markers[start - 1].time : 0;
      this.next();
      return;
    }
    const start = this.beats.findIndex((b) => b.slide === fromSlide);
    this.state = new Map();
    for (let k = 0; k < start; k++) this.state = applyBeat(this.state, this.beats[k]);
    this.i = start - 1;
    this.bgAt = null; this.setBg(this.beats[Math.max(0, start)]?.slide ?? 0, false);
    $('#presentLayer').innerHTML = stateSVG(this.state);
    this.next();
  },
  close() {
    this.player.stop();
    stopClip();
    if (this.take) this.take.finish();
    cancelAnimationFrame(this.raf); video.pause();
    $('#present').hidden = true;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    const b = this.mode === 'live' ? this.beats[Math.max(0, this.i)] : null;
    if (b) { cur = b.slide; setSelection([]); renderAll(); }
  },
  count() { return this.mode === 'video' ? this.markers.length : this.beats.length; },
  playTo(target) {
    cancelAnimationFrame(this.raf);
    this.busy = true;
    video.play().catch(() => {});
    const tick = () => {
      if (video.currentTime >= target - 0.02 || video.ended) {
        video.pause(); video.currentTime = Math.max(0, target - 0.001); this.busy = false; return;
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  },
  // Show slide i's background, cross-fading when it changes.
  setBg(i, fade = true) {
    const b = bgOf(project, project.slides[i]), k = bgKey(b);
    if (k === this.bgAt) return;
    const el = $('#presentBg'), had = this.bgAt !== null;
    this.bgAt = k;
    if (!fade || !had || !el.animate || matchMedia('(prefers-reduced-motion: reduce)').matches) { el.innerHTML = bgSVG(b, project); return; }
    el.insertAdjacentHTML('beforeend', `<g>${bgSVG(b, project)}</g>`);
    const top = el.lastElementChild;
    top.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 800, easing: 'ease-in-out' }).onfinish = () => { if (top.isConnected && this.bgAt === k) el.innerHTML = bgSVG(b, project); };
  },
  async next() {
    if (this.mode === 'video') {
      if (this.busy) { cancelAnimationFrame(this.raf); video.pause(); video.currentTime = this.markers[this.i].time - 0.001; this.busy = false; return; }
      if (this.i >= this.count() - 1) return;
      this.i++; this.pos();
      this.playTo(this.markers[this.i].time);
      return;
    }
    if (this.busy) { this.player.stop(); return; } // click while animating: skip to end
    if (this.i >= this.beats.length - 1) return;
    this.i++;
    this.busy = true;
    this.pos();
    this.setBg(this.beats[this.i].slide);
    if (this.take) await this.take.cut(this.beats[this.i]);
    else playClip(project.assets?.[this.beats[this.i].voice]);
    const target = applyBeat(this.state, this.beats[this.i]);
    const res = await this.player.play(this.state, this.beats[this.i]);
    this.state = target;
    if (!res) $('#presentLayer').innerHTML = stateSVG(target);
    this.busy = false;
  },
  prev() {
    if (this.i <= 0) return;
    if (this.mode === 'video') {
      cancelAnimationFrame(this.raf); video.pause(); this.busy = false;
      this.i--; video.currentTime = this.markers[this.i].time - 0.001; this.pos();
      return;
    }
    this.player.stop(); this.busy = false; stopClip();
    this.i--;
    this.state = new Map();
    for (let k = 0; k <= this.i; k++) this.state = applyBeat(this.state, this.beats[k]);
    $('#presentLayer').innerHTML = stateSVG(this.state);
    this.setBg(this.beats[this.i].slide, false);
    this.pos();
  },
  pos() {
    const tag = this.mode === 'video' ? 'Manim render · ' : '';
    if (this.mode === 'video' && (project.customCode || this.markers.length !== this.beats.length)) {
      $('#presentPos').textContent = `${tag}step ${this.i + 1}/${this.count()}`;
      $('#presentNotes').textContent = (this.i > 0 && this.markers[this.i - 1].notes) || '(no notes)';
      return;
    }
    const b = this.beats[this.i];
    const steps = this.beats.filter((x) => x.slide === b.slide);
    $('#presentPos').textContent = `${tag}Slide ${b.slide + 1}/${project.slides.length}` + (steps.length > 1 ? ` · step ${steps.indexOf(b) + 1}/${steps.length}` : '');
    $('#presentNotes').textContent = project.slides[b.slide].notes || '(no notes)';
  },
};
$('#present').addEventListener('click', (e) => {
  const p = e.target.closest('[data-p]')?.dataset.p;
  if (p === 'prev') presenter.prev();
  else if (p === 'exit') presenter.close();
  else if (p === 'notes') $('#presentNotes').hidden = !$('#presentNotes').hidden;
  else if (!e.target.closest('.present-notes')) presenter.next();
});

// ---- timeline (per slide: a track per object, a column per click) ------------------------
const emphName = (a) => (a === 'FlowCurrent' ? 'Current flow' : a);
const objName = (o) => o.name || o.label || (o.type === 'text' || o.type === 'math' ? String(o.text || '').slice(0, 24) : '') || REG[o.type]?.name || o.type;

// Every animation on this slide as a block: {kind, id, step, i (emphasis index), anim}.
function slideBlocks() {
  const s = slide(), prev = prevSlide()?.objects || [];
  const prevById = new Map(prev.map((p) => [p.id, p]));
  const beats = timeline(project).filter((b) => b.slide === cur);
  const first = beats[0]?.step || 1;
  const blocks = [];
  const changed = new Set(beats.flatMap((b) => b.phases.flat()).filter((a) => a.kind === 'transform').map((a) => a.id));
  for (const o of s.objects) {
    if (!prevById.has(o.id)) blocks.push({ kind: 'enter', id: o.id, step: Math.max(1, Math.round(o.step || 1)), anim: o.enter || 'Create' });
    else if (changed.has(o.id)) blocks.push({ kind: 'morph', id: o.id, step: o.mstep ? Math.round(o.mstep) : first, anim: 'Morph' });
    emphList(o).forEach((e, i) => blocks.push({ kind: 'emph', id: o.id, i, step: Math.max(1, Math.round(e.step || 1)), anim: e.anim }));
  }
  const outSteps = s.outSteps || {};
  for (const p of prev) if (!s.objects.some((o) => o.id === p.id)) blocks.push({ kind: 'out', id: p.id, step: outSteps[p.id] ? Math.round(outSteps[p.id]) : first, anim: 'Fade out' });
  return blocks;
}

function blockLabel(b) {
  if (b.kind === 'enter') return b.anim === 'None' ? 'Appear' : b.anim;
  if (b.kind === 'emph') return emphName(b.anim);
  return b.anim;
}

function renderTimeline() {
  const box = $('#timeline');
  const s = slide();
  const prev = prevSlide()?.objects || [];
  const leaving = prev.filter((p) => !s.objects.some((o) => o.id === p.id));
  const blocks = slideBlocks();
  const nClicks = new Set([...blocks.map((b) => b.step), ...Object.keys(s.voice || {}).filter((k) => s.voice[k]).map(Number)]).size;
  $('#tlSub').textContent = `Slide ${cur + 1} · ${nClicks ? nClicks + ' click' + (nClicks === 1 ? '' : 's') : 'nothing animates yet'}`;
  const voice = s.voice || {};
  if (!s.objects.length && !leaving.length && !Object.keys(voice).length) { box.innerHTML = '<div class="tl-empty">Add something to the slide and its animations show up here, one track per object.</div>'; return; }
  const maxStep = Math.max(1, ...blocks.map((b) => b.step), ...Object.keys(voice).filter((k) => voice[k]).map(Number));
  const cols = maxStep + 1;
  let h = `<div class="tl-grid" style="grid-template-columns: 170px repeat(${cols}, minmax(128px, 1fr))">`;
  h += `<div class="tl-corner">Object</div>`;
  for (let k = 1; k <= cols; k++) {
    h += k <= maxStep
      ? `<div class="tl-step" data-step="${k}">Click ${k}<button data-playstep="${k}" title="Play click ${k}" aria-label="Play click ${k}">${icon('play')}</button></div>`
      : `<div class="tl-step new" data-step="${k}">New click</div>`;
  }
  // Narration: one clip per click.
  h += `<div class="tl-name tl-voice" title="Narration recorded for each click">${icon('mic')}<span>Narration</span></div>`;
  for (let k = 1; k <= cols; k++) {
    const a = voice[k] && project.assets?.[voice[k]];
    const live = recording && recording.slide === s.id && recording.step === k;
    h += `<div class="tl-cell tl-voice" data-step="${k}">` + (live
      ? `<button class="tl-rec live" data-recstop title="Stop recording"><i class="lvl"></i>${icon('square')}<span>0.0 s</span></button>`
      : a ? `<span class="vblk" data-voice="${k}" title="Narration for click ${k}: click for options"><i style="width:${Math.min(100, 12 + a.dur * 8)}%"></i>${icon('volume-2')}${fmtDur(a.dur)}</span>`
        : `<button class="tl-rec" data-rec="${k}" title="Record narration for ${k <= maxStep ? 'click ' + k : 'a new click'}" aria-label="Record narration for click ${k}">${icon('mic')}<span>Record</span></button>`) + '</div>';
  }
  const row = (o, gone, inGroup) => {
    const selC = !gone && isSel(o.id) ? ' tl-row-sel' : '';
    let r = `<div class="tl-name${selC}${gone ? ' gone' : ''}${inGroup ? ' ingroup' : ''}" data-row="${o.id}" title="${escapeHTML(objName(o))}">${iconFor({ ...o, x: 0, y: 0, label: '', color: 'currentColor', fill: 'currentColor' }).replace('<svg', '<svg class="thumbic"')}<span>${escapeHTML(objName(o))}${gone ? ' (leaves)' : ''}</span></div>`;
    for (let k = 1; k <= cols; k++) {
      const here = blocks.filter((b) => b.id === o.id && b.step === k);
      r += `<div class="tl-cell${selC}" data-row="${o.id}" data-step="${k}">` +
        here.map((b) => `<span class="blk ${b.kind}" data-kind="${b.kind}" data-id="${b.id}" data-i="${b.i ?? ''}" title="${escapeHTML(blockLabel(b))}: drag to another click, click for options">${escapeHTML(blockLabel(b))}</span>`).join('') +
        (gone ? '' : `<button class="add" data-addemph="${k}" title="Add an emphasis on click ${k}" aria-label="Add emphasis on click ${k}">${icon('plus')}</button>`) + '</div>';
    }
    return r;
  };
  // timeline groups: a header row with one summary block per click, then its tracks
  const groups = trackGroups();
  const groupOf = new Map(groups.flatMap((g) => g.ids.map((id) => [id, g])));
  const done = new Set();
  const groupRows = (g) => {
    const members = s.objects.filter((o) => g.ids.includes(o.id));
    const allSel = members.every((o) => isSel(o.id));
    let r = `<div class="tl-name tl-group${allSel ? ' tl-row-sel' : ''}" data-group="${g.id}" title="${escapeHTML(g.name)}">` +
      `<button class="gtoggle" data-gtoggle="${g.id}" aria-label="${g.collapsed ? 'Expand' : 'Collapse'} ${escapeHTML(g.name)}" aria-expanded="${!g.collapsed}">${icon('chevron-down')}</button>` +
      `${icon('folder')}<span>${escapeHTML(g.name)}</span><em>${members.length}</em></div>`;
    for (let k = 1; k <= cols; k++) {
      const n = blocks.filter((b) => g.ids.includes(b.id) && b.step === k).length;
      r += `<div class="tl-cell tl-group" data-row="g:${g.id}" data-step="${k}">` +
        (n ? `<span class="blk grp" data-kind="group" data-id="g:${g.id}" data-i="${k}" title="${n} animation${n === 1 ? '' : 's'} in ${escapeHTML(g.name)}: drag to move them all to another click">${n} animation${n === 1 ? '' : 's'}</span>` : '') + '</div>';
    }
    if (!g.collapsed) for (const o of members) r += row(o, false, true);
    return r;
  };
  for (const o of s.objects) {
    if (done.has(o.id)) continue;
    const g = groupOf.get(o.id);
    if (g) { g.ids.forEach((id) => done.add(id)); h += groupRows(g); }
    else h += row(o, false);
  }
  for (const p of leaving) h += row(p, true);
  box.innerHTML = h + '</div>';
  const nSel = selectionIds().length;
  $('#tlGroup').disabled = nSel < 2;
  $('#tlGroup').title = nSel < 2 ? 'Select two or more tracks (shift-click their names) to group them' : `Group the ${nSel} selected tracks in the timeline`;
}

// Timeline groups only organise tracks; the objects stay separate on the slide.
function trackGroups() {
  const s = slide();
  const ids = new Set(s.objects.map((o) => o.id));
  // Prune in place so references held by an open menu stay live.
  s.tgroups = (s.tgroups || []).filter((g) => { g.ids = g.ids.filter((id) => ids.has(id)); return g.ids.length; });
  return s.tgroups;
}
function groupTracks() {
  const ids = selectionIds();
  if (ids.length < 2) return toast('Select two or more tracks first (shift-click their names)');
  let gid = uid();
  edit(() => {
    const s = slide();
    s.tgroups = trackGroups().map((g) => ({ ...g, ids: g.ids.filter((id) => !ids.includes(id)) })).filter((g) => g.ids.length);
    s.tgroups.push({ id: gid, name: 'Group ' + (s.tgroups.length + 1), ids, collapsed: false });
  });
  renderTimeline();
  const el = $(`#timeline [data-group="${gid}"]`);
  if (el) { flash(el); openGroupMenu(gid, el.getBoundingClientRect(), true); }
}
function openGroupMenu(gid, rect, rename = false) {
  const g = trackGroups().find((x) => x.id === gid);
  if (!g) return;
  const m = $('#tlMenu');
  m.innerHTML = `<div class="mh">Timeline group</div><input id="gName" value="${escapeHTML(g.name)}" aria-label="Group name" maxlength="40">` +
    `<button data-gsel>${icon('mouse-pointer-2')}Select its objects</button><button data-gungroup>${icon('ungroup')}Ungroup tracks</button>`;
  showMenu(rect);
  if (rename) { $('#gName').focus(); $('#gName').select(); }
  $('#gName').addEventListener('input', (e) => { edit(() => (g.name = e.target.value || 'Group'), 'gname' + gid); renderTimeline(); });
  $('#gName').addEventListener('keydown', (e) => { if (e.key === 'Enter') m.hidden = true; });
  m.onclick = (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    m.hidden = true;
    if ('gsel' in t.dataset) { setSelection(g.ids.slice()); renderStage(); renderInspector(); renderTimeline(); }
    if ('gungroup' in t.dataset) { edit(() => (slide().tgroups = trackGroups().filter((x) => x.id !== gid))); renderTimeline(); }
  };
}

// Renumber clicks so they run 1, 2, 3… with no empty columns.
function compactSteps() {
  const s = slide();
  const vk = Object.keys(s.voice || {}).filter((k) => s.voice[k]).map(Number);
  const used = [...new Set([...slideBlocks().map((b) => b.step), ...vk])].sort((a, b) => a - b);
  const map = new Map(used.map((k, i) => [k, i + 1]));
  const m = (k) => map.get(Math.round(k)) ?? k;
  for (const o of s.objects) {
    if (o.step) o.step = m(o.step);
    if (o.mstep) o.mstep = m(o.mstep);
    if (Array.isArray(o.emphs)) o.emphs.forEach((e) => (e.step = m(e.step)));
  }
  if (s.outSteps) for (const id in s.outSteps) s.outSteps[id] = m(s.outSteps[id]);
  if (s.voice) s.voice = Object.fromEntries(vk.map((k) => [m(k), s.voice[k]]));
}

function moveBlock(b, k) {
  const s = slide(), o = s.objects.find((q) => q.id === b.id);
  if (b.kind === 'enter') o.step = k;
  else if (b.kind === 'morph') o.mstep = k;
  else if (b.kind === 'emph') { o.emphs = emphList(o).map((e) => ({ ...e })); o.emphs[b.i].step = k; delete o.emph; }
  else if (b.kind === 'out') (s.outSteps ||= {})[b.id] = k;
}
function setBlockStep(b, k) {
  edit(() => {
    if (b.kind === 'group') {
      // every animation of the group's tracks on that click moves together
      const g = trackGroups().find((x) => 'g:' + x.id === b.id);
      slideBlocks().filter((x) => g.ids.includes(x.id) && x.step === b.step).forEach((x) => moveBlock(x, k));
    } else moveBlock(b, k);
    compactSteps();
  });
  renderTimeline(); renderInspector(); renderSlides();
  const moved = b.kind === 'group' ? $(`#timeline .tl-cell[data-row="${CSS.escape(b.id)}"][data-step="${k}"] .blk`) : null;
  flash(moved || $(`#timeline .tl-cell[data-row="${CSS.escape(b.id)}"][data-step="${k}"]`));
}

const blockOf = (el) => el.dataset.kind === 'group' ? { kind: 'group', id: el.dataset.id, step: +el.dataset.i }
  : slideBlocks().find((b) => b.kind === el.dataset.kind && b.id === el.dataset.id && String(b.i ?? '') === el.dataset.i);

// ---- narration ---------------------------------------------------------------------
// One clip per click, recorded here in the timeline or in one take while presenting.
let recording = null; // { slide, step, rec, timer } while a timeline clip records
function addClip(s, step, asset) {
  const id = uid();
  assetPool[id] = asset;
  project.assets = { ...(project.assets || {}), [id]: asset };
  (s.voice ||= {})[step] = id;
}
async function recordClip(k) {
  if (recording) await stopClipRecording();
  let rec;
  try { rec = await startRecording(); } catch (err) { return toast(err.message); }
  recording = { slide: slide().id, step: k, rec };
  renderTimeline();
  recording.timer = setInterval(() => {
    const b = $('#timeline [data-recstop]');
    if (!b) return;
    b.querySelector('span').textContent = ((performance.now() - rec.started) / 1000).toFixed(1) + ' s';
    b.querySelector('.lvl').style.transform = `scaleY(${0.15 + 0.85 * rec.level()})`;
  }, 80);
}
async function stopClipRecording() {
  const r = recording;
  if (!r) return;
  recording = null;
  clearInterval(r.timer);
  try {
    const asset = await r.rec.stop();
    const s = project.slides.find((x) => x.id === r.slide);
    if (s && asset.dur > 0.05) edit(() => { addClip(s, r.step, asset); if (s === slide()) compactSteps(); });
    toast(`Recorded ${fmtDur(asset.dur)} of narration for click ${r.step}`);
  } catch (err) { toast('The recording could not be saved: ' + err.message); }
  releaseMic();
  renderTimeline(); renderSlides();
}
function openVoiceMenu(k, rect) {
  const s = slide(), a = project.assets?.[s.voice?.[k]];
  if (!a) return;
  const m = $('#tlMenu');
  m.innerHTML = `<div class="mh">Narration · click ${k} · ${fmtDur(a.dur)}</div><button data-v="play">${icon('play')}Play</button><button data-v="again">${icon('mic')}Record again</button><button data-v="del">${icon('trash-2')}Remove narration</button>`;
  showMenu(rect);
  m.onclick = (e) => {
    const v = e.target.closest('[data-v]')?.dataset.v;
    if (!v) return;
    m.hidden = true;
    if (v === 'play') playClip(a);
    if (v === 'again') recordClip(k);
    if (v === 'del') { stopClip(); edit(() => { delete s.voice[k]; compactSteps(); }); renderTimeline(); renderSlides(); }
  };
}
// Record a whole voiceover: present from this slide and talk; every click starts the next clip.
async function startTake() {
  try { (await startRecording()).cancel(); } catch (err) { return toast(err.message); }
  const clips = [], pending = [];
  let rec = null, beat = null;
  presenter.take = {
    async cut(next) {
      if (rec) { const r = rec, b = beat; pending.push(r.stop().then((a) => clips.push({ b, a })).catch(() => {})); }
      beat = next; rec = null;
      try { rec = await startRecording(); } catch (err) { toast(err.message); presenter.take = null; $('#presentRec').hidden = true; }
    },
    async finish() {
      presenter.take = null;
      if (rec) { const r = rec, b = beat; pending.push(r.stop().then((a) => clips.push({ b, a })).catch(() => {})); }
      await Promise.all(pending);
      releaseMic();
      const keep = clips.filter((c) => c.a.dur > 0.3);
      if (!keep.length) return toast('Nothing was recorded');
      edit(() => keep.forEach(({ b, a }) => addClip(project.slides[b.slide], b.step, a)));
      renderAll();
      toast(`Recorded narration for ${keep.length} click${keep.length === 1 ? '' : 's'}. It plays when presenting and goes into the video.`);
    },
  };
  presenter.open(cur);
}
$('#tlTake').addEventListener('click', startTake);

let tlDrag = null;
$('#timeline').addEventListener('pointerdown', (e) => {
  const el = e.target.closest('.blk');
  if (!el || e.button !== 0) return;
  e.preventDefault();
  tlDrag = { el, x: e.clientX, y: e.clientY, moved: false, ghost: null, block: blockOf(el) };
  el.setPointerCapture(e.pointerId);
});
$('#timeline').addEventListener('pointermove', (e) => {
  if (!tlDrag) return;
  const d = tlDrag;
  if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return;
  if (!d.moved) {
    d.moved = true;
    d.ghost = d.el.cloneNode(true); d.ghost.classList.add('ghost'); document.body.appendChild(d.ghost);
    d.el.classList.add('lifting');
  }
  d.ghost.style.left = e.clientX + 8 + 'px'; d.ghost.style.top = e.clientY - 10 + 'px';
  // drop on any cell of the same track; the column picks the click
  const under = document.elementsFromPoint(e.clientX, e.clientY).find((n) => n.classList?.contains('tl-cell') || n.classList?.contains('tl-step'));
  document.querySelectorAll('.tl-cell.drop').forEach((c) => c.classList.remove('drop'));
  const k = under ? +under.dataset.step : 0;
  d.target = k || null;
  if (k) $(`#timeline .tl-cell[data-row="${CSS.escape(d.block.id)}"][data-step="${k}"]`)?.classList.add('drop');
});
const endTlDrag = (e) => {
  if (!tlDrag) return;
  const d = tlDrag; tlDrag = null;
  d.ghost?.remove(); d.el.classList.remove('lifting');
  document.querySelectorAll('.tl-cell.drop').forEach((c) => c.classList.remove('drop'));
  if (!d.block) return;
  if (!d.moved) return d.block.kind === 'group' ? openGroupMenu(d.block.id.slice(2), d.el.getBoundingClientRect()) : openBlockMenu(d.block, d.el.getBoundingClientRect());
  if (d.target && d.target !== d.block.step) setBlockStep(d.block, d.target);
};
$('#timeline').addEventListener('pointerup', endTlDrag);
$('#timeline').addEventListener('pointercancel', () => { if (tlDrag) { tlDrag.ghost?.remove(); tlDrag.el.classList.remove('lifting'); tlDrag = null; } });

$('#timeline').addEventListener('click', (e) => {
  const rb = e.target.closest('[data-rec]');
  if (rb) return recordClip(+rb.dataset.rec);
  if (e.target.closest('[data-recstop]')) return stopClipRecording();
  const vb = e.target.closest('[data-voice]');
  if (vb) return openVoiceMenu(+vb.dataset.voice, vb.getBoundingClientRect());
  const play = e.target.closest('[data-playstep]');
  if (play) return playStep(+play.dataset.playstep);
  const add = e.target.closest('[data-addemph]');
  if (add) {
    const id = add.closest('[data-row]').dataset.row, k = +add.dataset.addemph;
    const o = slide().objects.find((q) => q.id === id);
    let idx = 0;
    edit(() => { o.emphs = emphList(o).map((x) => ({ ...x })); delete o.emph; o.emphs.push({ anim: o.type === 'wire' ? 'FlowCurrent' : 'Indicate', step: k }); idx = o.emphs.length - 1; });
    setSelection([id]);
    renderAll();
    const el = $(`#timeline .blk[data-kind="emph"][data-id="${CSS.escape(id)}"][data-i="${idx}"]`);
    if (el) { appear(el); openBlockMenu(blockOf(el), el.getBoundingClientRect()); }
    return;
  }
  const gt = e.target.closest('[data-gtoggle]');
  if (gt) { const g = trackGroups().find((x) => x.id === gt.dataset.gtoggle); g.collapsed = !g.collapsed; persist(); renderTimeline(); return; }
  const gname = e.target.closest('[data-group]');
  if (gname) return openGroupMenu(gname.dataset.group, gname.getBoundingClientRect());
  const name = e.target.closest('.tl-name');
  if (name && !name.classList.contains('gone')) {
    const id = name.dataset.row;
    if (e.shiftKey || e.metaKey || e.ctrlKey) { const ids = selectionIds(); setSelection(ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id]); }
    else setSelection([id]);
    renderStage(); renderInspector(); renderTimeline();
  }
});
$('#tlGroup').addEventListener('click', groupTracks);
$('#tlToggle').addEventListener('click', () => {
  const box = $('#timelineBox');
  box.classList.toggle('collapsed');
  $('#tlToggle').setAttribute('aria-expanded', !box.classList.contains('collapsed'));
  try { localStorage.setItem('manimvis.timeline.collapsed', box.classList.contains('collapsed') ? '1' : ''); } catch {}
});
try { if (localStorage.getItem('manimvis.timeline.collapsed')) $('#timelineBox').classList.add('collapsed'); } catch {}
// Drag the timeline's top edge to trade space with the canvas.
{
  const box = $('#timelineBox');
  const setH = (h) => { box.style.height = h + 'px'; box.style.maxHeight = 'none'; };
  try { const h = +localStorage.getItem('manimvis.timeline.height'); if (h) setH(h); } catch {}
  $('#tlResize').addEventListener('pointerdown', (e) => {
    const y0 = e.clientY, h0 = box.getBoundingClientRect().height;
    e.target.setPointerCapture(e.pointerId);
    const move = (ev) => setH(Math.max(90, Math.min(window.innerHeight * 0.7, h0 + y0 - ev.clientY)));
    const up = () => {
      e.target.removeEventListener('pointermove', move); e.target.removeEventListener('pointerup', up);
      try { localStorage.setItem('manimvis.timeline.height', Math.round(box.getBoundingClientRect().height)); } catch {}
    };
    e.target.addEventListener('pointermove', move); e.target.addEventListener('pointerup', up);
  });
}

function showMenu(rect) {
  const m = $('#tlMenu');
  m.hidden = false;
  const top = rect.bottom + 4 + m.offsetHeight > window.innerHeight ? rect.top - m.offsetHeight - 4 : rect.bottom + 4;
  m.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - m.offsetWidth - 8)) + 'px';
  m.style.top = Math.max(8, top) + 'px';
  pop(m);
}

// Options for one animation block: change its animation, move it, or remove it.
function openBlockMenu(b, rect) {
  const s = slide(), o = s.objects.find((q) => q.id === b.id);
  let h = '';
  if (b.kind === 'enter') h += '<div class="mh">Enter with</div>' + ENTER_ANIMS.map((a) => `<button data-set="${a}" class="${a === b.anim ? 'on' : ''}">${a === 'None' ? 'Appear (no animation)' : a}</button>`).join('');
  if (b.kind === 'emph') h += '<div class="mh">Emphasis</div>' + EMPH_ANIMS.filter((a) => a !== 'None').map((a) => `<button data-set="${a}" class="${a === b.anim ? 'on' : ''}">${emphName(a)}</button>`).join('');
  if (b.kind === 'morph') h += '<div class="mh">Morph from the previous slide</div>';
  if (b.kind === 'out') h += '<div class="mh">Fades out (deleted on this slide)</div>';
  h += '<hr><div class="mh">Plays on click ' + b.step + '</div>';
  h += `<button data-move="-1"${b.step <= 1 ? ' disabled' : ''}>${icon('arrow-left')}Earlier click</button><button data-move="1">${icon('arrow-right')}Later click</button>`;
  if ((b.kind === 'morph' && o?.mstep) || (b.kind === 'out' && s.outSteps?.[b.id])) h += `<button data-reset>${icon('rotate-ccw')}Back to slide start</button>`;
  if (b.kind === 'emph') h += `<hr><button data-remove>${icon('trash-2')}Remove emphasis</button>`;
  const m = $('#tlMenu');
  m.innerHTML = h;
  showMenu(rect);
  m.onclick = (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    m.hidden = true;
    if (t.dataset.set) {
      edit(() => {
        if (b.kind === 'enter') o.enter = t.dataset.set;
        else { o.emphs = emphList(o).map((x) => ({ ...x })); o.emphs[b.i].anim = t.dataset.set; delete o.emph; }
      });
    } else if (t.dataset.move) return setBlockStep(b, Math.max(1, b.step + +t.dataset.move));
    else if ('reset' in t.dataset) edit(() => { if (b.kind === 'morph') delete o.mstep; else delete s.outSteps[b.id]; compactSteps(); });
    else if ('remove' in t.dataset) edit(() => { o.emphs = emphList(o).filter((_, i) => i !== b.i); delete o.emph; compactSteps(); });
    renderAll();
  };
}
document.addEventListener('pointerdown', (e) => { if (!$('#tlMenu').hidden && !e.target.closest('#tlMenu')) $('#tlMenu').hidden = true; });

async function playStep(k) {
  const beat = timeline(project).find((b) => b.slide === cur && b.step === k);
  if (!beat) return;
  const state = stateBefore(beat);
  $('#objLayer').style.opacity = 0; $('#ghostLayer').style.opacity = 0; $('#overlay').style.display = 'none';
  const v = playClip(project.assets?.[beat.voice]);
  await player.play(state, beat);
  await v;
  await sleep(500);
  $('#objLayer').style.opacity = ''; $('#ghostLayer').style.opacity = ''; $('#overlay').style.display = '';
  renderStage();
}

// ---- theme and style -----------------------------------------------------------------------
function renderLook() {
  $('#styleList').innerHTML = STYLES.map((st) => `<button type="button" data-style="${st.id}" class="${st.id === look.style ? 'on' : ''}"><b>${st.name}</b><span>${st.desc}</span></button>`).join('');
  $('#themeList').innerHTML = THEMES.map((t) => `<button type="button" data-theme="${t.id}" class="${t.id === look.theme ? 'on' : ''}" title="${escapeHTML(t.desc)}">${themeSwatch(t)}<span class="tn">${escapeHTML(t.name)}</span></button>`).join('');
  $('#followSystem').checked = !!look.follow;
}
function setLook(patch) {
  document.documentElement.classList.add('themeshift'); clearTimeout(setLook.t); setLook.t = setTimeout(() => document.documentElement.classList.remove('themeshift'), 450);
  look = { ...look, ...patch }; saveLook(look); applyLook(look); renderLook();
}
$('#styleList').addEventListener('click', (e) => { const b = e.target.closest('[data-style]'); if (b) setLook({ style: b.dataset.style }); });
$('#themeList').addEventListener('click', (e) => { const b = e.target.closest('[data-theme]'); if (b) setLook({ theme: b.dataset.theme }); });
$('#followSystem').addEventListener('change', (e) => setLook({ follow: e.target.checked }));
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => look.follow && applyLook(look));

// ---- slide themes ----------------------------------------------------------------------------
function renderSlideThemes() {
  $('#slideThemeList').innerHTML = THEMES.map((t) => `<button type="button" data-stheme="${t.id}" class="${t.id === project.slideTheme ? 'on' : ''}" title="${escapeHTML(t.desc)}">${slideSwatch(t.id)}<span class="tn">${escapeHTML(t.name)}</span></button>`).join('');
}
$('#slideThemeList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-stheme]');
  if (!b) return;
  edit(() => applySlideTheme(project, b.dataset.stheme));
  renderAll(); renderSlideThemes(); switchFx();
});

// ---- keyboard ------------------------------------------------------------------
document.addEventListener('keydown', (e) => {
  if (!$('#present').hidden) {
    if (['ArrowRight', 'ArrowDown', ' ', 'PageDown', 'Enter'].includes(e.key)) { e.preventDefault(); presenter.next(); }
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); presenter.prev(); }
    else if (e.key === 'Escape') presenter.close();
    else if (e.key.toLowerCase() === 'n') $('#presentNotes').hidden = !$('#presentNotes').hidden;
    return;
  }
  if ($('#exportDlg').open || $('#renderDlg').open || $('#shapeDlg').open || $('#lookDlg').open || $('#bgDlg').open) return;
  if (e.key === 'Escape' && (openCat || !$('#tlMenu').hidden)) { openShelf(null); $('#tlMenu').hidden = true; return; }
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z') { if (typing) return; e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && e.key.toLowerCase() === 'y') { if (typing) return; e.preventDefault(); redo(); return; }
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); commands.save(); return; }
  if (e.key === 'F5') { e.preventDefault(); commands.present(); return; }
  if (typing) return;
  if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); objAction('dup'); return; }
  if (drawing && e.key === 'Enter') { finishDrawing(false); return; }
  if (drawing && e.key === 'Backspace') { e.preventDefault(); drawing.pts.pop(); if (!drawing.pts.length) drawing = null; renderOverlay(); return; }
  if (e.key === 'Escape') { if (drawing) { drawing = null; renderOverlay(); return; } setTool('select'); setSelection([]); renderAll(); return; }
  if (mod && e.key.toLowerCase() === 'g') { e.preventDefault(); objAction(e.shiftKey ? 'ungroup' : 'group'); return; }
  if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); setSelection(slide().objects.map((q) => q.id)); renderStage(); renderInspector(); return; }
  if (e.key.toLowerCase() === 'p' && !mod) { setTool('draw'); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { objAction('del'); return; }
  if (e.key.toLowerCase() === 'w' && !mod) { setTool('wire'); return; }
  if (e.key.toLowerCase() === 'v' && !mod) { setTool('select'); return; }
  if (e.key.toLowerCase() === 'r' && !mod) { objAction(e.shiftKey ? 'rotateBack' : 'rotate'); return; }
  const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
  if (arrows[e.key] && selected()) {
    e.preventDefault();
    const st = e.shiftKey ? 1 : 0.25;
    edit(() => selectedAll().forEach((o) => { o.x = fx(o.x + arrows[e.key][0] * st); o.y = fx(o.y + arrows[e.key][1] * st); }), selectionIds().join() + 'nudge');
    renderStage(); renderInspector(); renderSlides();
  }
});

// ---- backgrounds -------------------------------------------------------------------
// The dialog edits the lesson background, or this slide's own one. The lesson's colour is
// project.bg (slide themes set it); everything else is project.background.
const bgScope = () => (slide().background ? 'slide' : 'lesson');
const bgEffective = () => bgOf(project, slide());
function bgSet(patch, coalesce) {
  edit(() => {
    if (bgScope() === 'slide') Object.assign(slide().background, patch);
    else {
      const { color, ...rest } = patch;
      if (color) project.bg = color;
      project.background = { ...(project.background || {}), ...rest };
    }
  }, coalesce);
  renderBg();
}
function openBg() { renderBg(); $('#bgDlg').showModal(); }
const opt = (list, v) => list.map(([k, n]) => `<option value="${k}"${k === v ? ' selected' : ''}>${n}</option>`).join('');
function bgRange(label, key, v, min, max, step, unit = '') {
  return `<label>${label}<span class="rng"><input type="range" data-bk="${key}" min="${min}" max="${max}" step="${step}" value="${v}"><output>${+(+v).toFixed(2)}${unit}</output></span></label>`;
}
function renderBg() {
  const b = bgEffective(), scope = bgScope();
  document.querySelectorAll('[data-bgscope]').forEach((x) => { x.classList.toggle('on', x.dataset.bgscope === scope); x.setAttribute('aria-checked', x.dataset.bgscope === scope); });
  $('#bgScopeHelp').textContent = scope === 'slide' ? `Only slide ${cur + 1}. The other slides keep the lesson background.` : 'Every slide that has no background of its own.';
  $('#bgPreview').innerHTML = bgSVG(b, project) + slide().objects.map((o) => objectSVG(o)).join('');
  $('#bgPresets').innerHTML = PRESETS.map((p) => {
    const pb = { ...b, ...(p.kind === 'look' ? { pcolor: null } : {}), ...p.bg };
    return `<button type="button" data-preset="${p.id}" title="${p.kind === 'look' ? 'Sets colours too' : 'Keeps your colours'}"><svg viewBox="-7.1111 -4 14.2222 8" aria-hidden="true">${bgSVG(pb, project)}</svg><span>${p.name}</span></button>`;
  }).join('');
  const asset = b.image && project.assets?.[b.image];
  let h = `<section><h3 class="mh">Fill</h3>
    <div class="seg" role="radiogroup">${FILLS.map(([k, n]) => `<button type="button" data-bfill="${k}" class="${b.fill === k ? 'on' : ''}">${n.replace(' gradient', '')}</button>`).join('')}</div>
    <div class="pair"><label>${b.fill === 'radial' ? 'Centre' : b.fill === 'linear' ? 'From' : 'Colour'}<input type="color" data-bk="color" value="${b.color}"></label>
    ${b.fill !== 'solid' ? `<label>${b.fill === 'radial' ? 'Edge' : 'To'}<input type="color" data-bk="color2" value="${b.color2}"></label>` : ''}</div>
    ${b.fill === 'linear' ? bgRange('Direction', 'angle', b.angle, 0, 360, 15, '°') : ''}</section>`;
  h += `<section><h3 class="mh">Pattern</h3>
    <label>Pattern<select data-bk="pattern">${opt(PATTERNS, b.pattern)}</select></label>`;
  if (b.pattern !== 'none') h += `${bgRange('Spacing', 'pspacing', b.pspacing, 0.25, 2, 0.25)}${bgRange('Strength', 'popacity', b.popacity, 0.02, 1, 0.02)}${bgRange('Line width', 'pweight', b.pweight, 0.5, 4, 0.5)}
    <label>Colour<span class="rng"><input type="checkbox" data-bk="pauto"${b.pcolor ? '' : ' checked'}> Automatic<input type="color" data-bk="pcolor" value="${b.pcolor || (isLight(b) ? '#000000' : '#ffffff')}"${b.pcolor ? '' : ' disabled'}></span></label>`;
  h += `</section><section><h3 class="mh">Image</h3>
    <div class="btnrow"><button type="button" data-bgact="image">${icon('image')}${asset ? 'Replace image' : 'Add image'}</button>${asset ? `<button type="button" data-bgact="noimage">${icon('trash-2')}Remove</button>` : ''}</div>`;
  if (asset) h += `<div class="help">${escapeHTML(asset.name)} · ${asset.w}×${asset.h}</div><label>Fit<select data-bk="fit">${opt(FITS, b.fit)}</select></label>
    ${b.fit === 'tile' ? bgRange('Tile width', 'iscale', b.iscale, 0.5, 8, 0.25) : ''}${bgRange('Opacity', 'iopacity', b.iopacity, 0, 1, 0.05)}${bgRange('Darken', 'dim', b.dim, 0, 0.9, 0.05)}`;
  h += `</section><section><h3 class="mh">Finish</h3>${bgRange('Vignette', 'vignette', b.vignette, 0, 0.9, 0.05)}</section>`;
  $('#bgForm').innerHTML = h;
  stageBg = ''; drawStageBg(); renderSlides();
}
$('#bgDlg').addEventListener('input', (e) => {
  const k = e.target.dataset.bk;
  if (!k) return;
  if (k === 'pauto') return bgSet({ pcolor: e.target.checked ? null : $('[data-bk="pcolor"]').value });
  const v = e.target.type === 'range' ? +e.target.value : e.target.value;
  if (e.target.type === 'range' || e.target.type === 'color') {
    // Sliders and colour pickers update the picture without rebuilding the form under the pointer.
    if (e.target.type === 'range') e.target.nextElementSibling.textContent = +v.toFixed(2) + (k === 'angle' ? '°' : '');
    edit(() => {
      if (bgScope() === 'slide') slide().background[k] = v;
      else if (k === 'color') project.bg = v;
      else project.background = { ...(project.background || {}), [k]: v };
    }, 'bg' + k);
    $('#bgPreview').innerHTML = bgSVG(bgEffective(), project) + slide().objects.map((o) => objectSVG(o)).join('');
    stageBg = ''; drawStageBg();
    return;
  }
  bgSet({ [k]: v });
});
$('#bgDlg').addEventListener('change', (e) => { if (e.target.type === 'range' || e.target.type === 'color') renderBg(); });
$('#bgDlg').addEventListener('click', (e) => {
  const sc = e.target.closest('[data-bgscope]');
  if (sc) {
    if (sc.dataset.bgscope === bgScope()) return;
    edit(() => { if (sc.dataset.bgscope === 'slide') slide().background = { ...bgEffective() }; else delete slide().background; });
    renderBg(); renderInspector();
    return;
  }
  const f = e.target.closest('[data-bfill]');
  if (f) return bgSet({ fill: f.dataset.bfill });
  const pr = e.target.closest('[data-preset]');
  if (pr) {
    const p = PRESETS.find((x) => x.id === pr.dataset.preset);
    bgSet({ ...(p.kind === 'look' ? { pcolor: null } : {}), ...p.bg });
    flash(pr);
    return;
  }
  const a = e.target.closest('[data-bgact]')?.dataset.bgact;
  if (a === 'image') $('#bgFile').click();
  if (a === 'noimage') bgSet({ image: null });
});
$('#bgFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const asset = await importImage(file);
    const id = uid();
    assetPool[id] = asset;
    edit(() => { project.assets = { ...(project.assets || {}), [id]: asset }; });
    bgSet({ image: id, fit: bgEffective().image ? bgEffective().fit : 'cover' });
  } catch (err) { toast(err.message); }
});
$('#bgDlg').addEventListener('close', () => { renderInspector(); renderSlides(); });

// Grid menu in the dock.
$('#gridBtn').addEventListener('click', () => {
  const m = $('#tlMenu');
  const sp = [[0.25, '¼'], [0.5, '½'], [1, '1']];
  m.innerHTML = `<div class="mh">Editor grid</div>
    <button data-g="show">${icon(grid.show ? 'check' : 'x')}${grid.show ? 'Grid shown' : 'Grid hidden'}</button>
    <button data-g="snap">${icon(snapOn() ? 'check' : 'x')}${snapOn() ? 'Snapping on' : 'Snapping off'}</button>
    <div class="mh">Spacing (units)</div><div class="seg">${sp.map(([v, n]) => `<button data-gs="${v}" class="${grid.spacing === v ? 'on' : ''}">${n}</button>`).join('')}</div>
    <div class="help">Objects snap to half a grid square. The grid only shows while editing; slide patterns are in Background.</div>`;
  showMenu($('#gridBtn').getBoundingClientRect());
  m.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.g === 'show') setGrid({ show: !grid.show });
    if (b.dataset.g === 'snap') $('#snapBtn').click();
    if (b.dataset.gs) setGrid({ spacing: +b.dataset.gs });
    $('#gridBtn').click();
  };
});

// ---- boot --------------------------------------------------------------------------
function renderAll() {
  attachAssets();
  fonts.lesson = project.font || DEFAULT_FONT;
  $('#title').value = project.title || '';
  renderSlides(); renderStage(); renderInspector(); renderTimeline();
}
setGrid({});
renderPalette();
renderAll();
// Drop stored images and clips this lesson no longer uses.
setTimeout(() => pruneAssets(new Set(Object.keys(project.assets || {}))), 3000);
// KaTeX loads deferred; redraw once it is there so math renders properly.
window.addEventListener('load', () => { if (window.katex) { renderAll(); renderPalette(); } });

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
export { FRAME_W, FRAME_H };
