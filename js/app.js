import { REG, CATEGORIES, ENTER_ANIMS, EMPH_ANIMS, makeObject, uid, checkExpr } from './components.js';
import { worldPrims, primsSVG, objectSVG, bbox, timeline, emphList, fonts, DEFAULT_FONT, FRAME_W, FRAME_H } from './render.js';
import { Player, applyBeat, stateSVG } from './player.js';
import { exportPython } from './export.js';
import { demoProject } from './demo.js';
import { renderCode, warmUp, onEngine } from './manim/engine.js';
import { icon, installIcons } from './icons.js';
import { THEMES, STYLES, loadLook, saveLook, applyLook, themeSwatch } from './themes.js';

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
function persist() { clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { localStorage.setItem(STORE, JSON.stringify(project)); } catch {} }, 250); }

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
function restore(snap) { const s = JSON.parse(snap); project = s.project; cur = Math.min(s.cur, project.slides.length - 1); sel = s.sel; extra = new Set(s.extra || []); renderAll(); persist(); }
function undo() { if (!undoStack.length) return; redoStack.push(snapshot()); restore(undoStack.pop()); lastCoalesce = null; }
function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); restore(redoStack.pop()); lastCoalesce = null; }

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2200); }

// ---- stage -------------------------------------------------------------------
const stage = $('#stage');
const player = new Player($('#playLayer'));

function drawGrid() {
  let s = '';
  for (let x = -7; x <= 7; x += 0.5) s += `<line x1="${x}" y1="-4" x2="${x}" y2="4"${x === 0 ? ' class="axis"' : ''}/>`;
  for (let y = -4; y <= 4; y += 0.5) s += `<line x1="-7.12" y1="${y}" x2="7.12" y2="${y}"${y === 0 ? ' class="axis"' : ''}/>`;
  $('#grid').innerHTML = s;
}

