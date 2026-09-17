import { describe, it, expect } from "vitest";
import { glowChannels } from "../accent";

describe("glowChannels", () => {
  it("leaves a bright accent alone", () => {
    // #3a86ff is light enough to read as a glow on the dark window.
    expect(glowChannels(58, 134, 255)).toEqual([58, 134, 255]);
  });

  it("lifts a near-black accent so the glow is visible at all", () => {
    const [r, g, b] = glowChannels(13, 13, 13);
    expect(r).toBeGreaterThan(180);
    expect(r).toBe(g);
    expect(g).toBe(b);
  });

  it("keeps the hue of a dark but saturated accent", () => {
    // A dark red must glow red, not white-hot.
    const [r, g, b] = glowChannels(90, 0, 0);
    expect(r).toBeGreaterThan(90);
    expect(r).toBeGreaterThan(g);
    expect(g).toBe(b);
  });

  it("never exceeds the channel range", () => {
    expect(glowChannels(0, 0, 0).every((c) => c >= 0 && c <= 255)).toBe(true);
    expect(glowChannels(255, 255, 255)).toEqual([255, 255, 255]);
  });
});
