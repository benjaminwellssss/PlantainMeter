# Plantain

A lightweight, resizable audio mixer companion for [Voicemeeter](https://vb-audio.com/Voicemeeter/) (Banana and Potato) on Windows. Small enough to sit alongside Plexamp or Spotify, but real enough to replace the full Voicemeeter UI for day-to-day mixing.

## Credit

This is a fork of [**shuperj/MiniMeeter**](https://github.com/shuperj/MiniMeeter) — all credit for the original concept, design, and groundwork goes to **shuperj**, the original developer. This fork exists because it diverged enough (rebrand, glass redesign, knob mode, FX controls, dual-edition support) to be worth tracking separately, not because of any claim to have created the project. If you find this useful, consider supporting the original too:

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/shuperj)

![License](https://img.shields.io/badge/license-GPL--3.0-blue)

## Features

- **Dual-edition support** — auto-detects whether Voicemeeter Banana or Potato is running and adapts strip/bus layout, channel defaults, and available FX accordingly
- **Two control modes** — vertical faders or compact knobs, toggled from the titlebar, with a proportional sizing system so controls are never clipped or covered regardless of window size
- **Compact & resizable** — a shared "unit" system keeps margins and gaps proportional at any size, down to a genuine minimum floor
- **Windows acrylic glass** — frosted transparency with your system accent color, or a custom color
- **Live faders/knobs** — smooth dragging, mouse wheel, double-click to snap to unity (0 dB), always at the same relative position regardless of a channel's own dB range
- **Per-strip controls** — Mono, Solo, Mute on every channel; Mute-Center and a 5-state Karaoke cycle on the appropriate virtual strips
- **Reverb/Delay macros** — a one-click toggle per channel that jumps each send between off and a preset level (Banana/Potato only)
- **Real-time sync** — polls Voicemeeter at ~30fps so hardware changes show up instantly
- **Background visualizers** — several animated backgrounds, audio-reactive
- **Per-focus styling** — different backgrounds/opacity when the window is focused vs unfocused
- **A1 output switching** — change your main output device from the titlebar
- **Global mute hotkeys, window-size presets, autostart** — configurable from the settings panel

## Requirements

- Windows 10/11
- [Voicemeeter Banana](https://vb-audio.com/Voicemeeter/banana.htm) or [Voicemeeter Potato](https://vb-audio.com/Voicemeeter/potato.htm) installed

## Build from Source

You'll need [Node.js](https://nodejs.org/) 20+, [Rust](https://rustup.rs/) (stable, MSVC target), and Visual Studio Build Tools with the C++ workload.

```bash
cd app
npm install
npx tauri build
```

The compiled binary lands in `app/src-tauri/target/release/plantain.exe`, and an NSIS installer under `app/src-tauri/target/release/bundle/nsis/`.

## License

[GPL-3.0](LICENSE) — carried over from the upstream MiniMeeter project this was forked from.
