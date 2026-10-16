// The audio editor: trim, fades, volume, voice clean-up and even loudness for any clip
// (narration, sound effects, music). Edits are applied to a copy; the original is kept so
// opening the editor again starts from it with the same settings.
import { decode, SAMPLE_RATE } from './voice.js';
import { channelInput, Mixer } from './meter.js';
import { processAudio, peaks, wavBytes, findClicks, DEFAULT_EDIT, VOICE_PRESET } from './audiofx.js';

const $ = (s, r = document) => r.querySelector(s);
const r2 = (v) => Math.round(v * 100) / 100;

function dialog() {
  let d = $('#audDlg');
  if (d) return d;
  d = document.createElement('dialog');
  d.id = 'audDlg';
  d.innerHTML = `<form method="dialog" class="dlg">
    <h2>Edit audio <small id="audName"></small></h2>
    <div class="audwave"><canvas id="audWave" aria-label="Waveform. Drag the edges to trim."></canvas></div>
    <p class="help" id="audSel"></p>
    <div class="audgrid">
      <label class="fld"><span>Start (s)</span><input id="audStart" type="number" min="0" step="0.05"></label>
      <label class="fld"><span>End (s)</span><input id="audEnd" type="number" min="0" step="0.05"></label>
      <label class="fld"><span>Fade in (s)</span><input id="audFadeIn" type="number" min="0" step="0.1"></label>
      <label class="fld"><span>Fade out (s)</span><input id="audFadeOut" type="number" min="0" step="0.1"></label>
      <label class="fld wide"><span>Volume <b id="audGainV"></b></span><input id="audGain" type="range" min="-20" max="12" step="0.5"></label>
    </div>
    <div class="audvoice">
      <div class="row"><h3>Voice</h3><span class="grow"></span><button type="button" id="audPreset"><svg class="ic" aria-hidden="true"><use href="#i-sparkles"/></svg><span>Voiceover preset</span></button></div>
      <div class="audgrid">
        <label class="fld wide2"><span>Click removal <b data-v="declick"></b> <small id="audClicks"></small></span><input id="audDeclick" type="range" min="0" max="1" step="0.05"></label>
        <label class="fld wide2"><span>Noise removal <b data-v="denoise"></b></span><input id="audDenoise" type="range" min="0" max="1" step="0.05"></label>
        <label class="fld wide2"><span>De-esser <b data-v="deess"></b></span><input id="audDeess" type="range" min="0" max="1" step="0.05"></label>
        <label class="fld wide2"><span>Compressor</span><select id="audComp"><option value="0">Off</option><option value="1">Light (2:1)</option><option value="2">Medium (3:1)</option><option value="3">Strong (4:1)</option></select></label>
        <label class="chk wide2"><input id="audPlosive" type="checkbox"><span><b>Tame pops</b><br>Softens "p" and "b" thumps and low rumble.</span></label>
        <label class="fld"><span>Low <b data-v="eqLow"></b></span><input id="audEqLow" type="range" min="-12" max="12" step="0.5"></label>
        <label class="fld"><span>Presence <b data-v="eqMid"></b></span><input id="audEqMid" type="range" min="-12" max="12" step="0.5"></label>
        <label class="fld"><span>Air <b data-v="eqHigh"></b></span><input id="audEqHigh" type="range" min="-12" max="12" step="0.5"></label>
        <span class="help">EQ: Low is warmth and boom (120 Hz), Presence is clarity (3 kHz), Air is brightness (10 kHz).</span>
      </div>
    </div>
    <label class="chk"><input id="audLevel" type="checkbox"><span><b>Even out loudness</b><br>Brings the clip to a standard level. Turn it on for every narration clip so they all match.</span></label>
    <div class="row">
      <button type="button" id="audPlay"><svg class="ic" aria-hidden="true"><use href="#i-play"/></svg><span>Play</span></button>
      <button type="button" id="audReset"><svg class="ic" aria-hidden="true"><use href="#i-rotate-ccw"/></svg><span>Undo edits</span></button>
      <span class="grow"></span>
      <button type="button" value="cancel" id="audCancel"><svg class="ic" aria-hidden="true"><use href="#i-x"/></svg><span>Cancel</span></button>
      <button type="button" class="accent" id="audApply"><svg class="ic" aria-hidden="true"><use href="#i-check"/></svg><span>Apply</span></button>
    </div>
  </form>`;
  document.body.appendChild(d);
  $('#audPlay', d).after(new Mixer(document.createDocumentFragment()).el);
  return d;
}

const dataURL = (bytes, type) => new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(new Blob([bytes], { type })); });

