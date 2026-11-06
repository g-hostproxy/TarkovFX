'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const call = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);
contextBridge.exposeInMainWorld('tfx', {
  getStore: call('store:get'), setStore: call('store:set'), applyHotkeys: call('hotkeys:apply'),
  status: call('apo:status'), apply: call('apo:apply'), preview: call('apo:preview'),
  fixPermissions: call('apo:fixPermissions'), deviceCheck: call('apo:deviceCheck'),
  openSoundPanel: call('open:soundPanel'), restartAudio: call('apo:restartAudio'), hook: call('apo:hook'), unhook: call('apo:unhook'),
  locatePlugin: call('plugin:locate'), clearPlugin: call('plugin:clear'),
  exportPreset: call('preset:export'), importPresets: call('preset:import'),
  openUrl: call('open:url'), openPath: call('open:path'), showItem: call('open:showItem'),
  minimize: call('win:min'), maximize: call('win:max'), close: call('win:close'), quit: call('win:quit'),
  onHotkey: (fn) => ipcRenderer.on('hotkey', (_e, d) => fn(d)),
});
