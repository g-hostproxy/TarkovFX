'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, globalShortcut, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const TFX = require('./core/model.js');

const APP_ID = 'com.tarkovfx.app';
const OUT_FILE = 'TarkovFX.txt';
const BACKUP_FILE = 'config.txt.pre-tarkovfx.bak';
const INCLUDE_RE = /^\s*Include\s*:\s*"?TarkovFX\.txt"?\s*$/im;

let win = null, tray = null, quitting = false;
const storePath = () => path.join(app.getPath('userData'), 'tarkovfx.json');

/* ------------------------------------------------------------------ store */
const DEFAULT_STORE = {
  presets: [], active: 'TarkovFX Pro', bypass: false,
  plugins: { reacomp: '', loudmax: '' },
  settings: { liveApply: true, closeToTray: true, startMinimized: false,
    hotkeys: { bypass: 'Control+Alt+B', next: 'Control+Alt+N', prev: 'Control+Alt+P', slots: true } },
};
function loadStore() {
  try {
    const s = JSON.parse(fs.readFileSync(storePath(), 'utf8'));
    const out = Object.assign({}, DEFAULT_STORE, s);
    out.settings = Object.assign({}, DEFAULT_STORE.settings, s.settings || {});
    out.settings.hotkeys = Object.assign({}, DEFAULT_STORE.settings.hotkeys, (s.settings || {}).hotkeys || {});
    out.plugins = Object.assign({}, DEFAULT_STORE.plugins, s.plugins || {});
    out.presets = (s.presets || []).map(TFX.validate);
    return out;
  } catch { return JSON.parse(JSON.stringify(DEFAULT_STORE)); }
}
function saveStore(s) {
  fs.mkdirSync(path.dirname(storePath()), { recursive: true });
  const tmp = storePath() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
  fs.renameSync(tmp, storePath());
}
let store = null;

/* ------------------------------------------------------------- windows bits */
function run(cmd, args, opts) {
  return new Promise((res) => execFile(cmd, args, Object.assign({ windowsHide: true }, opts || {}),
    (err, stdout, stderr) => res({ err, stdout: String(stdout || ''), stderr: String(stderr || '') })));
}
async function regValue(key, name) {
  if (process.platform !== 'win32') return null;
  for (const view of ['/reg:64', '/reg:32']) {
    const r = await run('reg', ['query', key, '/v', name, view]);
    const m = r.stdout.match(new RegExp(name + '\\s+REG_(?:EXPAND_)?SZ\\s+(.+)', 'i'));
    if (m) return m[1].trim();
  }
  return null;
}
function exists(p) { try { return !!p && fs.existsSync(p); } catch { return false; } }

let apoCache = null;
async function findApo(force) {
  if (apoCache && !force) return apoCache;
  let install = await regValue('HKLM\\SOFTWARE\\EqualizerAPO', 'InstallPath');
  let config = await regValue('HKLM\\SOFTWARE\\EqualizerAPO', 'ConfigPath');
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  if (!install && exists(path.join(pf, 'EqualizerAPO'))) install = path.join(pf, 'EqualizerAPO');
  if (install && !config) config = path.join(install, 'config');
  apoCache = { install, config, installed: !!(install && exists(config)) };
  return apoCache;
}

const PLUGIN_FILES = { reacomp: ['reacomp-standalone.dll'], loudmax: ['LoudMax64.dll', 'LoudMax_x64.dll'] };
function findPlugin(which, apo) {
  const custom = store.plugins[which];
  if (custom && exists(custom)) return custom;
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const cf = process.env.CommonProgramFiles || 'C:\\Program Files\\Common Files';
  const dirs = [];
  if (apo.install) dirs.push(path.join(apo.install, 'VSTPlugins'), apo.config, apo.install);
  dirs.push(path.join(pf, 'VstPlugins', 'ReaPlugs'), path.join(pf, 'VstPlugins'), path.join(pf, 'VSTPlugins'),
    path.join(pf, 'Steinberg', 'VstPlugins'), path.join(cf, 'VST2'), path.join(cf, 'VST2', 'LoudMax'),
    path.join(pf, 'LoudMax'), path.join(pf, 'REAPER (x64)', 'Plugins', 'FX'));
  for (const d of dirs) for (const f of PLUGIN_FILES[which]) {
    const p = d && path.join(d, f);
    if (exists(p)) return p;
  }
  // one level of subfolders inside common VST dirs
  for (const d of [path.join(pf, 'VstPlugins'), path.join(cf, 'VST2'), apo.install && path.join(apo.install, 'VSTPlugins')]) {
    try {
      for (const sub of fs.readdirSync(d, { withFileTypes: true })) if (sub.isDirectory())
        for (const f of PLUGIN_FILES[which]) { const p = path.join(d, sub.name, f); if (exists(p)) return p; }
    } catch { /* dir missing */ }
  }
  return null;
}