// Edit the audio asset `id`. `assets` holds every asset, so an earlier edit's original is found.
// Resolves to {asset} (a new asset to use in its place, remembering its original as `orig`),
// {restore: id} (edits undone: use the original again) or null when cancelled.
export async function editAudio(id, assets) {
  const asset = assets[id];
  const baseId = asset.orig && assets[asset.orig] ? asset.orig : id, base = assets[baseId];
  const pcm = await decode(base);
  const dur = pcm.length / SAMPLE_RATE;
  const e = { ...DEFAULT_EDIT, ...(base === asset ? {} : asset.edit), end: null };
  e.end = Math.min(dur, (base === asset ? null : asset.edit?.end) ?? dur);
  if (e.clean) Object.assign(e, { ...VOICE_PRESET, level: e.level, clean: false }); // older one-box clean-up
  const d = dialog();
  $('#audName', d).textContent = base.name ? '· ' + base.name.replace(/\.[a-z0-9]+$/i, '') : '';
  const cv = $('#audWave', d), ctx = cv.getContext('2d');
  let pk = null, ac = null, src = null, playStart = 0, raf = 0;

  const fields = { start: '#audStart', end: '#audEnd', fadeIn: '#audFadeIn', fadeOut: '#audFadeOut', gain: '#audGain',
    declick: '#audDeclick', denoise: '#audDenoise', deess: '#audDeess', comp: '#audComp', eqLow: '#audEqLow', eqMid: '#audEqMid', eqHigh: '#audEqHigh' };
  const dB = (v) => (v > 0 ? '+' : '') + v + ' dB', pct = (v) => (v ? Math.round(v * 100) + '%' : 'off');
  // Clicks found with the current sensitivity, in seconds of the original, marked on the waveform.
  let clicks = [], clickKey = '', clickTimer = 0;
  const scanClicks = () => {
    const key = e.declick ? [e.declick, e.start, e.end].join() : '';
    if (key === clickKey) return;
    clickKey = key; clearTimeout(clickTimer);
    if (!key) { clicks = []; $('#audClicks', d).textContent = ''; draw(); return; }
    clickTimer = setTimeout(() => {
      const a = Math.round(e.start * SAMPLE_RATE);
      clicks = findClicks(pcm.slice(a, Math.round(e.end * SAMPLE_RATE)), SAMPLE_RATE, e.declick).map(([s, t]) => [(s + a) / SAMPLE_RATE, (t + a) / SAMPLE_RATE]);
      $('#audClicks', d).textContent = clicks.length ? `· ${clicks.length} found` : '· none found';
      draw();
    }, 150);
  };
  const labels = () => {
    $('#audGainV', d).textContent = dB(e.gain);
    for (const b of d.querySelectorAll('[data-v]')) { const k = b.dataset.v; b.textContent = k.startsWith('eq') ? dB(e[k]) : pct(e[k]); }
    scanClicks();
  };
  const show = () => {
    for (const k in fields) $(fields[k], d).value = k === 'comp' ? String(e.comp) : r2(e[k]);
    $('#audPlosive', d).checked = e.plosive; $('#audLevel', d).checked = e.level;
    labels();
    $('#audSel', d).textContent = `Keeps ${r2(e.end - e.start)} s of ${r2(dur)} s. Drag the edges of the waveform to trim.`;
    draw();
  };
  const css = (n) => getComputedStyle(d).getPropertyValue(n).trim();
  function draw(head = null) {
    const W = cv.clientWidth || 600, H = cv.clientHeight || 120, k = devicePixelRatio || 1;
    if (cv.width !== Math.round(W * k)) { cv.width = Math.round(W * k); cv.height = Math.round(H * k); pk = null; }
    pk ||= peaks(pcm, cv.width);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    const x = (t) => (t / dur) * cv.width, mid = cv.height / 2;
    const xa = x(e.start), xb = x(e.end);
    for (let c = 0; c < pk.length; c++) {
      ctx.fillStyle = c >= xa && c <= xb ? css('--accent') || '#58c4dd' : css('--muted') || '#888';
      ctx.globalAlpha = c >= xa && c <= xb ? 1 : 0.35;
      const [lo, hi] = pk[c];
      ctx.fillRect(c, mid - hi * mid * 0.95, 1, Math.max(1, (hi - lo) * mid * 0.95));
    }
    ctx.globalAlpha = 1;
    // Fades as ramps over the kept part.
    ctx.strokeStyle = css('--text') || '#fff'; ctx.lineWidth = k;
    ctx.beginPath();
    ctx.moveTo(xa, cv.height); ctx.lineTo(x(e.start + e.fadeIn), 2 * k); ctx.lineTo(x(e.end - e.fadeOut), 2 * k); ctx.lineTo(xb, cv.height);
    ctx.globalAlpha = 0.5; ctx.stroke(); ctx.globalAlpha = 1;
    // Trim handles.
    ctx.fillStyle = css('--text') || '#fff';
    for (const hx of [xa, xb]) { ctx.fillRect(hx - k, 0, 2 * k, cv.height); ctx.fillRect(hx - 4 * k, mid - 10 * k, 8 * k, 20 * k); }
    ctx.fillStyle = css('--danger') || '#f55'; ctx.globalAlpha = 0.85;
    for (const [a, b] of clicks) ctx.fillRect(x(a) - k, 0, Math.max(2 * k, x(b) - x(a)), 6 * k);
    ctx.globalAlpha = 1;
    if (head != null) { ctx.fillStyle = css('--danger') || '#f55'; ctx.fillRect(x(head) - k, 0, 2 * k, cv.height); }
  }
  const stop = () => { try { src?.stop(); } catch {} src = null; cancelAnimationFrame(raf); $('#audPlay span', d).textContent = 'Play'; draw(); };
  const play = () => {
    if (src) return stop();
    // Through the shared output, so the level meter shows the preview.
    const io = channelInput('voice');
    ac = io?.ctx || ac || new AudioContext();
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    const out = processAudio(pcm, SAMPLE_RATE, e);
    if (!out.length) return;
    const buf = ac.createBuffer(1, out.length, SAMPLE_RATE);
    buf.copyToChannel(out, 0);
    src = ac.createBufferSource(); src.buffer = buf; src.connect(io?.node || ac.destination); io?.start();
    src.onended = () => { if (src) stop(); };
    src.start(); playStart = ac.currentTime;
    $('#audPlay span', d).textContent = 'Stop';
    const tick = () => { draw(e.start + (ac.currentTime - playStart)); raf = requestAnimationFrame(tick); };
    tick();
  };
  const clampAll = () => {
    e.start = Math.max(0, Math.min(dur - 0.05, e.start));
    e.end = Math.max(e.start + 0.05, Math.min(dur, e.end));
    const len = e.end - e.start;
    e.fadeIn = Math.max(0, Math.min(len, e.fadeIn)); e.fadeOut = Math.max(0, Math.min(len - e.fadeIn, e.fadeOut));
  };

  // Dragging a trim edge.
  let drag = null;
  cv.onpointerdown = (ev) => {
    const r = cv.getBoundingClientRect(), t = ((ev.clientX - r.left) / r.width) * dur;
    drag = Math.abs(t - e.start) < Math.abs(t - e.end) ? 'start' : 'end';
    cv.setPointerCapture(ev.pointerId);
    cv.onpointermove(ev);
  };
  cv.onpointermove = (ev) => {
    if (!drag) return;
    const r = cv.getBoundingClientRect();
    e[drag] = r2(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * dur);
    clampAll(); show();
  };
  cv.onpointerup = cv.onpointercancel = () => { drag = null; };

  d.oninput = (ev) => {
    const k = Object.keys(fields).find((f) => ev.target.matches(fields[f]));
    if (k) { const v = parseFloat(ev.target.value); if (Number.isFinite(v)) e[k] = v; }
    if (ev.target.id === 'audPlosive') e.plosive = ev.target.checked;
    if (ev.target.id === 'audLevel') e.level = ev.target.checked;
    clampAll();
    labels();
    $('#audSel', d).textContent = `Keeps ${r2(e.end - e.start)} s of ${r2(dur)} s. Drag the edges of the waveform to trim.`;
    draw();
  };
  d.onchange = () => { if (src) { stop(); play(); } show(); };
  $('#audPlay', d).onclick = play;
  $('#audPreset', d).onclick = () => { Object.assign(e, VOICE_PRESET); show(); if (src) { stop(); play(); } };
  $('#audReset', d).onclick = () => { stop(); Object.assign(e, DEFAULT_EDIT, { end: dur }); show(); };

  return new Promise((resolve) => {
    const finish = (v) => { stop(); if (ac && !channelInput('voice')) ac.close(); ac = null; d.onclose = null; d.close(); resolve(v); };
    $('#audCancel', d).onclick = () => finish(null);
    d.onclose = () => finish(null);
    $('#audApply', d).onclick = async () => {
      const plain = ['clean', 'level', 'gain', 'fadeIn', 'fadeOut', 'declick', 'denoise', 'plosive', 'deess', 'comp', 'eqLow', 'eqMid', 'eqHigh'].every((k) => !e[k]) && e.start <= 0.001 && e.end >= dur - 0.001;
      if (plain) return finish(base === asset ? null : { restore: baseId });
      const out = processAudio(pcm, SAMPLE_RATE, e);
      const src = await dataURL(wavBytes(out, SAMPLE_RATE), 'audio/wav');
      finish({ asset: { src, type: 'audio/wav', kind: 'audio', name: base.name, dur: Math.round((out.length / SAMPLE_RATE) * 1000) / 1000, orig: baseId, edit: { ...e } } });
    };
    d.showModal();
    requestAnimationFrame(show);
  });
}
