import { describe, it, expect } from "vitest";
import { EDITION_DEFAULTS, stripLabel, shortStripLabel } from "../editions";

describe("EDITION_DEFAULTS", () => {
  it("matches the Rust edition tables", () => {
    expect(EDITION_DEFAULTS.standard.stripCount).toBe(3);
    expect(EDITION_DEFAULTS.banana.stripCount).toBe(5);
    expect(EDITION_DEFAULTS.potato.stripCount).toBe(8);
    expect(EDITION_DEFAULTS.potato.busCount).toBe(8);
    expect(EDITION_DEFAULTS.banana.busCount).toBe(5);
    expect(EDITION_DEFAULTS.potato.hasFx).toBe(true);
    expect(EDITION_DEFAULTS.banana.hasFx).toBe(false);
  });

  it("labels strips the way Voicemeeter does", () => {
    const p = EDITION_DEFAULTS.potato;
    expect(stripLabel(p, 0)).toBe("Hardware Input 1");
    expect(stripLabel(p, 5)).toBe("Virtual Input");
    expect(stripLabel(p, 6)).toBe("Virtual Input AUX");
    expect(stripLabel(p, 7)).toBe("VAIO3");
    expect(p.strips[5].isVirtual).toBe(true);
    expect(p.strips[4].isVirtual).toBe(false);
    expect(stripLabel(EDITION_DEFAULTS.banana, 3)).toBe("Virtual Input");
    expect(stripLabel(EDITION_DEFAULTS.banana, 9)).toBe("Strip 9");
  });

  it("labels buses A1..An then B1..Bn", () => {
    const p = EDITION_DEFAULTS.potato;
    expect(p.buses.map((b) => b.label)).toEqual(["A1", "A2", "A3", "A4", "A5", "B1", "B2", "B3"]);
    expect(EDITION_DEFAULTS.banana.buses.map((b) => b.label)).toEqual(["A1", "A2", "A3", "B1", "B2"]);
  });

  it("gives short default channel names", () => {
    const p = EDITION_DEFAULTS.potato;
    expect(shortStripLabel(p, 0)).toBe("HW 1");
    expect(shortStripLabel(p, 5)).toBe("Virtual");
    expect(shortStripLabel(p, 6)).toBe("AUX");
    expect(shortStripLabel(p, 7)).toBe("VAIO3");
  });
});