function canWrite(dir) {
  try { const t = path.join(dir, '.tfx-write-test'); fs.writeFileSync(t, 'x'); fs.unlinkSync(t); return true; }
  catch { return false; }
}

// Runs a command as admin (one UAC prompt). Used only for "Fix permissions".
function runElevated(file, args) {
  const ps = `Start-Process -FilePath '${file}' -ArgumentList '${args.replace(/'/g, "''")}' -Verb RunAs -Wait -WindowStyle Hidden`;
  return run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps]);
}

/* ---- is Equalizer APO actually active on the current output device? ---- */
let devCache = null, devAt = 0, devPending = null;
function devLabel(d) { return d.name && d.device ? d.name + ' (' + d.device + ')' : d.device || d.name || 'Unknown device'; }
function summarizeDevices(j) {
  const raw = Array.isArray(j.devices) ? j.devices : j.devices ? [j.devices] : [];
  const devices = raw.map((d) => ({ guid: String(d.guid || '').toUpperCase(), name: d.name || '', device: d.device || '',
    label: devLabel(d), installed: !!d.installed, enhancementsDisabled: !!d.enhancementsDisabled }));
  const current = devices.find((d) => d.guid && d.guid === String(j.defaultGuid || '').toUpperCase()) || null;
  // null = couldn't tell (never show a warning we aren't sure about)
  const active = current ? current.installed && !current.enhancementsDisabled : null;
  return { current, devices, active, checkedAt: Date.now() };
}
function deviceCheck(force) {
  if (process.platform !== 'win32') return Promise.resolve(null);
  if (!force && devCache && Date.now() - devAt < 4000) return Promise.resolve(devCache);
  if (devPending) return devPending;
  let enc;
  try { enc = Buffer.from(fs.readFileSync(path.join(__dirname, 'core', 'devicecheck.ps1'), 'utf8'), 'utf16le').toString('base64'); }
  catch { return Promise.resolve(null); }
  devPending = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc], { timeout: 20000 })
    .then((r) => {
      let res = null;
      try { const j = JSON.parse(r.stdout.trim().split(/\r?\n/).pop()); if (j && j.ok) res = summarizeDevices(j); } catch { /* unknown */ }
      devCache = res; devAt = Date.now(); devPending = null;
      return res;
    });
  return devPending;
}

async function status() {
  const apo = await findApo(true);
  const out = { platform: process.platform, apo, writable: false, hooked: false, configTxt: null,
    legacyLines: false, plugins: {}, outFile: apo.config ? path.join(apo.config, OUT_FILE) : null };
  if (apo.installed) {
    out.writable = canWrite(apo.config);
    const ct = path.join(apo.config, 'config.txt');
    try {
      const txt = fs.readFileSync(ct, 'utf8');
      out.configTxt = txt;
      out.hooked = INCLUDE_RE.test(txt);
      out.legacyLines = /^\s*(GraphicEQ|VSTPlugin)\s*:/im.test(txt);
    } catch { out.configTxt = ''; }
    out.backupExists = exists(path.join(apo.config, BACKUP_FILE));
    out.deviceSelector = [path.join(apo.install, 'DeviceSelector.exe'), path.join(apo.install, 'Configurator.exe')].find(exists) || null;
    out.editor = exists(path.join(apo.install, 'Editor.exe')) ? path.join(apo.install, 'Editor.exe') : null;
  }
  for (const k of ['reacomp', 'loudmax']) { const p = findPlugin(k, apo); out.plugins[k] = { found: !!p, path: p }; }
  out.device = apo.installed ? await deviceCheck(true) : null;
  return out;
}

async function writeConfig(preset, bypass) {
  const apo = await findApo();
  if (!apo.installed) throw new Error('Equalizer APO was not found. Install it first (Setup tab).');
  const libs = {};
  for (const k of ['reacomp', 'loudmax']) { const p = findPlugin(k, apo); if (p) libs[k] = p; }
  const text = TFX.toApoConfig(TFX.validate(preset), { bypass, libraries: libs });
  const dest = path.join(apo.config, OUT_FILE);
  fs.writeFileSync(dest, text, 'utf8'); // Equalizer APO watches this folder and reloads on change
  return { path: dest, text, at: Date.now() };
}

