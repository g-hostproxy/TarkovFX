/* TarkovFX renderer */
'use strict';
const M = TFX.map;
const $ = (id) => document.getElementById(id);
const h = (tag, attrs, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v; else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
};

/* -------- API (falls back to a mock when opened in a plain browser for design work) -------- */
const api = window.tfx || mockApi();

const S = { builtins: [], presets: [], active: 'Operator', work: null, savedJson: '', bypass: false,
  settings: {}, status: null, applyTimer: null, lastApply: null, tab: 'eq', showRaw: { comp: false, lim: false } };

const all = () => S.builtins.concat(S.presets);
const findPreset = (n) => all().find((p) => p.name.toLowerCase() === String(n).toLowerCase());
const strip = (p) => { const c = TFX.clone(p); delete c.builtin; return JSON.stringify(c); };
const isDirty = () => S.work && strip(S.work) !== S.savedJson;
const fmtDb = (v) => (v <= -59.9 ? '−∞' : (v > 0 ? '+' : '') + v.toFixed(1)) + ' dB';

/* ---------------------------------------------------------------- boot */
(async function boot() {
  const r = await api.getStore();
  S.builtins = r.builtins.map((p) => Object.assign(TFX.clone(p), { builtin: true }));
  S.presets = r.store.presets.map((p) => Object.assign(TFX.validate(p), { builtin: false }));
  S.bypass = !!r.store.bypass;
  S.settings = r.store.settings;
  $('aboutTxt').textContent = 'TarkovFX v' + (r.version || '1.0.0') + '. Drives Equalizer APO with a graphic EQ, ReaComp and LoudMax. Not affiliated with Battlestate Games, Cockos or LoudMax.';
  wireStatic();
  buildBands(); buildCompCtls(); buildLimCtls();
  select(findPreset(r.store.active) ? r.store.active : 'Operator', { apply: false });
  await refreshStatus();
  if (S.status && S.status.apo.installed && S.status.hooked) apply(); // sync APO to the active preset
  if (S.status && setupProblems() > 0) showTab('setup');
  window.addEventListener('resize', () => { drawEq(); drawComp(); });
  api.onHotkey(onHotkey);
})();

/* ---------------------------------------------------------------- presets */
function select(name, opt) {
  const p = findPreset(name); if (!p) return;
  S.active = p.name;
  S.work = TFX.clone(p);
  S.savedJson = strip(p);
  renderAll();
  if (!opt || opt.apply !== false) apply();
  persist();
}
function persist() {
  api.setStore({ presets: S.presets.map((p) => { const c = TFX.clone(p); delete c.builtin; return c; }),
    active: S.active, bypass: S.bypass, settings: S.settings });
}
function uniqueName(base) {
  let n = base.trim() || 'Preset', i = 2; const b = n;
  while (findPreset(n)) n = b + ' ' + i++;
  return n;
}
async function saveAs(defaultName) {
  const name = await prompt('Save preset as', 'Give this setup a callsign.', uniqueName(defaultName || S.work.name + ' (custom)'));
  if (!name) return;
  if (findPreset(name)) return toast('A preset called "' + name + '" already exists.', 'bad');
  const p = Object.assign(TFX.clone(S.work), { name, builtin: false });
  S.presets.push(p); select(name, { apply: false }); toast('Saved "' + name + '"', 'ok');
}
async function savePreset() {
  const cur = findPreset(S.active);
  if (cur.builtin) return saveAs();
  const i = S.presets.indexOf(cur);
  S.presets[i] = Object.assign(TFX.clone(S.work), { name: cur.name, builtin: false });
  S.savedJson = strip(S.presets[i]); persist(); renderAll(); toast('Saved "' + cur.name + '"', 'ok');
}
async function renamePreset() {
  const cur = findPreset(S.active); if (cur.builtin) return toast('Factory presets can\'t be renamed. Use Save as.', 'bad');
  const name = await prompt('Rename preset', '', cur.name);
  if (!name || name === cur.name) return;
  if (findPreset(name) && findPreset(name) !== cur) return toast('That name is taken.', 'bad');
  cur.name = name; S.work.name = name; S.active = name; S.savedJson = strip(Object.assign(TFX.clone(S.work), { note: cur.note }));
  S.savedJson = strip(cur); persist(); renderAll();
}
async function deletePreset() {
  const cur = findPreset(S.active); if (cur.builtin) return toast('Factory presets can\'t be deleted.', 'bad');
  if (!(await confirmBox('Delete preset', 'Delete "' + cur.name + '"? This can\'t be undone.'))) return;
  S.presets = S.presets.filter((p) => p !== cur); select('Operator'); toast('Deleted "' + cur.name + '"');
}
async function importPresets() {
  const r = await api.importPresets(); if (!r.ok) return;
  let last = null;
  for (const p of r.presets) { p.name = uniqueName(p.name); p.builtin = false; S.presets.push(p); last = p.name; }
  if (last) select(last);
  toast('Imported ' + r.presets.length + ' preset' + (r.presets.length === 1 ? '' : 's') + (r.warnings.length ? ' (' + r.warnings.length + ' line(s) skipped)' : ''), r.presets.length ? 'ok' : 'bad');
}
async function exportPreset() {
  const r = await api.exportPreset(TFX.clone(S.work));
  if (r && r.ok) toast('Exported to ' + r.path, 'ok');
}

