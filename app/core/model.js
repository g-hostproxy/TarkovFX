/* TarkovFX core model: presets <-> Equalizer APO config text.
   Works in Node (main process / tests) and the browser (renderer). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TFX = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BANDS = [25, 40, 63, 100, 160, 250, 400, 630, 1000, 1600, 2500, 4000, 6300, 10000, 16000];
  const EQ_MIN = -15, EQ_MAX = 15;

  // Parameter order matches what Equalizer APO's editor writes for these plugins.
  const REACOMP_KEYS = ['Hipass', 'Thresh', 'Attack', 'Ratio', 'Release', 'Pre-comp', 'resvd', 'Lowpass',
    'SignIn', 'AudIn', 'Dry', 'Wet', 'AutoMkUp', 'PreviewF', 'RMS size', 'Knee', 'AutoRel', 'ClsAttk', 'AntiAls'];
  const LOUDMAX_KEYS = ['Thresh', 'Output', 'Fader Link', 'ISP Detection', 'Large GUI'];

  /* ---------- value mapping (normalized VST values <-> friendly units) ----------
     ReaComp exposes normalized 0..1 parameters. Threshold / Wet / Dry are linear
     amplitude (1.0 = 0 dB). Knee is 0..24 dB. Ratio is (r-1)/99. Time params are
     shown in ms using ReaComp's ranges. The exact raw value is always what's written. */
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const map = {
    ampToDb: (x) => (x <= 1e-7 ? -150 : 20 * Math.log10(x)),
    dbToAmp: (db) => (db <= -149 ? 3.16228e-8 : Math.pow(10, db / 20)),
    ratioFromNorm: (x) => 1 + x * 99,
    ratioToNorm: (r) => clamp((r - 1) / 99, 0, 1),
    kneeFromNorm: (x) => x * 24,
    kneeToNorm: (db) => clamp(db / 24, 0, 1),
    attackFromNorm: (x) => x * 500,
    attackToNorm: (ms) => clamp(ms / 500, 0, 1),
    releaseFromNorm: (x) => x * 5000,
    releaseToNorm: (ms) => clamp(ms / 5000, 0, 1),
    rmsFromNorm: (x) => x * 1000,
    rmsToNorm: (ms) => clamp(ms / 1000, 0, 1),
  };

  function fmt(n) {
    if (!isFinite(n)) return '0';
    if (n === 0) return '0';
    return String(Number(n.toPrecision(6)));
  }
  function fmtGain(g) { return String(Math.round(g * 10) / 10); }

  function quoteIfNeeded(s) { return /\s/.test(s) ? '"' + s + '"' : s; }

  function tokenize(s) {
    const out = []; let i = 0;
    while (i < s.length) {
      while (i < s.length && /\s/.test(s[i])) i++;
      if (i >= s.length) break;
      if (s[i] === '"') {
        const j = s.indexOf('"', i + 1);
        const end = j < 0 ? s.length : j;
        out.push(s.slice(i + 1, end)); i = end + 1;
      } else {
        let j = i; while (j < s.length && !/\s/.test(s[j])) j++;
        out.push(s.slice(i, j)); i = j;
      }
    }
    return out;
  }

  /* ---------- defaults ---------- */
  const OPERATOR_REACOMP = {
    Hipass: 0, Thresh: 0.0354813, Attack: 0, Ratio: 0.010101, Release: 0.005, 'Pre-comp': 0, resvd: 0,
    Lowpass: 1, SignIn: 0, AudIn: 0, Dry: 3.16228e-08, Wet: 1, AutoMkUp: 0, PreviewF: 0, 'RMS size': 0.005,
    Knee: 0.104167, AutoRel: 0, ClsAttk: 1, AntiAls: 0,
  };
  const OPERATOR_LOUDMAX = { Thresh: 0.302273, Output: 0.965909, 'Fader Link': 0, 'ISP Detection': 0, 'Large GUI': 0 };

  function eqFrom(gains) { return BANDS.map((f, i) => ({ f, g: gains[i] })); }

  function makePreset(name, o) {
    o = o || {};
    return {
      name,
      builtin: !!o.builtin,
      note: o.note || '',
      locked: !!o.locked,
      preamp: Object.assign({ enabled: false, db: 4.9 }, o.preamp),
      makeup: Object.assign({ enabled: false, db: 0 }, o.makeup),
      eq: { enabled: o.eqEnabled !== false, bands: eqFrom(o.gains || BANDS.map(() => 0)) },
      reacomp: { enabled: o.compEnabled !== false, library: 'reacomp-standalone.dll',
        params: Object.assign({}, OPERATOR_REACOMP, o.comp || {}) },
      loudmax: { enabled: o.lmEnabled !== false, library: 'LoudMax64.dll',
        params: Object.assign({}, OPERATOR_LOUDMAX, o.lm || {}) },
    };
  }

  const BUILTINS = [
    makePreset('TarkovFX Pro', { builtin: true, locked: true,
      note: 'Locked flagship, v1.2 smoother tune. Rumble and wind cut, footstep thump kept, 1.6 to 4 kHz texture lifted, top-end hiss trimmed. Gentle 3:1 compression with a 6 ms attack and auto release, so there is no pumping while sprinting. Gunshots stay down and quiet sounds come up.',
      gains: [-9, -8, -6, -3, -1, 0, -2.5, -1.5, 1, 3.5, 5, 4.5, 0, -1, -4],
      preamp: { enabled: false, db: 0 },
      comp: { Thresh: map.dbToAmp(-30), Ratio: map.ratioToNorm(3), Attack: 0.012, Release: 0.03,
        Knee: map.kneeToNorm(8), 'RMS size': 0.01, ClsAttk: 0, AntiAls: 1, AutoMkUp: 0, AutoRel: 1 },
      makeup: { enabled: true, db: 6 },
      lm: { 'ISP Detection': 1 } }),
    makePreset('Footstep Max', { builtin: true,
      note: 'Footsteps above everything else. Heavy cut on wind and low rumble, extra lift at 2.5 kHz where steps and gear rattle sit, and rain and wind hiss rolled off at the top. Smooth compression with no pumping. Gunfire sounds thinner on purpose.',
      gains: [-12, -11, -9, -6, -2, 1, -2, 0, 1.5, 3.5, 6, 4, -1, -3, -6],
      preamp: { enabled: false, db: 0 },
      comp: { Thresh: map.dbToAmp(-26), Ratio: map.ratioToNorm(2.5), Attack: 0.012, Release: 0.03,
        Knee: map.kneeToNorm(10), 'RMS size': 0.01, ClsAttk: 0, AntiAls: 1, AutoMkUp: 0, AutoRel: 1 },
      makeup: { enabled: true, db: 5 },
      lm: { 'ISP Detection': 1 } }),
    makePreset('Operator', { builtin: true,
      note: 'Your original config. Cuts the low rumble, lifts the footstep and reload range, compresses gently, and limits the loud stuff.',
      gains: [-5, -5, -4, -3, -2, -1, -2, 0, 2, 3, 3, 2, -3, 3, 0] }),
    makePreset('Footstep Hunter', { builtin: true,
      note: 'Stronger cut under 160 Hz and a bigger boost from 1.6 to 4 kHz. Steps and gear rattle stand out more, explosions sound thinner.',
      gains: [-8, -8, -7, -5, -3, -2, -2, 0, 2, 4, 5, 4, 0, 2, 0],
      comp: { Thresh: map.dbToAmp(-32), Ratio: map.ratioToNorm(3) } }),
    makePreset('Balanced', { builtin: true,
      note: 'A milder version of Operator that keeps more of the low end. Good for long raids.',
      gains: [-3, -3, -2, -1, -1, 0, -1, 0, 1, 2, 2, 1, -1, 1, 0],
      comp: { Thresh: map.dbToAmp(-24) } }),
    makePreset('Indoor CQB', { builtin: true,
      note: 'For Labs, Interchange and Reserve bunkers. Pulls down boomy 250 to 630 Hz reverb so steps on hard floors cut through.',
      gains: [-6, -6, -5, -3, -2, -3, -4, -2, 1, 3, 4, 3, -2, 2, 0],
      comp: { Thresh: map.dbToAmp(-30), Ratio: map.ratioToNorm(2.5) } }),
    makePreset('Night Raid', { builtin: true,
      note: 'Heavier compression for playing at low volume. Quiet sounds come up and gunfire stays tame.',
      gains: [-5, -5, -4, -3, -2, -1, -1, 0, 2, 3, 3, 2, -2, 2, 0],
      comp: { Thresh: map.dbToAmp(-38), Ratio: map.ratioToNorm(4), Knee: map.kneeToNorm(6) } }),
    makePreset('Flat / Bypass', { builtin: true,
      note: 'Flat EQ with both plugins off. Use it to compare against your other presets.',
      gains: BANDS.map(() => 0), compEnabled: false, lmEnabled: false }),
  ];

  /* ---------- serialize to APO config ---------- */
  function pluginLine(plug, keys, libPath) {
    const parts = ['VSTPlugin: Library', quoteIfNeeded(libPath || plug.library)];
    const seen = new Set();
    for (const k of keys) if (k in plug.params) { parts.push(quoteIfNeeded(k), fmt(plug.params[k])); seen.add(k); }
    for (const k of Object.keys(plug.params)) if (!seen.has(k)) parts.push(quoteIfNeeded(k), fmt(plug.params[k]));
    return parts.join(' ');
  }

  function toApoConfig(p, opts) {
    opts = opts || {};
    const bypass = !!opts.bypass;
    const lib = opts.libraries || {};
    const c = (on, line) => (on && !bypass ? line : '# ' + line);
    const lines = [];
    lines.push('# Generated by TarkovFX. Preset: ' + p.name + (bypass ? '  [BYPASSED]' : ''));
    lines.push('# Changes made here are overwritten. Edit the preset in TarkovFX instead.');
    lines.push(c(p.preamp.enabled, 'Preamp: ' + fmtGain(p.preamp.db) + ' dB'));
    lines.push(c(p.eq.enabled, 'GraphicEQ: ' + p.eq.bands.map((b) => b.f + ' ' + fmtGain(b.g)).join('; ')));
    lines.push(c(p.reacomp.enabled, pluginLine(p.reacomp, REACOMP_KEYS, lib.reacomp)));
    if (p.makeup && (p.makeup.enabled || p.makeup.db))
      lines.push('# make-up gain (after ReaComp)', c(p.makeup.enabled && p.reacomp.enabled, 'Preamp: ' + fmtGain(p.makeup.db) + ' dB'));
    lines.push(c(p.loudmax.enabled, pluginLine(p.loudmax, LOUDMAX_KEYS, lib.loudmax)));
    return lines.join('\r\n') + '\r\n';
  }

  /* ---------- parse an APO config (import) ---------- */
  function fromApoConfig(text, name) {
    const p = makePreset(name || 'Imported');
    p.reacomp.enabled = false; p.loudmax.enabled = false; p.eq.enabled = false; p.preamp.enabled = false;
    const warnings = []; let afterComp = false;
    for (let raw of String(text).split(/\r?\n/)) {
      let line = raw.trim(); if (!line) continue;
      let enabled = true;
      if (line.startsWith('#')) { enabled = false; line = line.replace(/^#+\s*/, ''); }
      const m = line.match(/^([A-Za-z]+)\s*:\s*(.*)$/); if (!m) continue;
      const cmd = m[1].toLowerCase(), rest = m[2];
      if (cmd === 'preamp') {
        const v = parseFloat(rest);
        if (!isNaN(v)) { if (afterComp) { p.makeup.db = v; p.makeup.enabled = enabled; } else { p.preamp.db = v; p.preamp.enabled = enabled; } }
      } else if (cmd === 'graphiceq') {
        const pts = rest.split(';').map((s) => s.trim().split(/\s+/).map(Number)).filter((a) => a.length >= 2 && !a.some(isNaN));
        if (pts.length) {
          // resample onto TarkovFX's 15 bands (linear interpolation in log-frequency, like APO does)
          p.eq.bands = BANDS.map((f) => ({ f, g: Math.round(interpLog(pts, f) * 10) / 10 }));
          p.eq.enabled = enabled;
        }
      } else if (cmd === 'vstplugin') {
        const t = tokenize(rest); let lib = null; const params = {};
        for (let i = 0; i < t.length; i++) {
          if (t[i] === 'Library') { lib = t[++i]; continue; }
          if (t[i] === 'ChunkData') { i++; warnings.push('ChunkData ignored'); continue; }
          const v = parseFloat(t[i + 1]); if (!isNaN(v)) { params[t[i]] = v; i++; }
        }
        if (!lib) continue;
        const base = lib.split(/[\\/]/).pop().toLowerCase();
        const target = base.includes('reacomp') ? p.reacomp : base.includes('loudmax') ? p.loudmax : null;
        if (!target) { warnings.push('Unsupported plugin skipped: ' + lib); continue; }
        target.library = lib.split(/[\\/]/).pop();
        target.params = Object.assign({}, target.params, params);
        target.enabled = enabled;
        afterComp = target === p.reacomp;
      } else if (enabled && !['device', 'channel', 'stage', 'include'].includes(cmd)) {
        warnings.push('Unsupported line skipped: ' + m[1]);
      }
    }
    return { preset: p, warnings };
  }

  function interpLog(pts, f) {
    pts = pts.slice().sort((a, b) => a[0] - b[0]);
    if (f <= pts[0][0]) return pts[0][1];
    if (f >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
    for (let i = 0; i < pts.length - 1; i++) {
      const [f1, g1] = pts[i], [f2, g2] = pts[i + 1];
      if (f >= f1 && f <= f2) { const t = (Math.log(f) - Math.log(f1)) / (Math.log(f2) - Math.log(f1) || 1); return g1 + t * (g2 - g1); }
    }
    return 0;
  }

  function clone(p) { return JSON.parse(JSON.stringify(p)); }

  function validate(p) {
    // fills in anything missing from older / hand-edited preset files
    const d = makePreset(p && p.name ? String(p.name) : 'Preset');
    if (!p || typeof p !== 'object') return d;
    const out = clone(d);
    out.note = typeof p.note === 'string' ? p.note : '';
    if (p.preamp) { out.preamp.enabled = !!p.preamp.enabled; out.preamp.db = clamp(+p.preamp.db || 0, -30, 20); }
    if (p.makeup) { out.makeup.enabled = !!p.makeup.enabled; out.makeup.db = clamp(+p.makeup.db || 0, -24, 24); }
    if (p.eq && Array.isArray(p.eq.bands)) {
      out.eq.enabled = p.eq.enabled !== false;
      out.eq.bands = BANDS.map((f, i) => { const b = p.eq.bands[i]; return { f, g: clamp(b && isFinite(+b.g) ? +b.g : 0, EQ_MIN, EQ_MAX) }; });
    }
    for (const k of ['reacomp', 'loudmax']) if (p[k]) {
      out[k].enabled = p[k].enabled !== false;
      if (typeof p[k].library === 'string' && p[k].library) out[k].library = p[k].library;
      if (p[k].params) for (const [pk, pv] of Object.entries(p[k].params)) if (isFinite(+pv)) out[k].params[pk] = +pv;
    }
    return out;
  }

  return { BANDS, EQ_MIN, EQ_MAX, REACOMP_KEYS, LOUDMAX_KEYS, BUILTINS, map, fmt, makePreset,
    toApoConfig, fromApoConfig, interpLog, clone, validate, tokenize };
});
