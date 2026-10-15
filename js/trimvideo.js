// Trim a video clip: pick the part of the file it plays. The file itself is kept whole, so a
// trim can be changed later; the clip object remembers trimIn and trimOut (seconds).
import { videoURL, posterURL } from './video.js';

const $ = (s, r = document) => r.querySelector(s);
const r2 = (v) => Math.round(v * 100) / 100;

function dialog() {
  let d = $('#trimDlg');
  if (d) return d;
  d = document.createElement('dialog');
  d.id = 'trimDlg';
  d.innerHTML = `<form method="dialog" class="dlg">
    <h2>Trim clip <small id="trimName"></small></h2>
    <video id="trimVid" playsinline preload="auto"></video>
    <div class="trimbar"><input id="trimPos" type="range" min="0" step="0.01" aria-label="Position"><span id="trimNow"></span></div>
    <div class="row">
      <button type="button" id="trimSetIn"><svg class="ic" aria-hidden="true"><use href="#i-scissors"/></svg><span>Start here</span></button>
      <button type="button" id="trimSetOut"><svg class="ic" aria-hidden="true"><use href="#i-scissors"/></svg><span>End here</span></button>
      <button type="button" id="trimPlay"><svg class="ic" aria-hidden="true"><use href="#i-play"/></svg><span>Play selection</span></button>
    </div>
    <div class="audgrid">
      <label class="fld"><span>Start (s)</span><input id="trimIn" type="number" min="0" step="0.05"></label>
      <label class="fld"><span>End (s)</span><input id="trimOut" type="number" min="0" step="0.05"></label>
    </div>
    <p class="help" id="trimSel"></p>
    <div class="row">
      <button type="button" id="trimReset"><svg class="ic" aria-hidden="true"><use href="#i-rotate-ccw"/></svg><span>Whole clip</span></button>
      <span class="grow"></span>
      <button type="button" id="trimCancel"><svg class="ic" aria-hidden="true"><use href="#i-x"/></svg><span>Cancel</span></button>
      <button type="button" class="accent" id="trimApply"><svg class="ic" aria-hidden="true"><use href="#i-check"/></svg><span>Apply</span></button>
    </div>
  </form>`;
  document.body.appendChild(d);
  return d;
}

// Resolves to {trimIn, trimOut} (null fields when untrimmed) or null when cancelled.
export function trimVideo(o, asset) {
  const d = dialog(), v = $('#trimVid', d), pos = $('#trimPos', d);
  const dur = asset.dur;
  const t = { a: Math.max(0, o.trimIn || 0), b: Math.min(dur, o.trimOut ?? dur) };
  $('#trimName', d).textContent = asset.name ? '· ' + asset.name.replace(/\.[a-z0-9]+$/i, '') : '';
  v.src = videoURL(asset); v.poster = posterURL(asset);
  pos.max = dur;
  let playing = false;
  const show = () => {
    $('#trimIn', d).value = r2(t.a); $('#trimOut', d).value = r2(t.b);
    $('#trimSel', d).textContent = `Plays ${r2(t.b - t.a)} s of ${r2(dur)} s.`;
    pos.style.setProperty('--a', (t.a / dur) * 100 + '%'); pos.style.setProperty('--b', (t.b / dur) * 100 + '%');
  };
  const clamp = () => { t.a = Math.max(0, Math.min(dur - 0.1, t.a)); t.b = Math.max(t.a + 0.1, Math.min(dur, t.b)); };
  const seek = (x) => { try { v.currentTime = x; } catch {} };
  const stop = () => { playing = false; v.pause(); $('#trimPlay span', d).textContent = 'Play selection'; };
  v.ontimeupdate = () => {
    pos.value = v.currentTime; $('#trimNow', d).textContent = r2(v.currentTime) + ' s';
    if (playing && v.currentTime >= t.b) { stop(); seek(t.b); }
  };
  pos.oninput = () => { stop(); seek(parseFloat(pos.value)); };
  $('#trimSetIn', d).onclick = () => { t.a = v.currentTime; if (t.b <= t.a + 0.1) t.b = dur; clamp(); show(); };
  $('#trimSetOut', d).onclick = () => { t.b = v.currentTime; if (t.b <= t.a + 0.1) t.a = 0; clamp(); show(); };
  $('#trimPlay', d).onclick = () => {
    if (playing) return stop();
    seek(t.a); playing = true; $('#trimPlay span', d).textContent = 'Stop';
    v.play().catch(() => { v.muted = true; v.play().catch(stop); });
  };
  $('#trimReset', d).onclick = () => { t.a = 0; t.b = dur; show(); };
  d.oninput = (e) => {
    if (e.target.id !== 'trimIn' && e.target.id !== 'trimOut') return;
    const x = parseFloat(e.target.value); if (!Number.isFinite(x)) return;
    if (e.target.id === 'trimIn') t.a = x; else t.b = x;
  };
  d.onchange = (e) => { if (e.target.id === 'trimIn' || e.target.id === 'trimOut') { clamp(); show(); seek(e.target.id === 'trimIn' ? t.a : t.b); } };

  return new Promise((resolve) => {
    const finish = (r) => { stop(); d.onclose = null; d.close(); v.removeAttribute('src'); v.load(); resolve(r); };
    $('#trimCancel', d).onclick = () => finish(null);
    d.onclose = () => finish(null);
    $('#trimApply', d).onclick = () => {
      clamp();
      finish({ trimIn: t.a > 0.005 ? r2(t.a) : null, trimOut: t.b < dur - 0.005 ? r2(t.b) : null });
    };
    show(); seek(t.a);
    d.showModal();
  });
}