/* ---------------------------------------------------------------- apply */
function changed() {
  renderDirty(); renderChain(); renderPresetList();
  if (S.settings.liveApply) { clearTimeout(S.applyTimer); S.applyTimer = setTimeout(apply, 140); }
  else setStatusBar('warn', 'UNAPPLIED CHANGES', 'Press Apply to send them to Equalizer APO');
  if (S.tab === 'setup') renderPreview();
}
async function apply() {
  clearTimeout(S.applyTimer);
  const r = await api.apply(TFX.clone(S.work), S.bypass);
  if (r.ok) {
    S.lastApply = r.at;
    setStatusBar(S.bypass ? 'bad' : 'ok', S.bypass ? 'BYPASSED · all FX commented out' : 'LIVE · ' + S.work.name, r.path);
  } else {
    setStatusBar('bad', 'WRITE FAILED', r.error);
    if (!apply.warned) { toast(r.error, 'bad'); apply.warned = true; setTimeout(() => (apply.warned = false), 8000); }
  }
  if (S.tab === 'setup') renderPreview();
}
function toggleBypass() {
  S.bypass = !S.bypass; renderBypass(); apply(); persist();
  toast(S.bypass ? 'FX BYPASSED' : 'FX ACTIVE · ' + S.work.name, S.bypass ? 'bad' : 'ok');
}
function onHotkey(d) {
  const list = all(); const i = list.findIndex((p) => p.name === S.active);
  if (d.action === 'bypass') return toggleBypass();
  let target = null;
  if (d.action === 'next') target = list[(i + 1) % list.length];
  if (d.action === 'prev') target = list[(i - 1 + list.length) % list.length];
  if (d.action === 'slot') target = list[d.index];
  if (d.action === 'select') target = findPreset(d.name);
  if (!target) return;
  if (isDirty()) toast('Unsaved edits to "' + S.active + '" were dropped', 'bad');
  select(target.name); toast('PRESET · ' + target.name, 'ok');
}

