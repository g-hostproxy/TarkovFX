# 🎧 TarkovFX

> A Tarkov-themed audio helper for **Escape from Tarkov**: hear footsteps sooner, tame gunfire, and switch presets mid-raid with a hotkey.

TarkovFX drives [Equalizer APO](https://sourceforge.net/projects/equalizerapo/) with a 15-band EQ, the ReaComp compressor and the LoudMax limiter, wrapped in one dark, military-style app.

---

## ⬇️ Download

**Website:** https://g-hostproxy.github.io/TarkovFX/

Get the latest **`TarkovFX-vX.X-win64.zip`** from the [**Releases**](../../releases/latest) page, unzip it anywhere, and run **`TarkovFX.exe`**.

> Windows SmartScreen may warn because the exe isn't code-signed: click **More info → Run anyway**.

---

## 🚀 Features

* **Footstep-first presets:** 8 factory presets, including the locked **TarkovFX Pro** flagship and **Footstep Max**, which cuts wind and rumble and lifts the 1.6–4 kHz range where steps and gear rattle sit.
* **Compression that tames gunshots:** ReaComp holds loud transients down while make-up gain lifts quiet sounds. LoudMax catches the peaks.
* **Graphic EQ:** drag points on the response graph or use the sliders. Frequency zones are labelled for Tarkov (rumble, body, footsteps, gear, air).
* **Your own presets:** save, rename, duplicate, import and export (`.tfx.json` or plain Equalizer APO `.txt`).
* **In-game hotkeys:** switch presets or bypass all FX without alt-tabbing.
* **Setup checklist:** finds Equalizer APO and the plugins, fixes folder permissions, hooks into `config.txt`, and **warns you if Equalizer APO isn't active on the headset you're actually using**.
* **Tray app:** closing the window hides it to the tray.

---

## 📦 Installation & Setup

### Requirements (install these yourself; their licences don't allow bundling)
1. **Windows 10 / 11 (64-bit)**
2. **[Equalizer APO](https://sourceforge.net/projects/equalizerapo/files/)**: in the Configurator / Device Selector, tick your headset under *Playback devices*, then reboot.
3. **[ReaPlugs VST x64](https://www.reaper.fm/reaplugs/)**: TarkovFX uses `reacomp-standalone.dll` (not `reacomp.dll`).
4. **[LoudMax VST for Windows](https://loudmax.blogspot.com/)**: TarkovFX uses `LoudMax64.dll` (not the LADSPA version).

### First run
Open TarkovFX → **Setup** tab and get every item green:
* **Fix permissions** (one admin prompt) if the config folder is read-only
* **Hook (replace)** so Equalizer APO loads `TarkovFX.txt` (your old `config.txt` is backed up)
* **Locate DLL…** if a plugin isn't found automatically
* If it says **APO isn't active on your headset**, click **Open Device Selector**, tick the device it names, then reboot

---

## ⌨️ Hotkeys

| Keys | Action |
|---|---|
| `Ctrl` + `Alt` + `1`–`9` | Switch to preset slot 1–9 |
| `Ctrl` + `Alt` + `B` | Bypass / enable all FX |
| `Ctrl` + `Alt` + `N` / `P` | Next / previous preset |

Change them in **Settings**.

---

## 🛠️ Tech Stack

* **App:** Electron (HTML / CSS / JavaScript)
* **Audio processing:** Equalizer APO, configured through a generated `TarkovFX.txt`
* **Plugins:** ReaComp (Cockos ReaPlugs), LoudMax
* **Device check:** PowerShell + Windows Core Audio, mirroring Equalizer APO's own detection

### Run from source
```
cd app
npm install
npm start
```

---

## 🔧 Troubleshooting

* **No difference to my audio:** Equalizer APO is probably not installed on your current output device (e.g. after a headset swap, Bluetooth vs USB, or a driver update). TarkovFX shows a red banner when this happens; follow it, then reboot.
* **Audio sounds choppy / pumping:** use TarkovFX Pro or Footstep Max (v1.2+), which use a gentler compressor with auto release.

---

*Not affiliated with Battlestate Games, Cockos or LoudMax.*
