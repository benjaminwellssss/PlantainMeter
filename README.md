# MiniMeeter

A lightweight, easily resizeable audio mixer for [Voicemeeter Banana](https://vb-audio.com/Voicemeeter/banana.htm) and [Voicemeeter Potato](https://vb-audio.com/Voicemeeter/potato.htm) on Windows. Designed to be small enough to sit alongside Plexamp or Spotify, but powerful enough to replace the full Voicemeeter UI for day-to-day mixing.

![License](https://img.shields.io/badge/license-GPL--3.0-blue)

![demo](https://github.com/user-attachments/assets/b0860237-e307-4641-a978-77883a539658)

## Features

- **Compact & resizable** - Starts at 420x340, shrinks down to 200x275 (Plexamp-sized)
- **Windows acrylic glass** - Frosted transparency with your system accent color
- **Live faders** - Smooth dragging, mouse wheel, per-channel mute buttons
- **Real-time sync** - Polls Voicemeeter at ~30fps so hardware changes show up instantly
- **Background visualizers** - 7 animated backgrounds (plasma, starfield, matrix rain, and more)
- **Per-focus styling** - Different backgrounds/opacity when the window is focused vs unfocused
- **A1 output switching** - Change your main output device from the title bar
- **Banana and Potato** - Detects which edition is running and offers all of its strips (8 on Potato); choose which edition the Launch button starts
- **Per-app volumes** - A slide-over from the title bar lists every app playing into Voicemeeter's virtual inputs with its own volume, mute and live meter
- **FX preset hotkeys** (Potato) - Bundle reverb/delay/FX sends, master FX switches and bus returns into named groups, toggle them with global hotkeys, and see active groups as FX pills along the bottom bar
- **Fully configurable** - Remap strips, rename channels, adjust dB ranges from the settings panel

## Requirements

- Windows 10/11
- [Voicemeeter Banana](https://vb-audio.com/Voicemeeter/banana.htm) or [Voicemeeter Potato](https://vb-audio.com/Voicemeeter/potato.htm) installed (FX groups need Potato)

## Download

Grab the latest `.exe` from the [Releases](https://github.com/shuperj/MiniMeeter/releases) page.

## Build from Source

You'll need [Node.js](https://nodejs.org/) 20+, [Rust](https://rustup.rs/) (stable, MSVC target), and Visual Studio Build Tools with the C++ workload.

```bash
cd app
npm install
npx tauri build
```

The compiled binary lands in `app/src-tauri/target/release/minimeeter.exe`.

Tests: `npm test` (frontend helpers, vitest) and `cargo test` in `app/src-tauri` (edition tables, FX engine, hotkey bindings, audio-session helpers).

## Support

If you find MiniMeeter useful, consider buying me a coffee:

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/shuperj)

## License

[GPL-3.0](LICENSE)
