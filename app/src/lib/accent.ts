/** Accent-derived colors that need more than a CSS var can express. */

/**
 * Below this relative luminance an accent is too dark to read as a glow
 * against the window, so it gets mixed toward white.
 */
const GLOW_FLOOR = 0.4;

/**
 * RGB channels for the FX bar's glow. A bright accent glows as itself; a dark
 * one (a near-black custom accent, say) is lifted toward white in proportion
 * to how far below the floor it sits, so the glow is always visible while
 * still leaning on the accent's hue.
 */
export function glowChannels(r: number, g: number, b: number): [number, number, number] {
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  if (lum >= GLOW_FLOOR) return [r, g, b];

  const lift = (GLOW_FLOOR - lum) / GLOW_FLOOR;
  const up = (c: number) => Math.round(c + (255 - c) * lift);
  return [up(r), up(g), up(b)];
}
