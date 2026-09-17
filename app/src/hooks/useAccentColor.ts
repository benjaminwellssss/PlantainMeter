import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AccentSource } from "../types/style";
import { glowChannels } from "../lib/accent";

interface AccentColor {
  r: number;
  g: number;
  b: number;
  hex: string;
  contrast_fg: string;
}

const DEFAULT_ACCENT: AccentColor = {
  r: 58, g: 134, b: 255,
  hex: "#3a86ff",
  contrast_fg: "#ffffff",
};

function hexToAccent(hex: string): AccentColor {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16) || 0;
  const g = parseInt(h.substring(2, 4), 16) || 0;
  const b = parseInt(h.substring(4, 6), 16) || 0;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return {
    r, g, b,
    hex: `#${h.padEnd(6, "0")}`,
    contrast_fg: luminance > 180 ? "#000000" : "#ffffff",
  };
}

export function useAccentColor(source: AccentSource, customColor: string) {
  const [accent, setAccent] = useState<AccentColor>(DEFAULT_ACCENT);

  // System accent: fetch from Rust on mount.
  //
  // The cancellation guard is load-bearing. `source` flips to "system" briefly
  // whenever settings are opened before the saved style is applied (and at startup
  // before the store loads). Without the guard, this fetch resolves *after* the
  // custom colour has been re-applied and silently overwrites it — and nothing
  // re-runs the custom effect afterwards, so the wrong colour sticks for the
  // whole session.
  useEffect(() => {
    if (source !== "system") return;
    let cancelled = false;

    invoke<AccentColor>("get_accent_color")
      .then((color) => {
        if (cancelled) return;
        setAccent(color);
        applyToCSS(color);
      })
      .catch(() => {
        if (cancelled) return;
        applyToCSS(DEFAULT_ACCENT);
      });

    return () => { cancelled = true; };
  }, [source]);

  // Custom accent: derive from hex client-side
  useEffect(() => {
    if (source !== "custom") return;
    const color = hexToAccent(customColor);
    setAccent(color);
    applyToCSS(color);
  }, [source, customColor]);

  return accent;
}

function applyToCSS(color: AccentColor) {
  const root = document.documentElement;
  root.style.setProperty("--accent", color.hex);
  root.style.setProperty("--accent-fg", color.contrast_fg);
  root.style.setProperty("--accent-r", String(color.r));
  root.style.setProperty("--accent-g", String(color.g));
  root.style.setProperty("--accent-b", String(color.b));

  // A near-black accent would glow invisibly, so the FX bar gets its own
  // lifted channels rather than reusing --accent-r/g/b directly.
  const [gr, gg, gb] = glowChannels(color.r, color.g, color.b);
  root.style.setProperty("--accent-glow-r", String(gr));
  root.style.setProperty("--accent-glow-g", String(gg));
  root.style.setProperty("--accent-glow-b", String(gb));
}