/* ------------------------------------------------------------------ window */
function iconPath() { return path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'); }

function createWindow() {
  win = new BrowserWindow({
    width: 1240, height: 800, minWidth: 1040, minHeight: 680, frame: false, backgroundColor: '#0b0c0a',
    title: 'TarkovFX', icon: iconPath(), show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => { if (!store.settings.startMinimized) win.show(); });
  win.on('close', (e) => {
    if (!quitting && store.settings.closeToTray && tray) { e.preventDefault(); win.hide(); }
  });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

function allPresetNames() { return TFX.BUILTINS.map((p) => p.name).concat(store.presets.map((p) => p.name)); }

function buildTray() {
  if (!tray) {
    tray = new Tray(nativeImage.createFromPath(iconPath()).resize({ width: 16, height: 16 }));
    tray.setToolTip('TarkovFX');
    tray.on('click', () => { win.show(); win.focus(); });
  }
  const names = allPresetNames();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open TarkovFX', click: () => { win.show(); win.focus(); } },
    { type: 'separator' },
    { label: 'Bypass all FX', type: 'checkbox', checked: !!store.bypass, click: () => send('hotkey', { action: 'bypass' }) },
    { label: 'Preset', submenu: names.map((n) => ({ label: n, type: 'radio', checked: n === store.active,
      click: () => send('hotkey', { action: 'select', name: n }) })) },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
}
function send(ch, data) { if (win && !win.isDestroyed()) win.webContents.send(ch, data); }

function registerHotkeys() {
  globalShortcut.unregisterAll();
  const hk = store.settings.hotkeys, failed = [];
  const reg = (acc, data) => { if (!acc) return; try { if (!globalShortcut.register(acc, () => send('hotkey', data))) failed.push(acc); } catch { failed.push(acc); } };
  reg(hk.bypass, { action: 'bypass' });
  reg(hk.next, { action: 'next' });
  reg(hk.prev, { action: 'prev' });
  if (hk.slots) for (let i = 1; i <= 9; i++) reg('Control+Alt+' + i, { action: 'slot', index: i - 1 });
  return failed;
}

/* --------------------------------------------------------------------- ipc */
function ipc() {
  ipcMain.handle('store:get', () => ({ store, builtins: TFX.BUILTINS, version: app.getVersion() }));
  ipcMain.handle('store:set', (_e, patch) => {
    store = Object.assign(store, patch);
    if (patch.presets) store.presets = patch.presets.map(TFX.validate);
    saveStore(store); buildTray();
    return true;
  });
  ipcMain.handle('hotkeys:apply', () => registerHotkeys());
  ipcMain.handle('apo:status', () => status());
  ipcMain.handle('apo:apply', async (_e, preset, bypass) => {
    try { return { ok: true, ...(await writeConfig(preset, bypass)) }; }
    catch (err) { return { ok: false, error: err.code === 'EPERM' || err.code === 'EACCES'
      ? 'No write access to the Equalizer APO config folder. Go to Setup and click "Fix permissions".' : String(err.message || err) }; }
  });
  ipcMain.handle('apo:preview', async (_e, preset, bypass) => {
    const apo = await findApo(); const libs = {};
    for (const k of ['reacomp', 'loudmax']) { const p = findPlugin(k, apo); if (p) libs[k] = p; }
    return TFX.toApoConfig(TFX.validate(preset), { bypass, libraries: libs });
  });
  ipcMain.handle('apo:fixPermissions', async () => {
    const apo = await findApo();
    if (!apo.installed) return { ok: false, error: 'Equalizer APO not found.' };
    // Grant the built-in Users group modify rights on the config folder (one UAC prompt).
    await runElevated('icacls.exe', `"${apo.config}" /grant *S-1-5-32-545:(OI)(CI)M /T`);
    return { ok: canWrite(apo.config) };
  });
  ipcMain.handle('apo:hook', async (_e, mode) => {
    const apo = await findApo();
    if (!apo.installed) return { ok: false, error: 'Equalizer APO not found.' };
    const ct = path.join(apo.config, 'config.txt');
    let txt = ''; try { txt = fs.readFileSync(ct, 'utf8'); } catch { /* none yet */ }
    try {
      const bak = path.join(apo.config, BACKUP_FILE);
      if (!exists(bak)) fs.writeFileSync(bak, txt, 'utf8');
      if (INCLUDE_RE.test(txt)) return { ok: true };
      const next = mode === 'append'
        ? txt.replace(/\s*$/, '') + '\r\n\r\n# TarkovFX\r\nInclude: ' + OUT_FILE + '\r\n'
        : '# Equalizer APO is controlled by TarkovFX.\r\n# Your previous config is saved as ' + BACKUP_FILE + '\r\nInclude: ' + OUT_FILE + '\r\n';
      fs.writeFileSync(ct, next, 'utf8');
      return { ok: true };
    } catch (err) { return { ok: false, error: 'Could not edit config.txt. Click "Fix permissions" first. (' + err.code + ')' }; }
  });
  ipcMain.handle('apo:unhook', async () => {
    const apo = await findApo();
    const ct = path.join(apo.config, 'config.txt'), bak = path.join(apo.config, BACKUP_FILE);
    try {
      if (exists(bak)) { fs.copyFileSync(bak, ct); fs.unlinkSync(bak); }
      else { const t = fs.readFileSync(ct, 'utf8'); fs.writeFileSync(ct, t.replace(/^\s*#\s*TarkovFX\s*$/im, '').replace(INCLUDE_RE, ''), 'utf8'); }
      return { ok: true };
    } catch (err) { return { ok: false, error: String(err.message || err) }; }
  });
  ipcMain.handle('plugin:locate', async (_e, which) => {
    const r = await dialog.showOpenDialog(win, {
      title: which === 'reacomp' ? 'Locate reacomp-standalone.dll' : 'Locate LoudMax64.dll',
      filters: [{ name: 'VST plugin (64-bit)', extensions: ['dll'] }], properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return { ok: false };
    const p = r.filePaths[0], base = path.basename(p).toLowerCase();
    let warn = null;
    if (which === 'reacomp' && base !== 'reacomp-standalone.dll') warn = 'Equalizer APO needs reacomp-standalone.dll. The regular reacomp.dll fails with "initialization failed".';
    if (which === 'loudmax' && base.startsWith('la_')) warn = 'That file is the LADSPA version of LoudMax. Equalizer APO needs the VST version (LoudMax64.dll).';
    store.plugins[which] = p; saveStore(store);
    return { ok: true, path: p, warn };
  });
  ipcMain.handle('plugin:clear', (_e, which) => { store.plugins[which] = ''; saveStore(store); return true; });
  ipcMain.handle('preset:export', async (_e, preset) => {
    const r = await dialog.showSaveDialog(win, { title: 'Export preset', defaultPath: preset.name.replace(/[\\/:*?"<>|]/g, '_') + '.tfx.json',
      filters: [{ name: 'TarkovFX preset', extensions: ['json'] }, { name: 'Equalizer APO config', extensions: ['txt'] }] });
    if (r.canceled || !r.filePath) return { ok: false };
    const data = /\.txt$/i.test(r.filePath) ? TFX.toApoConfig(TFX.validate(preset))
      : JSON.stringify(Object.assign({ tarkovfx: 1 }, TFX.validate(preset), { builtin: false }), null, 2);
    fs.writeFileSync(r.filePath, data, 'utf8');
    return { ok: true, path: r.filePath };
  });
  ipcMain.handle('preset:import', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Import preset(s)', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'TarkovFX preset or Equalizer APO config', extensions: ['json', 'txt'] }] });
    if (r.canceled) return { ok: false, presets: [] };
    const presets = [], warnings = [];
    for (const f of r.filePaths) {
      try {
        const txt = fs.readFileSync(f, 'utf8');
        const name = path.basename(f).replace(/\.tfx\.json$|\.json$|\.txt$/i, '');
        if (/^\s*\{/.test(txt)) { const p = TFX.validate(JSON.parse(txt)); p.builtin = false; presets.push(p); }
        else { const res = TFX.fromApoConfig(txt, name); presets.push(res.preset); warnings.push(...res.warnings); }
      } catch (err) { warnings.push(path.basename(f) + ': ' + err.message); }
    }
    return { ok: true, presets, warnings };
  });
  ipcMain.handle('apo:deviceCheck', (_e, force) => deviceCheck(!!force));
  ipcMain.handle('open:soundPanel', () => { execFile('control.exe', ['mmsys.cpl'], { windowsHide: false }, () => {}); });
  ipcMain.handle('apo:restartAudio', async () => {
    await runElevated('powershell.exe', '-NoProfile -WindowStyle Hidden -Command Restart-Service -Force Audiosrv');
    return { ok: true };
  });
  ipcMain.handle('open:url', (_e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });
  ipcMain.handle('open:path', (_e, p) => { if (p && exists(p)) shell.openPath(p); });
  ipcMain.handle('open:showItem', (_e, p) => { if (p && exists(p)) shell.showItemInFolder(p); });
  ipcMain.handle('win:min', () => win.minimize());
  ipcMain.handle('win:max', () => (win.isMaximized() ? win.unmaximize() : win.maximize()));
  ipcMain.handle('win:close', () => win.close());
  ipcMain.handle('win:quit', () => { quitting = true; app.quit(); });
}

/* -------------------------------------------------------------------- boot */
if (!app.requestSingleInstanceLock()) { app.quit(); }
else {
  app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });
  app.setAppUserModelId(APP_ID);
  app.whenReady().then(() => {
    store = loadStore();
    ipc();
    createWindow();
    try { buildTray(); } catch { tray = null; }
    registerHotkeys();
  });
  app.on('before-quit', () => { quitting = true; });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', () => app.quit());
}
