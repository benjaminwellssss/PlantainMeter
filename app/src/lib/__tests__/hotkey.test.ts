import { describe, it, expect } from "vitest";
import {
  parseHotkey,
  buildHotkey,
  keyEventToAccelerator,
  formatKeyLabel,
  formatHotkey,
  type KeyLike,
} from "../hotkey";

const ev = (partial: Partial<KeyLike>): KeyLike => ({
  key: "",
  code: "",
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...partial,
});

describe("parseHotkey / buildHotkey", () => {
  it("round-trips a full accelerator", () => {
    const { mods, key } = parseHotkey("CmdOrCtrl+Shift+Numpad1");
    expect(mods).toEqual(["CmdOrCtrl", "Shift"]);
    expect(key).toBe("Numpad1");
    expect(buildHotkey(mods, key)).toBe("CmdOrCtrl+Shift+Numpad1");
  });

  it("normalizes modifier order and aliases", () => {
    const { mods, key } = parseHotkey("Alt+Ctrl+F5");
    expect(buildHotkey(mods, key)).toBe("CmdOrCtrl+Alt+F5");
  });

  it("refuses a modifier-only hotkey", () => {
    expect(buildHotkey(["Shift"], "")).toBe("");
    expect(parseHotkey("").key).toBe("");
  });
});

describe("keyEventToAccelerator", () => {
  it("prefers e.code for numpad keys regardless of NumLock", () => {
    expect(keyEventToAccelerator(ev({ key: "1", code: "Numpad1" }))).toBe("Numpad1");
    expect(keyEventToAccelerator(ev({ key: "End", code: "Numpad1" }))).toBe("Numpad1");
  });

  it("uppercases single characters and adds modifiers", () => {
    expect(keyEventToAccelerator(ev({ key: "m", code: "KeyM", ctrlKey: true, shiftKey: true }))).toBe(
      "CmdOrCtrl+Shift+M",
    );
  });

  it("ignores lone modifier presses", () => {
    expect(keyEventToAccelerator(ev({ key: "Shift", code: "ShiftLeft", shiftKey: true }))).toBeNull();
  });

  it("maps arrows and space", () => {
    expect(keyEventToAccelerator(ev({ key: "ArrowUp", code: "ArrowUp" }))).toBe("Up");
    expect(keyEventToAccelerator(ev({ key: " ", code: "Space", altKey: true }))).toBe("Alt+Space");
  });
});

describe("labels", () => {
  it("prettifies numpad tokens", () => {
    expect(formatKeyLabel("Numpad7")).toBe("Num 7");
    expect(formatKeyLabel("NumpadAdd")).toBe("Num +");
    expect(formatKeyLabel("")).toBe("None");
  });

  it("formats a whole hotkey", () => {
    expect(formatHotkey("CmdOrCtrl+Shift+Numpad1")).toBe("Ctrl+Shift+Num 1");
    expect(formatHotkey("")).toBe("");
  });
});