/* ---------------------------------------------------------------- render */
function renderAll() {
  renderPresetList(); renderHero(); renderDirty(); renderBypass(); renderChain();
  syncBands(); drawEq(); syncComp(); drawComp(); syncLim();
  if (S.tab === 'setup') renderPreview();
}
function renderPresetList() {
  const box = $('presetList'); box.innerHTML = '';
  const list = all();
  const item = (p, idx) => h('div', { class: 'preset' + (p.name === S.active ? ' active' : ''), title: p.note || p.name, onclick: () => {
      if (p.name === S.active) return;
      if (isDirty()) confirmBox('Discard changes?', 'You have unsaved edits to "' + S.active + '".').then((ok) => ok && select(p.name));
      else select(p.name);
    } },
    h('span', { class: 'slot' }, idx < 9 ? String(idx + 1) : '·'),
    h('span', { class: 'pname' }, p.name + (p.name === S.active && isDirty() ? ' *' : '')),
    miniCurve(p.name === S.active ? S.work : p));
  box.append(h('div', { class: 'group-title' }, 'Factory'));
  S.builtins.forEach((p) => box.append(item(p, list.indexOf(p))));
  box.append(h('div', { class: 'group-title' }, 'Your presets'));
  if (!S.presets.length) box.append(h('div', { class: 'empty-user' }, 'None yet. Tweak a factory preset and hit Save as.'));
  S.presets.forEach((p) => box.append(item(p, list.indexOf(p))));
  $('presetCount').textContent = String(list.length).padStart(2, '0');
  const cur = findPreset(S.active);
  $('pRename').disabled = $('pDelete').disabled = !cur || cur.builtin;
}
function miniCurve(p) {
  const w = 46, hgt = 18, g = p.eq.bands.map((b) => b.g);
  const pts = g.map((v, i) => (i / (g.length - 1) * w).toFixed(1) + ',' + (hgt / 2 - v / 15 * (hgt / 2 - 1)).toFixed(1)).join(' ');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${hgt}`); svg.setAttribute('class', 'mini');
  svg.innerHTML = `<line x1="0" y1="${hgt / 2}" x2="${w}" y2="${hgt / 2}" stroke="#3b4031" stroke-width="1"/><polyline points="${pts}" fill="none" stroke="${p.eq.enabled ? '#cdb680' : '#64665a'}" stroke-width="1.4"/>`;
  return svg;
}
function renderHero() {
  const cur = findPreset(S.active), idx = all().indexOf(cur);
  $('heroName').textContent = S.work.name;
  $('heroKind').textContent = (cur.builtin ? 'FACTORY PRESET' : 'YOUR PRESET') + (idx < 9 ? '  ·  SLOT ' + (idx + 1) : '');
  $('heroNote').textContent = S.work.note || (cur.builtin ? '' : 'Custom preset.');
}
function renderDirty() {
  const d = isDirty(); $('modTag').hidden = !d; $('revertBtn').disabled = !d;
  $('pSave').disabled = !d && !findPreset(S.active).builtin ? true : false;
}
function renderBypass() {
  const b = $('bypassBtn'); b.classList.toggle('off', S.bypass);
  b.querySelector('.bp-text').textContent = S.bypass ? 'BYPASSED' : 'FX ACTIVE';
  b.querySelector('.bp-sub').textContent = S.bypass ? 'click to enable' : 'click to bypass';
}
function renderChain() {
  const w = S.work, st = S.status;
  for (const node of document.querySelectorAll('.chain .node[data-mod]')) {
    const m = node.dataset.mod, on = w[m].enabled;
    node.classList.toggle('on', on); node.classList.toggle('off', !on);
    const missing = (m === 'reacomp' || m === 'loudmax') && st && !st.plugins[m].found;
    node.classList.toggle('missing', !!missing);
    node.querySelector('.led').className = 'led ' + (S.bypass ? 'bad' : on ? (missing ? 'warn' : 'ok') : '');
    if (m === 'loudmax') node.querySelector('small').textContent = missing ? 'DLL missing' : 'limiter';
  }
  $('chPre').textContent = (w.preamp.db > 0 ? '+' : '') + w.preamp.db.toFixed(1) + ' dB';
  $('chComp').textContent = st && !st.plugins.reacomp.found ? 'DLL missing'
    : M.ampToDb(w.reacomp.params.Thresh).toFixed(0) + ' dB · ' + M.ratioFromNorm(w.reacomp.params.Ratio).toFixed(1) + ':1';
  const outLed = document.querySelector('.chain .node.out .led');
  outLed.className = 'led ' + (st && st.apo.installed && st.hooked ? 'ok' : 'warn');
}
function setStatusBar(kind, main, sub) {
  $('sbLed').className = 'led ' + kind; $('sbMain').textContent = main; $('sbPath').textContent = sub || '';
  $('sbTime').textContent = new Date().toLocaleTimeString();
  $('tbLed').className = 'led ' + kind;
  $('tbStatus').textContent = kind === 'ok' ? 'APO LINKED' : kind === 'bad' ? (S.bypass ? 'BYPASSED' : 'OFFLINE') : 'STANDBY';
}

/* ---------------------------------------------------------------- EQ */
const F_MIN = 20, F_MAX = 20000, G_RANGE = 15;
const ZONES = [[20, 160, 'Rumble / blasts'], [160, 630, 'Body / boom'], [630, 2500, 'Footsteps'], [2500, 6300, 'Gear / reloads'], [6300, 20000, 'Air']];
let eqDrag = null, eqHover = -1;

function buildBands() {
  const grid = $('bands');
  TFX.BANDS.forEach((f, i) => {
    const val = h('div', { class: 'bval', id: 'bv' + i }, '0');
    const r = h('input', { type: 'range', class: 'vrange', id: 'br' + i, min: TFX.EQ_MIN, max: TFX.EQ_MAX, step: 0.1 });
    r.addEventListener('input', () => setBand(i, +r.value));
    r.addEventListener('dblclick', () => setBand(i, 0));
    r.addEventListener('wheel', (e) => { e.preventDefault(); setBand(i, S.work.eq.bands[i].g + (e.deltaY < 0 ? 0.5 : -0.5)); }, { passive: false });
    grid.append(h('div', { class: 'band' }, val, r, h('div', { class: 'bfreq' }, f >= 1000 ? (f / 1000) + 'k' : String(f))));
  });
  const pr = $('preRange');
  pr.addEventListener('input', () => { S.work.preamp.db = +pr.value; S.work.preamp.enabled = true; syncBands(); drawEq(); changed(); });
  pr.addEventListener('dblclick', () => { S.work.preamp.db = 0; syncBands(); drawEq(); changed(); });

  const c = $('eqGraph');
  c.addEventListener('mousedown', (e) => { const i = nearestBand(e); if (i >= 0) { eqDrag = i; dragTo(e); } });
  window.addEventListener('mousemove', (e) => { if (eqDrag != null) dragTo(e); else if (e.target === c) { const i = nearestBand(e); if (i !== eqHover) { eqHover = i; drawEq(); } } });
  window.addEventListener('mouseup', () => { eqDrag = null; });
  c.addEventListener('mouseleave', () => { if (eqDrag == null) { eqHover = -1; drawEq(); } });
  c.addEventListener('dblclick', (e) => { const i = nearestBand(e); if (i >= 0) setBand(i, 0); });
  c.addEventListener('wheel', (e) => { const i = nearestBand(e); if (i < 0) return; e.preventDefault(); setBand(i, S.work.eq.bands[i].g + (e.deltaY < 0 ? 0.5 : -0.5)); }, { passive: false });
}
function eqGeom() {
  const c = $('eqGraph'), r = c.getBoundingClientRect();
  return { c, w: r.width, h: r.height, r, padL: 38, padR: 14, padT: 26, padB: 22 };
}
const fx = (g, f) => g.padL + (Math.log10(f) - Math.log10(F_MIN)) / (Math.log10(F_MAX) - Math.log10(F_MIN)) * (g.w - g.padL - g.padR);
const gy = (g, db) => g.padT + (1 - (db + G_RANGE) / (2 * G_RANGE)) * (g.h - g.padT - g.padB);
function nearestBand(e) {
  const g = eqGeom(), x = e.clientX - g.r.left; let best = -1, bd = 1e9;
  TFX.BANDS.forEach((f, i) => { const d = Math.abs(fx(g, f) - x); if (d < bd) { bd = d; best = i; } });
  return bd < 26 ? best : -1;
}
function dragTo(e) {
  const g = eqGeom(), y = e.clientY - g.r.top;
  let db = (1 - (y - g.padT) / (g.h - g.padT - g.padB)) * 2 * G_RANGE - G_RANGE;
  db = e.shiftKey ? Math.round(db * 10) / 10 : Math.round(db * 2) / 2;
  setBand(eqDrag, db);
}
function setBand(i, v) {
  v = Math.max(TFX.EQ_MIN, Math.min(TFX.EQ_MAX, Math.round(v * 10) / 10));
  if (S.work.eq.bands[i].g === v) return;
  S.work.eq.bands[i].g = v; syncBands(); drawEq(); changed();
}
function syncBands() {
  S.work.eq.bands.forEach((b, i) => {
    $('br' + i).value = b.g;
    const v = $('bv' + i); v.textContent = (b.g > 0 ? '+' : '') + b.g.toFixed(1);
    v.className = 'bval' + (b.g > 0 ? ' pos' : b.g < 0 ? ' neg' : '');
  });
  const p = S.work.preamp; $('preRange').value = p.db; $('preVal').textContent = (p.db > 0 ? '+' : '') + p.db.toFixed(1);
  $('preampBand').classList.toggle('off', !p.enabled);
  $('preampBand').title = p.enabled ? 'Preamp (on)' : 'Preamp is off. Move the slider or click PREAMP in the chain to enable.';
  const peak = Math.max(...S.work.eq.bands.map((b) => b.g)) * (S.work.eq.enabled ? 1 : 0) + (p.enabled ? p.db : 0);
  $('clipWarn').hidden = peak <= 0.05 || (S.work.loudmax.enabled && !S.bypass);
  $('clipDb').textContent = peak.toFixed(1);
}
function drawEq() {
  const g = eqGeom(); if (!g.w) return;
  const dpr = window.devicePixelRatio || 1, c = g.c, x = c.getContext('2d');
  c.width = g.w * dpr; c.height = g.h * dpr; x.setTransform(dpr, 0, 0, dpr, 0, 0);
  x.clearRect(0, 0, g.w, g.h);
  // zones
  x.font = '600 10.5px "Barlow Condensed", sans-serif'; x.textBaseline = 'middle';
  ZONES.forEach(([a, b, name], i) => {
    const x1 = fx(g, a), x2 = fx(g, b);
    x.fillStyle = i % 2 ? 'rgba(255,255,255,.012)' : 'rgba(0,0,0,0)'; x.fillRect(x1, g.padT, x2 - x1, g.h - g.padT - g.padB);
    x.fillStyle = name === 'Footsteps' ? 'rgba(205,182,128,.9)' : 'rgba(154,151,127,.6)';
    x.textAlign = 'center'; x.fillText(name.toUpperCase().split('').join('\u200A'), (x1 + x2) / 2, 12);
    x.fillStyle = 'rgba(205,182,128,.35)'; x.fillRect(x1 + 2, 20, x2 - x1 - 4, 1);
  });
  // grid
  x.strokeStyle = '#1d2018'; x.lineWidth = 1; x.fillStyle = '#5c5e52'; x.font = '10px Consolas, monospace';
  for (let db = -G_RANGE; db <= G_RANGE; db += 3) {
    const y = Math.round(gy(g, db)) + .5; x.strokeStyle = db === 0 ? '#3b4031' : '#1b1e17';
    x.beginPath(); x.moveTo(g.padL, y); x.lineTo(g.w - g.padR, y); x.stroke();
    if (db % 6 === 0) { x.textAlign = 'right'; x.fillText((db > 0 ? '+' : '') + db, g.padL - 6, y); }
  }
  for (const f of [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]) {
    const X = Math.round(fx(g, f)) + .5; x.strokeStyle = '#1b1e17';
    x.beginPath(); x.moveTo(X, g.padT); x.lineTo(X, g.h - g.padB); x.stroke();
    x.textAlign = 'center'; x.fillText(f >= 1000 ? f / 1000 + 'k' : f, X, g.h - 10);
  }
  const pts = S.work.eq.bands.map((b) => [b.f, b.g]);
  const on = S.work.eq.enabled && !S.bypass;
  const curve = (off) => { x.beginPath(); for (let X = g.padL; X <= g.w - g.padR; X += 1) {
    const f = Math.pow(10, Math.log10(F_MIN) + (X - g.padL) / (g.w - g.padL - g.padR) * (Math.log10(F_MAX) - Math.log10(F_MIN)));
    const y = gy(g, Math.max(-G_RANGE, Math.min(G_RANGE, TFX.interpLog(pts, f) + off))); X === g.padL ? x.moveTo(X, y) : x.lineTo(X, y);
  } };
  // fill
  curve(0); x.lineTo(g.w - g.padR, gy(g, 0)); x.lineTo(g.padL, gy(g, 0)); x.closePath();
  const grad = x.createLinearGradient(0, g.padT, 0, g.h - g.padB);
  grad.addColorStop(0, on ? 'rgba(205,182,128,.28)' : 'rgba(100,102,90,.15)'); grad.addColorStop(.5, 'rgba(205,182,128,.02)'); grad.addColorStop(1, on ? 'rgba(159,183,201,.22)' : 'rgba(100,102,90,.12)');
  x.fillStyle = grad; x.fill();
  // preamp total (dashed)
  if (S.work.preamp.enabled && S.work.preamp.db !== 0) { x.setLineDash([4, 4]); x.strokeStyle = 'rgba(224,163,63,.55)'; x.lineWidth = 1.2; curve(S.work.preamp.db); x.stroke(); x.setLineDash([]); }
  // line
  x.shadowColor = 'rgba(205,182,128,.6)'; x.shadowBlur = on ? 8 : 0;
  x.strokeStyle = on ? '#d8c28c' : '#6c6e60'; x.lineWidth = 2; curve(0); x.stroke(); x.shadowBlur = 0;
  // nodes
  S.work.eq.bands.forEach((b, i) => {
    const X = fx(g, b.f), Y = gy(g, b.g), act = i === eqHover || i === eqDrag;
    x.beginPath(); x.arc(X, Y, act ? 6.5 : 4.5, 0, Math.PI * 2);
    x.fillStyle = act ? '#f3e2b5' : '#0b0c09'; x.fill(); x.lineWidth = 1.6; x.strokeStyle = on ? '#d8c28c' : '#6c6e60'; x.stroke();
    if (act) { x.fillStyle = '#f3e2b5'; x.font = '11px Consolas, monospace'; x.textAlign = 'center';
      x.fillText((b.f >= 1000 ? b.f / 1000 + 'k' : b.f) + 'Hz  ' + (b.g > 0 ? '+' : '') + b.g.toFixed(1) + 'dB', X, Y + (b.g > 9 ? 18 : -15)); }
  });
}

/* ---------------------------------------------------------------- compressor */
const COMP = [
  { key: 'Thresh', name: 'Threshold', min: -60, max: 0, step: 0.5, get: M.ampToDb, set: M.dbToAmp, show: (v) => v.toFixed(1) + ' dB',
    desc: 'Where compression kicks in. Lower = more of the quiet stuff gets lifted.' },
  { key: 'Ratio', name: 'Ratio', min: 1, max: 20, step: 0.1, get: M.ratioFromNorm, set: M.ratioToNorm, show: (v) => v.toFixed(1) + ' : 1',
    desc: 'How hard loud sounds get squashed above the threshold.' },
  { key: 'Attack', name: 'Attack', min: 0, max: 200, step: 0.5, get: M.attackFromNorm, set: M.attackToNorm, show: (v) => v.toFixed(1) + ' ms',
    desc: 'How fast it grabs a sound. 0 catches gunshot transients.' },
  { key: 'Release', name: 'Release', min: 0, max: 1000, step: 1, get: M.releaseFromNorm, set: M.releaseToNorm, show: (v) => v.toFixed(0) + ' ms',
    desc: 'How fast it lets go. Short release brings steps back quickly after shots.' },
  { key: 'Knee', name: 'Knee', min: 0, max: 24, step: 0.5, get: M.kneeFromNorm, set: M.kneeToNorm, show: (v) => v.toFixed(1) + ' dB',
    desc: 'Softens the transition into compression.' },
  { key: 'RMS size', name: 'RMS window', min: 0, max: 250, step: 0.5, get: M.rmsFromNorm, set: M.rmsToNorm, show: (v) => v.toFixed(1) + ' ms',
    desc: 'Detector averaging. 0 = peak detection.' },
  { key: 'Wet', name: 'Wet level', min: -40, max: 0, step: 0.5, get: M.ampToDb, set: (v) => M.dbToAmp(v <= -39.9 ? -150 : v), show: (v) => fmtDb(v <= -39.9 ? -60 : v),
    desc: 'Volume of the compressed signal.' },
  { key: 'Dry', name: 'Dry (parallel)', min: -60, max: 0, step: 0.5, get: M.ampToDb, set: (v) => M.dbToAmp(v <= -59.9 ? -150 : v), show: fmtDb,
    desc: 'Blend in the uncompressed signal. Off by default.' },
];
const COMP_TOG = [['AutoMkUp', 'Auto make-up'], ['AutoRel', 'Auto release'], ['ClsAttk', 'Classic attack'], ['AntiAls', 'Anti-alias']];
const LIM = [
  { key: 'Thresh', name: 'Threshold', min: 0, max: 100, step: 0.5, get: (x) => x * 100, set: (v) => v / 100, show: (v) => v.toFixed(1) + ' %',
    desc: 'LoudMax threshold slider. Changes how much the limiter drives into the ceiling.' },
  { key: 'Output', name: 'Output ceiling', min: 0, max: 100, step: 0.5, get: (x) => x * 100, set: (v) => v / 100, show: (v) => v.toFixed(1) + ' %',
    desc: 'Final output level. Nothing gets louder than this.' },
];
const LIM_TOG = [['Fader Link', 'Fader link'], ['ISP Detection', 'ISP detection']];

function ctlRow(def, mod) {
  const val = h('span', { class: 'ctl-val' });
  const r = h('input', { type: 'range', class: 'hrange', min: def.min, max: def.max, step: def.step });
  r.addEventListener('input', () => { S.work[mod].params[def.key] = def.set(+r.value); paint(); afterCtl(mod); });
  r.addEventListener('wheel', (e) => { e.preventDefault(); r.value = +r.value + (e.deltaY < 0 ? 1 : -1) * def.step * (def.max - def.min > 100 ? 10 : 2); r.dispatchEvent(new Event('input')); }, { passive: false });
  function paint() {
    const v = def.get(S.work[mod].params[def.key] ?? 0);
    r.value = Math.max(def.min, Math.min(def.max, v));
    r.style.setProperty('--p', ((r.value - def.min) / (def.max - def.min) * 100) + '%');
    val.textContent = def.show(v);
  }
  def.paint = paint;
  return h('div', { class: 'ctl' }, h('div', { class: 'ctl-top' }, h('span', { class: 'ctl-name' }, def.name), val), r, h('div', { class: 'ctl-desc' }, def.desc));
}
function togRow(key, label, mod) {
  const inp = h('input', { type: 'checkbox' });
  inp.addEventListener('change', () => { S.work[mod].params[key] = inp.checked ? 1 : 0; afterCtl(mod); });
  const row = h('label', { class: 'switch-row' }, h('span', {}, label), inp, h('i', { class: 'sw' }));
  row.sync = () => { inp.checked = (S.work[mod].params[key] || 0) >= 0.5; };
  return row;
}
function afterCtl(mod) { if (mod === 'reacomp') drawComp(); else paintMeters(); renderRaw(mod); changed(); }
let compTogs = [], limTogs = [];
function buildCompCtls() {
  COMP.forEach((d) => $('compCtls').append(ctlRow(d, 'reacomp')));
  compTogs = COMP_TOG.map(([k, l]) => togRow(k, l, 'reacomp')); $('compToggles').append(...compTogs);
}
function buildLimCtls() {
  LIM.forEach((d) => $('limCtls').append(ctlRow(d, 'loudmax')));
  limTogs = LIM_TOG.map(([k, l]) => togRow(k, l, 'loudmax')); $('limToggles').append(...limTogs);
  const mk = (id, label) => h('div', { class: 'meter' }, h('b', { id: id + 'V' }), h('div', { class: 'bar' }, h('div', { class: 'fill' + (id === 'mThr' ? ' red' : ''), id })), h('span', {}, label));
  $('limMeters').append(mk('mThr', 'Threshold'), mk('mOut', 'Output'));
}
function syncComp() { COMP.forEach((d) => d.paint()); compTogs.forEach((t) => t.sync()); renderRaw('reacomp'); }
function syncLim() { LIM.forEach((d) => d.paint()); limTogs.forEach((t) => t.sync()); paintMeters(); renderRaw('loudmax'); }
function paintMeters() {
  const p = S.work.loudmax.params;
  $('mThr').style.height = 'calc(' + (p.Thresh * 100) + '% - 4px)'; $('mThrV').textContent = (p.Thresh * 100).toFixed(0) + '%';
  $('mOut').style.height = 'calc(' + (p.Output * 100) + '% - 4px)'; $('mOutV').textContent = (p.Output * 100).toFixed(0) + '%';
}
function renderRaw(mod) {
  const which = mod === 'reacomp' ? 'comp' : 'lim', box = $(which + 'Raw');
  box.hidden = !S.showRaw[which]; $(which + 'RawBtn').classList.toggle('on', S.showRaw[which]);
  if (box.hidden || box.contains(document.activeElement)) return;
  box.innerHTML = '';
  for (const [k, v] of Object.entries(S.work[mod].params)) {
    const inp = h('input', { value: TFX.fmt(v), spellcheck: 'false' });
    inp.addEventListener('change', () => { const n = parseFloat(inp.value); if (isFinite(n)) { S.work[mod].params[k] = n; mod === 'reacomp' ? syncComp() : syncLim(); drawComp(); changed(); } });
    box.append(h('label', {}, k, inp));
  }
  box.append(h('label', {}, 'Library', h('input', { value: S.work[mod].library, readonly: true, title: S.work[mod].library })));
}
function drawComp() {
  const c = $('compGraph'), r = c.getBoundingClientRect(); if (!r.width) return;
  const dpr = window.devicePixelRatio || 1, x = c.getContext('2d');
  c.width = r.width * dpr; c.height = r.height * dpr; x.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = r.width, H = r.height, pad = 14, lo = -60;
  const X = (db) => pad + (db - lo) / -lo * (W - 2 * pad), Y = (db) => H - pad - (db - lo) / -lo * (H - 2 * pad);
  x.clearRect(0, 0, W, H);
  x.strokeStyle = '#1b1e17'; x.lineWidth = 1;
  for (let d = lo; d <= 0; d += 10) { x.beginPath(); x.moveTo(X(d), Y(lo)); x.lineTo(X(d), Y(0)); x.moveTo(X(lo), Y(d)); x.lineTo(X(0), Y(d)); x.stroke(); }
  x.setLineDash([3, 4]); x.strokeStyle = '#3b4031'; x.beginPath(); x.moveTo(X(lo), Y(lo)); x.lineTo(X(0), Y(0)); x.stroke(); x.setLineDash([]);
  const p = S.work.reacomp.params, T = M.ampToDb(p.Thresh), R = M.ratioFromNorm(p.Ratio), K = M.kneeFromNorm(p.Knee);
  const out = (i) => { if (2 * (i - T) < -K) return i; if (2 * Math.abs(i - T) <= K && K > 0) return i + (1 / R - 1) * Math.pow(i - T + K / 2, 2) / (2 * K); return T + (i - T) / R; };
  // threshold marker
  x.strokeStyle = 'rgba(207,90,65,.55)'; x.beginPath(); x.moveTo(X(T), Y(lo)); x.lineTo(X(T), Y(0)); x.stroke();
  x.fillStyle = 'rgba(207,90,65,.9)'; x.font = '10px Consolas, monospace'; x.textAlign = 'left'; x.fillText('THR ' + T.toFixed(1), X(T) + 4, Y(lo) - 6);
  const on = S.work.reacomp.enabled && !S.bypass;
  x.shadowColor = 'rgba(205,182,128,.6)'; x.shadowBlur = on ? 8 : 0; x.strokeStyle = on ? '#d8c28c' : '#6c6e60'; x.lineWidth = 2;
  x.beginPath(); for (let i = lo; i <= 0; i += 0.25) { const yy = Y(Math.max(lo, out(i))); i === lo ? x.moveTo(X(i), yy) : x.lineTo(X(i), yy); } x.stroke(); x.shadowBlur = 0;
  x.fillStyle = '#9a977f'; x.textAlign = 'right'; x.fillText(R.toFixed(1) + ':1', W - pad, pad + 4);
}

/* ---------------------------------------------------------------- setup */
function setupProblems() {
  const s = S.status; if (!s) return 0;
  return [s.apo.installed, s.writable, s.hooked, s.plugins.reacomp.found, s.plugins.loudmax.found].filter((v) => !v).length;
}
async function refreshStatus() {
  S.status = await api.status();
  $('setupDot').hidden = setupProblems() === 0;
  renderChain(); renderChecks();
  const s = S.status;
  if (!s.apo.installed) setStatusBar('bad', 'EQUALIZER APO NOT FOUND', 'See the Setup tab');
  else if (!s.hooked) setStatusBar('warn', 'NOT HOOKED', 'TarkovFX isn\'t included in config.txt yet. See Setup.');
}
function renderChecks() {
  const s = S.status, box = $('checks'); box.innerHTML = '';
  const btn = (label, fn, cls) => h('button', { class: 'btn sm ' + (cls || ''), onclick: fn }, label);
  const items = [];
  if (s.platform && s.platform !== 'win32') items.push({ st: 'warn', t: 'Windows required', d: 'Equalizer APO only runs on Windows. This preview runs in demo mode.' });
  items.push(s.apo.installed
    ? { st: 'ok', t: 'Equalizer APO installed', d: h('span', {}, 'Found at ', h('code', {}, s.apo.install)),
        a: [s.editor && btn('Open APO Editor', () => api.openPath(s.editor), 'ghost')] }
    : { st: 'bad', t: 'Install Equalizer APO', d: 'Run the Equalizer APO installer (EqualizerAPO-x64-1.4.2.exe). In the Configurator that opens at the end, tick your headset, then reboot.',
        a: [btn('Download page', () => api.openUrl('https://sourceforge.net/projects/equalizerapo/files/')), btn('Re-scan', refreshStatus)] });
  items.push({ st: s.apo.installed ? 'info' : 'off', t: 'Headset selected in APO', d: 'TarkovFX can\'t check this from here. Make sure your headset is ticked in Equalizer APO\'s Device Selector. Reboot after changing it.',
    a: [s.deviceSelector && btn('Open Device Selector', () => api.openPath(s.deviceSelector))] });
  if (s.apo.installed) {
    items.push(s.writable
      ? { st: 'ok', t: 'Config folder writable', d: h('span', {}, 'TarkovFX can write to ', h('code', {}, s.apo.config)) }
      : { st: 'bad', t: 'Config folder is read-only', d: 'Windows is blocking writes to the APO config folder. Fix it once with an admin prompt.',
          a: [btn('Fix permissions', async () => { const r = await api.fixPermissions(); toast(r.ok ? 'Permissions fixed' : 'Still no access. Try running TarkovFX as admin once.', r.ok ? 'ok' : 'bad'); refreshStatus(); }, 'primary')] });
    items.push(s.hooked
      ? { st: s.legacyLines ? 'warn' : 'ok', t: 'Hooked into config.txt', d: s.legacyLines
          ? 'config.txt still has its own EQ/VST lines as well as the TarkovFX include, so audio gets processed twice. Replace mode fixes that (your original is backed up).'
          : h('span', {}, 'config.txt includes ', h('code', {}, 'TarkovFX.txt'), '. Changes go live immediately.'),
          a: [s.legacyLines && btn('Switch to replace mode', async () => { await api.unhook(); const r = await api.hook('replace'); hookDone(r); })] }
      : { st: 'bad', t: 'Hook TarkovFX into Equalizer APO', d: 'Adds an Include line to config.txt. Replace backs up your current config.txt and hands control to TarkovFX (recommended, since your old config does the same job). Append keeps what\'s there.',
          a: [btn('Hook (replace)', async () => hookDone(await api.hook('replace')), 'primary'), btn('Append', async () => hookDone(await api.hook('append')))] });
  }
  const plug = (k, title, fname, url, urlLabel, extra) => {
    const p = s.plugins[k];
    items.push(p.found
      ? { st: 'ok', t: title + ' found', d: h('span', {}, h('code', {}, p.path)), a: [btn('Change', () => locate(k), 'ghost')] }
      : { st: 'bad', t: title + ' missing', d: h('span', {}, 'Needs ', h('code', {}, fname), '. ' + extra), a: [btn('Locate DLL…', () => locate(k), 'primary'), btn(urlLabel, () => api.openUrl(url))] });
  };
  plug('reacomp', 'ReaComp', 'reacomp-standalone.dll', 'https://www.reaper.fm/reaplugs/', 'Get ReaPlugs',
    'Install ReaPlugs VST (x64). It usually ends up in C:\\Program Files\\VstPlugins\\ReaPlugs. Use the -standalone dll, not reacomp.dll.');
  plug('loudmax', 'LoudMax', 'LoudMax64.dll', 'https://loudmax.blogspot.com/', 'Get LoudMax',
    'Download the Windows VST version (LoudMax64.dll), not the LADSPA version.');
  items.forEach((it, i) => box.append(h('div', { class: 'check ' + it.st },
    h('div', { class: 'num' }, it.st === 'ok' ? '✓' : it.st === 'bad' ? '!' : String(i + 1).padStart(2, '0')),
    h('div', {}, h('h3', {}, it.t), h('p', {}, it.d)),
    h('div', { class: 'acts' }, ...(it.a || []).filter(Boolean)))));
  $('outPath').textContent = s.outFile || '';
  renderPreview();
}
async function hookDone(r) { toast(r.ok ? 'TarkovFX is now driving Equalizer APO' : r.error, r.ok ? 'ok' : 'bad'); await refreshStatus(); if (r.ok) apply(); }
async function locate(k) {
  const r = await api.locatePlugin(k); if (!r.ok) return;
  if (r.warn) toast(r.warn, 'bad'); else toast('Using ' + r.path, 'ok');
  await refreshStatus(); apply();
}
async function renderPreview() {
  const t = await api.preview(TFX.clone(S.work), S.bypass);
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  $('cfgPreview').innerHTML = t.trim().split(/\r?\n/).map((l) => l.startsWith('#') ? '<span class="c">' + esc(l) + '</span>'
    : esc(l).replace(/^(\w+:)/, '<span class="k">$1</span>')).join('\n');
}

/* ---------------------------------------------------------------- tabs / static wiring */
function showTab(t) {
  S.tab = t;
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
  document.querySelectorAll('.tabpane').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + t));
  if (t === 'eq') drawEq(); if (t === 'comp') drawComp(); if (t === 'setup') refreshStatus();
}
function wireStatic() {
  $('wMin').onclick = api.minimize; $('wMax').onclick = api.maximize; $('wClose').onclick = api.close;
  document.querySelectorAll('.tab').forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
  document.querySelectorAll('.chain .node[data-mod]').forEach((n) => {
    n.onclick = () => showTab(n.dataset.tab);
    n.querySelector('.pwr').onclick = (e) => { e.stopPropagation(); const m = S.work[n.dataset.mod]; m.enabled = !m.enabled; syncBands(); drawEq(); drawComp(); changed(); };
  });
  $('bypassBtn').onclick = toggleBypass;
  $('applyBtn').onclick = () => { apply(); toast('Sent to Equalizer APO', 'ok'); };
  $('revertBtn').onclick = () => select(S.active);
  $('pSave').onclick = savePreset; $('pSaveAs').onclick = () => saveAs(); $('pRename').onclick = renamePreset;
  $('pDup').onclick = () => saveAs(S.work.name + ' copy'); $('pDelete').onclick = deletePreset;
  $('pImport').onclick = importPresets; $('pExport').onclick = exportPreset;
  $('eqFlat').onclick = () => { S.work.eq.bands.forEach((b) => (b.g = 0)); syncBands(); drawEq(); changed(); };
  $('eqMinus').onclick = () => { S.work.eq.bands.forEach((b) => (b.g = Math.max(TFX.EQ_MIN, b.g - 1))); syncBands(); drawEq(); changed(); };
  $('eqPlus').onclick = () => { S.work.eq.bands.forEach((b) => (b.g = Math.min(TFX.EQ_MAX, b.g + 1))); syncBands(); drawEq(); changed(); };
  const op = TFX.BUILTINS[0];
  $('compReset').onclick = () => { S.work.reacomp.params = TFX.clone(op.reacomp.params); syncComp(); drawComp(); changed(); };
  $('limReset').onclick = () => { S.work.loudmax.params = TFX.clone(op.loudmax.params); syncLim(); changed(); };
  $('compRawBtn').onclick = () => { S.showRaw.comp = !S.showRaw.comp; renderRaw('reacomp'); };
  $('limRawBtn').onclick = () => { S.showRaw.lim = !S.showRaw.lim; renderRaw('loudmax'); };
  $('recheck').onclick = async () => { await refreshStatus(); toast('Re-scanned', 'ok'); };
  // settings
  const bind = (id, key, after) => { const el = $(id); el.checked = !!S.settings[key]; el.onchange = () => { S.settings[key] = el.checked; persist(); after && after(); syncLive(); }; };
  const syncLive = () => { $('liveApply').checked = $('sLive').checked = !!S.settings.liveApply; };
  bind('sLive', 'liveApply'); bind('sTray', 'closeToTray'); bind('sMin', 'startMinimized');
  $('sSlots').checked = !!S.settings.hotkeys.slots;
  $('sSlots').onchange = async () => { S.settings.hotkeys.slots = $('sSlots').checked; persist(); await hotkeysApply(); };
  $('liveApply').checked = !!S.settings.liveApply;
  $('liveApply').onchange = () => { S.settings.liveApply = $('liveApply').checked; syncLive(); persist(); if (S.settings.liveApply) apply(); };
  document.querySelectorAll('.hk-input').forEach((inp) => {
    const k = inp.dataset.hk; inp.value = pretty(S.settings.hotkeys[k]);
    inp.addEventListener('keydown', async (e) => {
      e.preventDefault();
      if (e.key === 'Backspace' || e.key === 'Delete') { S.settings.hotkeys[k] = ''; inp.value = '—'; persist(); return hotkeysApply(); }
      const acc = accel(e); if (!acc) return;
      S.settings.hotkeys[k] = acc; inp.value = pretty(acc); inp.blur(); persist(); await hotkeysApply();
    });
  });
  renderHkHints();
  $('openCfgFolder').onclick = () => S.status && api.openPath(S.status.apo.config);
  $('unhookBtn').onclick = async () => {
    if (!(await confirmBox('Unhook TarkovFX', 'Restore your original config.txt? TarkovFX will stop controlling Equalizer APO until you hook it again.'))) return;
    const r = await api.unhook(); toast(r.ok ? 'Original config restored' : r.error, r.ok ? 'ok' : 'bad'); refreshStatus();
  };
  $('quitBtn').onclick = api.quit;
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' && (e.target.type === 'text' || e.target.classList.contains('hk-input') || !e.target.type)) return;
    if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); e.shiftKey ? saveAs() : savePreset(); }
  });
}
function accel(e) {
  const mods = []; if (e.ctrlKey) mods.push('Control'); if (e.altKey) mods.push('Alt'); if (e.shiftKey) mods.push('Shift'); if (e.metaKey) mods.push('Super');
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return null;
  let key = e.code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad(\d)$/, 'num$1');
  const named = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: '\'', Comma: ',', Period: '.', Slash: '/', Backslash: '\\' };
  key = named[key] || key;
  if (!mods.length && !/^F\d+$/.test(key)) { $('hkMsg').textContent = 'Use at least one modifier (Ctrl / Alt / Shift), or an F-key.'; return null; }
  $('hkMsg').textContent = '';
  return mods.concat(key).join('+');
}
const pretty = (a) => (a ? a.replace(/Control/g, 'Ctrl').replace(/\+/g, ' + ') : '—');
async function hotkeysApply() {
  const failed = await api.applyHotkeys();
  $('hkMsg').textContent = failed && failed.length ? 'Already in use by another app: ' + failed.map(pretty).join(', ') : '';
  renderHkHints();
}
function renderHkHints() {
  const kb = (a) => (a ? a.split('+').map((k) => h('kbd', {}, k === 'Control' ? 'Ctrl' : k)) : [h('kbd', {}, '—')]);
  const hk = S.settings.hotkeys;
  $('hkBypassRow').replaceChildren(...kb(hk.bypass), h('span', {}, 'Bypass'));
  $('hkNextRow').replaceChildren(...kb(hk.next), h('span', {}, 'Next preset'));
}

/* ---------------------------------------------------------------- modal / toast */
function modal(title, text, input) {
  return new Promise((res) => {
    $('mTitle').textContent = title; $('mText').textContent = text; $('mText').hidden = !text;
    const inp = $('mInput'); inp.hidden = input == null; inp.value = input || '';
    $('modal').hidden = false; (input != null ? inp : $('mOk')).focus(); if (input != null) inp.select();
    const done = (v) => { $('modal').hidden = true; $('mOk').onclick = $('mCancel').onclick = inp.onkeydown = null; res(v); };
    $('mOk').onclick = () => done(input != null ? inp.value.trim() : true);
    $('mCancel').onclick = () => done(input != null ? null : false);
    inp.onkeydown = (e) => { if (e.key === 'Enter') $('mOk').click(); if (e.key === 'Escape') $('mCancel').click(); };
  });
}
const prompt = (t, x, v) => modal(t, x, v);
const confirmBox = (t, x) => modal(t, x);
function toast(msg, kind) {
  const t = h('div', { class: 'toast ' + (kind || '') }, msg); $('toasts').append(t);
  setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3200);
}

/* ---------------------------------------------------------------- mock (browser preview only) */
function mockApi() {
  let store = { presets: [], active: 'Operator', bypass: false, plugins: {},
    settings: { liveApply: true, closeToTray: true, startMinimized: false, hotkeys: { bypass: 'Control+Alt+B', next: 'Control+Alt+N', prev: 'Control+Alt+P', slots: true } } };
  const st = { platform: 'win32', apo: { installed: true, install: 'C:\\Program Files\\EqualizerAPO', config: 'C:\\Program Files\\EqualizerAPO\\config' },
    writable: true, hooked: true, legacyLines: false, deviceSelector: 'x', editor: 'x', outFile: 'C:\\Program Files\\EqualizerAPO\\config\\TarkovFX.txt',
    plugins: { reacomp: { found: true, path: 'C:\\Program Files\\VstPlugins\\ReaPlugs\\reacomp-standalone.dll' }, loudmax: { found: false, path: null } } };
  const libs = { reacomp: st.plugins.reacomp.path };
  const noop = async () => ({ ok: true });
  return { getStore: async () => ({ store, builtins: TFX.BUILTINS, version: '1.0.0' }), setStore: async (p) => { Object.assign(store, p); },
    applyHotkeys: async () => [], status: async () => st,
    apply: async () => ({ ok: true, path: st.outFile, at: Date.now() }),
    preview: async (p, b) => TFX.toApoConfig(p, { bypass: b, libraries: libs }),
    fixPermissions: noop, hook: noop, unhook: noop, locatePlugin: async () => ({ ok: false }), clearPlugin: noop,
    exportPreset: async () => ({ ok: false }), importPresets: async () => ({ ok: false, presets: [], warnings: [] }),
    openUrl: noop, openPath: noop, showItem: noop, minimize: noop, maximize: noop, close: noop, quit: noop, onHotkey: () => {} };
}
