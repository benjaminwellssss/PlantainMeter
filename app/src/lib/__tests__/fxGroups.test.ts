import { describe, it, expect } from "vitest";
import { migrateFxGroups, newGroup, pillLabel } from "../fxGroups";

describe("migrateFxGroups", () => {
  it("returns [] for anything that is not an array", () => {
    expect(migrateFxGroups(undefined)).toEqual([]);
    expect(migrateFxGroups(null)).toEqual([]);
    expect(migrateFxGroups({})).toEqual([]);
    expect(migrateFxGroups("x")).toEqual([]);
  });

  it("drops garbage entries and fills defaults", () => {
    const out = migrateFxGroups([
      null,
      42,
      { name: "Cave", hotkey: "Alt+Numpad1", assignments: [{ param: "Strip[0].Reverb", value: 6 }] },
      { assignments: "nope" },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].name).toBe("Cave");
    expect(out[0].id).toBeTruthy();
    expect(out[0].assignments).toEqual([{ param: "Strip[0].Reverb", value: 6 }]);
    expect(out[1].name).toBe("FX 2");
    expect(out[1].assignments).toEqual([]);
    expect(out[1].hotkey).toBe("");
  });

  it("clamps known params and keeps unknown ones", () => {
    const out = migrateFxGroups([
      {
        id: "a",
        name: "A",
        assignments: [
          { param: "Strip[0].Reverb", value: 99 },
          { param: "Fx.Reverb.On", value: "1" },
          { param: "Strip[0].Gain", value: -12 },
          { param: "", value: 1 },
          { param: "Strip[0].Delay", value: "abc" },
        ],
      },
    ]);
    expect(out[0].id).toBe("a");
    expect(out[0].assignments).toEqual([
      { param: "Strip[0].Reverb", value: 10 },
      { param: "Fx.Reverb.On", value: 1 },
      { param: "Strip[0].Gain", value: -12 },
    ]);
  });

  it("creates groups with unique ids", () => {
    const a = newGroup(1);
    const b = newGroup(2);
    expect(a.id).not.toBe(b.id);
    expect(a.name).toBe("FX 1");
    expect(a.assignments).toEqual([]);
  });
});

describe("pillLabel", () => {
  it("shows the group's own name", () => {
    expect(pillLabel("Cave", 1)).toBe("Cave");
  });

  it("falls back to the position when the name was cleared", () => {
    expect(pillLabel("", 3)).toBe("FX 3");
    expect(pillLabel("   ", 2)).toBe("FX 2");
  });

  it("trims a padded name rather than rendering the padding", () => {
    expect(pillLabel("  Cave  ", 1)).toBe("Cave");
  });
});