function renderStage() {
  player.stop();
  $('#playLayer').innerHTML = '';
  $('#bg').setAttribute('fill', project.bg || '#000');
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
const snap = (v) => (snapOn() ? round(v, 0.25) : fx(v));
const snapshot = () => JSON.stringify({ project, cur, sel, extra: [...extra] });

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
function addObject(type, x, y) {
  edit(() => {
    if (x == null) [x, y] = staggered();
    const o = makeObject(type, { x, y });
    if (REG[type].ends) { o.x -= o.dx / 2; o.y -= o.dy / 2; o.x = snap(o.x); o.y = snap(o.y); }
    if (!REG[type].noLabel && o.label) o.label = nextLabel(o.label);
    slide().objects.push(o);
    setSelection([o.id]);
  });
  renderAll();
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
  if (cat) placeShelf();
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
  return `<svg viewBox="-7.1111 -4 14.2222 8"><rect x="-7.12" y="-4" width="14.23" height="8" fill="${project.bg || '#000'}"/>${s.objects.map((o) => objectSVG(o)).join('')}</svg>`;
}
function renderSlides() {
  $('#slideList').innerHTML = project.slides.map((s, i) => `<li data-i="${i}"${i === cur ? ' class="on"' : ''}>
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
    if (project.slides.length === 1) return toast('A lesson needs at least one slide');
    edit(() => { project.slides.splice(i, 1); cur = Math.min(cur, project.slides.length - 1); setSelection([]); });
  } else if (op === 'up' && i > 0) {
    edit(() => { const [s] = project.slides.splice(i, 1); project.slides.splice(i - 1, 0, s); cur = i - 1; });
  } else if (op === 'down' && i < project.slides.length - 1) {
    edit(() => { const [s] = project.slides.splice(i, 1); project.slides.splice(i + 1, 0, s); cur = i + 1; });
  } else if (!op) { cur = i; setSelection([]); }
  renderAll();
});
function addSlide(dup) {
  edit(() => {
    const s = dup ? { ...clone(slide()), id: uid(), name: (slide().name || 'Slide') + ' (next)', notes: '' }
      : { id: uid(), name: 'Slide ' + (project.slides.length + 1), notes: '', objects: [] };
    if (dup) { s.objects.forEach((o) => { delete o.emph; o.emphs = []; o.step = 1; delete o.mstep; }); delete s.outSteps; }
    project.slides.splice(cur + 1, 0, s);
    cur++; setSelection([]);
  });
  renderAll();
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
      <div class="btnrow"><button data-act="group" class="accent">${icon('group')}Group</button><button data-act="saveShape">${icon('bookmark-plus')}Save as shape</button></div>
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
      <h4>Lesson</h4><div class="sec" data-scope="project">${field('Background', 'bg', 'color', project.bg || '#000000')}${field('Font', 'font', 'font', project.font || DEFAULT_FONT, { inherit: null })}</div>
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
  if (key === 'recolor') edit(() => recolor(o, v), o.id + key);
  else if (key === 'emph' || key === 'emphStep') edit(() => {
    const em = emphList(o).map((e) => ({ ...e }));
    if (key === 'emph') { if (v === 'None') em.shift(); else if (em[0]) em[0].anim = v; else em.unshift({ anim: v, step: o.step || 1 }); }
    else if (em[0]) em[0].step = Math.max(1, Math.round(v));
    o.emphs = em; delete o.emph;
  }, o.id + key);
  else edit(() => { o[key] = key === 'step' ? Math.max(1, Math.round(v)) : v; }, o.id + key);
  renderStage(); renderSlides();
  if (el.tagName === 'SELECT' || el.type === 'checkbox' || key === 'fx') renderInspector();
  renderTimeline();
});
$('#inspector').addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act) objAction(act);
});
function objAction(act) {
  const objs = selectedAll();
  if (!objs.length) return;
  const o = objs[0];
  const rot = (q, back) => { if (REG[q.type].ends) { [q.dx, q.dy] = back ? [q.dy, -q.dx] : [-q.dy, q.dx]; } else q.rot = ((q.rot || 0) + (back ? 270 : 90)) % 360; };
  if (act === 'saveShape') return openSaveShape();
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
    for (const b of beats) { state = await player.play(state, b); if (!state) break; await sleep(350); }
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

function openCode() {
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
    const res = await renderCode(renderCodeText, { width, height, fps }, (m) => {
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
    const useVideo = lastRender && (forceVideo || lastRender.code === currentCode());
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
    $('#presentBg').setAttribute('fill', project.bg || '#000');
    $('#presentLayer').innerHTML = stateSVG(this.state);
    this.next();
  },
  close() {
    this.player.stop();
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
    this.player.stop(); this.busy = false;
    this.i--;
    this.state = new Map();
    for (let k = 0; k <= this.i; k++) this.state = applyBeat(this.state, this.beats[k]);
    $('#presentLayer').innerHTML = stateSVG(this.state);
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
  $('#tlSub').textContent = `Slide ${cur + 1} · ${blocks.length ? new Set(blocks.map((b) => b.step)).size + ' click' + (new Set(blocks.map((b) => b.step)).size === 1 ? '' : 's') : 'nothing animates yet'}`;
  if (!s.objects.length && !leaving.length) { box.innerHTML = '<div class="tl-empty">Add something to the slide and its animations show up here, one track per object.</div>'; return; }
  const maxStep = Math.max(1, ...blocks.map((b) => b.step));
  const cols = maxStep + 1;
  let h = `<div class="tl-grid" style="grid-template-columns: 170px repeat(${cols}, minmax(128px, 1fr))">`;
  h += `<div class="tl-corner">Object</div>`;
  for (let k = 1; k <= cols; k++) {
    h += k <= maxStep
      ? `<div class="tl-step" data-step="${k}">Click ${k}<button data-playstep="${k}" title="Play click ${k}" aria-label="Play click ${k}">${icon('play')}</button></div>`
      : `<div class="tl-step new" data-step="${k}">New click</div>`;
  }
  const row = (o, gone) => {
    const selC = !gone && isSel(o.id) ? ' tl-row-sel' : '';
    let r = `<div class="tl-name${selC}${gone ? ' gone' : ''}" data-row="${o.id}" title="${escapeHTML(objName(o))}">${iconFor({ ...o, x: 0, y: 0, label: '', color: 'currentColor', fill: 'currentColor' }).replace('<svg', '<svg class="thumbic"')}<span>${escapeHTML(objName(o))}${gone ? ' (leaves)' : ''}</span></div>`;
    for (let k = 1; k <= cols; k++) {
      const here = blocks.filter((b) => b.id === o.id && b.step === k);
      r += `<div class="tl-cell${selC}" data-row="${o.id}" data-step="${k}">` +
        here.map((b) => `<span class="blk ${b.kind}" data-kind="${b.kind}" data-id="${b.id}" data-i="${b.i ?? ''}" title="${escapeHTML(blockLabel(b))}: drag to another click, click for options">${escapeHTML(blockLabel(b))}</span>`).join('') +
        (gone ? '' : `<button class="add" data-addemph="${k}" title="Add an emphasis on click ${k}" aria-label="Add emphasis on click ${k}">${icon('plus')}</button>`) + '</div>';
    }
    return r;
  };
  for (const o of s.objects) h += row(o, false);
  for (const p of leaving) h += row(p, true);
  box.innerHTML = h + '</div>';
}

// Renumber clicks so they run 1, 2, 3… with no empty columns.
function compactSteps() {
  const s = slide();
  const used = [...new Set(slideBlocks().map((b) => b.step))].sort((a, b) => a - b);
  const map = new Map(used.map((k, i) => [k, i + 1]));
  const m = (k) => map.get(Math.round(k)) ?? k;
  for (const o of s.objects) {
    if (o.step) o.step = m(o.step);
    if (o.mstep) o.mstep = m(o.mstep);
    if (Array.isArray(o.emphs)) o.emphs.forEach((e) => (e.step = m(e.step)));
  }
  if (s.outSteps) for (const id in s.outSteps) s.outSteps[id] = m(s.outSteps[id]);
}

function setBlockStep(b, k) {
  const s = slide(), o = s.objects.find((q) => q.id === b.id);
  edit(() => {
    if (b.kind === 'enter') o.step = k;
    else if (b.kind === 'morph') o.mstep = k;
    else if (b.kind === 'emph') { o.emphs = emphList(o).map((e) => ({ ...e })); o.emphs[b.i].step = k; delete o.emph; }
    else if (b.kind === 'out') (s.outSteps ||= {})[b.id] = k;
    compactSteps();
  });
  renderTimeline(); renderInspector(); renderSlides();
}

const blockOf = (el) => slideBlocks().find((b) => b.kind === el.dataset.kind && b.id === el.dataset.id && String(b.i ?? '') === el.dataset.i);

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
  if (!d.moved) return openBlockMenu(d.block, d.el.getBoundingClientRect());
  if (d.target && d.target !== d.block.step) setBlockStep(d.block, d.target);
};
$('#timeline').addEventListener('pointerup', endTlDrag);
$('#timeline').addEventListener('pointercancel', () => { if (tlDrag) { tlDrag.ghost?.remove(); tlDrag.el.classList.remove('lifting'); tlDrag = null; } });

$('#timeline').addEventListener('click', (e) => {
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
    if (el) openBlockMenu(blockOf(el), el.getBoundingClientRect());
    return;
  }
  const name = e.target.closest('.tl-name');
  if (name && !name.classList.contains('gone')) {
    const id = name.dataset.row;
    if (e.shiftKey || e.metaKey || e.ctrlKey) { const ids = selectionIds(); setSelection(ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id]); }
    else setSelection([id]);
    renderStage(); renderInspector(); renderTimeline();
  }
});
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
  m.innerHTML = h; m.hidden = false;
  const top = rect.bottom + 4 + m.offsetHeight > window.innerHeight ? rect.top - m.offsetHeight - 4 : rect.bottom + 4;
  m.style.left = Math.min(rect.left, window.innerWidth - m.offsetWidth - 8) + 'px';
  m.style.top = Math.max(8, top) + 'px';
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
  await player.play(state, beat);
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
function setLook(patch) { look = { ...look, ...patch }; saveLook(look); applyLook(look); renderLook(); }
$('#styleList').addEventListener('click', (e) => { const b = e.target.closest('[data-style]'); if (b) setLook({ style: b.dataset.style }); });
$('#themeList').addEventListener('click', (e) => { const b = e.target.closest('[data-theme]'); if (b) setLook({ theme: b.dataset.theme }); });
$('#followSystem').addEventListener('change', (e) => setLook({ follow: e.target.checked }));
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => look.follow && applyLook(look));

// ---- keyboard ------------------------------------------------------------------
document.addEventListener('keydown', (e) => {
  if (!$('#present').hidden) {
    if (['ArrowRight', 'ArrowDown', ' ', 'PageDown', 'Enter'].includes(e.key)) { e.preventDefault(); presenter.next(); }
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); presenter.prev(); }
    else if (e.key === 'Escape') presenter.close();
    else if (e.key.toLowerCase() === 'n') $('#presentNotes').hidden = !$('#presentNotes').hidden;
    return;
  }
  if ($('#exportDlg').open || $('#renderDlg').open || $('#shapeDlg').open || $('#lookDlg').open) return;
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

// ---- boot --------------------------------------------------------------------------
function renderAll() {
  fonts.lesson = project.font || DEFAULT_FONT;
  $('#title').value = project.title || '';
  renderSlides(); renderStage(); renderInspector(); renderTimeline();
}
drawGrid();
renderPalette();
renderAll();
// KaTeX loads deferred; redraw once it is there so math renders properly.
window.addEventListener('load', () => { if (window.katex) { renderAll(); renderPalette(); } });

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
export { FRAME_W, FRAME_H };
