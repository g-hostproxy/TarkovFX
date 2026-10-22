# 🎧 Tarkov Audio Pro (EFT-AudioEnhancer)

> Optimize your tactical awareness, protect your hearing from deafening gunfire, and never miss a match cue in *Escape from Tarkov*.

---

## 🚀 Features

* **Dynamic Range Compression & Limiting:** Automatically tames high-decibel audio spikes (like sudden explosions and heavy-caliber gunfire) so you can keep your master volume high enough to hear faint footsteps without damaging your ears.
* **Custom Headset Profiles:** Easily switch or tweak equalizer (EQ) presets tuned specifically for different in-game headsets (e.g., ComTac 4s, Sordin, Gssh-01).
* **Game Log Audio Triggers:** Parses local EFT log files to play custom background audio cues for critical events:
  * 🟢 Match found / Raid starting
  * ⏱️ Run-through time elapsed
  * 🔄 Scav cooldown ready
* **Low Latency & Lightweight:** Written with performance in mind to ensure zero noticeable audio delay or frame drops during intense firefights.

---

## 🛠️ Tech Stack

* **Language:** [e.g., C# / Python / C++]
* **Audio Processing:** [e.g., NAudio / PortAudio / Equalizer APO API]
* **Log Monitoring:** FileSystemWatcher (Local EFT Log Parsing)

---

## 📦 Installation & Setup

### Prerequisites
1. Windows 10 / 11 (64-bit)
2. [Optional] Virtual Audio Cable or Equalizer APO (depending on your routing setup)

### Getting Started
1. Head over to the [Releases](../../releases) page and download the latest `TarkovAudioPro-vX.X.zip`.
2. Extract the archive to a folder of your choice.
3. Run `TarkovAudioPro.exe`.

---

## ⚙️ Configuration

1. **Path Setup:** Point the application to your main Escape from Tarkov installation directory so it can track log files.
2. **Compression Settings:** 
   * Adjust the **Threshold** to determine when volume limiting kicks in.
   * Tune the **Ratio** and **Attack/Release** times to preference.
3. **Audio Cues:** Enable or disable specific event notifications in the settings menu and assign custom sound files if desired.

---

## 🗺️ Roadmap

- [ ] Preset profiles sharing system for community EQ settings
- [ ] Overwolf / Discord overlay integration
- [ ] Automatic profile switching based on active in-game raid status

---

## 🤝 Contributing

Contributions, feature requests, and bug reports are welcome! Feel free to open an issue or submit a pull request.

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📝 License

Distributed under the **MIT License**. See `LICENSE` for more information.
