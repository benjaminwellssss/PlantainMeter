/**
 * Accelerator-string helpers shared by every hotkey recorder in Settings.
 *
 * Strings are in Tauri accelerator format ("CmdOrCtrl+Shift+Numpad1"), which is
 * what the Rust side parses with `tauri_plugin_global_shortcut::Shortcut`.
 */

export type ModName = "CmdOrCtrl" | "Shift" | "Alt";

/** Canonical modifier order, matching how accelerators are written. */
export const MOD_ORDER: ModName[] = ["CmdOrCtrl", "Shift", "Alt"];

export const MOD_LABEL: Record<ModName, string> = {
  CmdOrCtrl: "Ctrl",
  Shift: "Shift",
  Alt: "Alt",
};

/** Pretty names for keys whose raw token reads badly in the UI. */
const KEY_LABEL: Record<string, string> = {
  NumpadAdd: "Num +",
  NumpadSubtract: "Num -",
  NumpadMultiply: "Num *",
  NumpadDivide: "Num /",
  NumpadDecimal: "Num .",
  NumpadEnter: "Num Enter",
  NumpadEqual: "Num =",
};

export function formatKeyLabel(key: string): string {
  if (!key) return "None";
  if (KEY_LABEL[key]) return KEY_LABEL[key];
  const digit = /^Numpad(\d)$/.exec(key);
  return digit ? `Num ${digit[1]}` : key;
}

/** The subset of KeyboardEvent the helpers read, so tests can pass plain objects. */
export type KeyLike = Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">;

/**
 * Extract the key token from a KeyboardEvent.
 *
 * Numpad keys MUST come from e.code. e.key reports "1" with NumLock on (which
 * parses as Digit1, the main-row key) and "End" with NumLock off — so using
 * e.key binds the wrong physical key either way. The e.code values
 * (Numpad0-9, NumpadAdd, NumpadEnter, ...) are exactly the tokens
 * global-hotkey's parser accepts.
 */
export function eventToKeyToken(e: KeyLike): string | null {
  if (e.code.startsWith("Numpad")) return e.code;

  let key = e.key;
  if (key === " ") key = "Space";
  else if (key.length === 1) key = key.toUpperCase();
  else if (key === "ArrowUp") key = "Up";
  else if (key === "ArrowDown") key = "Down";
  else if (key === "ArrowLeft") key = "Left";
  else if (key === "ArrowRight") key = "Right";
  // F1-F24, Escape, Tab, etc. are already correct casing from e.key
  return key || null;
}

/** Split an accelerator into its modifiers and key. */
export function parseHotkey(accel: string): { mods: ModName[]; key: string } {
  const mods: ModName[] = [];
  let key = "";
  for (const raw of (accel || "").split("+")) {
    const part = raw.trim();
    if (!part) continue;
    if (part === "CmdOrCtrl" || part === "Ctrl" || part === "Control") {
      if (!mods.includes("CmdOrCtrl")) mods.push("CmdOrCtrl");
    } else if (part === "Shift") {
      if (!mods.includes("Shift")) mods.push("Shift");
    } else if (part === "Alt" || part === "Option") {
      if (!mods.includes("Alt")) mods.push("Alt");
    } else {
      key = part;
    }
  }
  return { mods, key };
}

/** Recombine modifiers and key. A modifier alone is not a valid hotkey. */
export function buildHotkey(mods: ModName[], key: string): string {
  if (!key) return "";
  return [...MOD_ORDER.filter((m) => mods.includes(m)), key].join("+");
}

/** Convert a KeyboardEvent into a Tauri accelerator string. */
export function keyEventToAccelerator(e: KeyLike): string | null {
  // Ignore lone modifier presses
  if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return null;

  const key = eventToKeyToken(e);
  if (!key) return null;

  const mods: ModName[] = [];
  if (e.ctrlKey || e.metaKey) mods.push("CmdOrCtrl");
  if (e.shiftKey) mods.push("Shift");
  if (e.altKey) mods.push("Alt");

  return buildHotkey(mods, key);
}

/**
 * Accelerator for a freshly recorded key press, honoring modifiers the user
 * toggled on before recording. Those are merged with the modifiers actually
 * held down, so pre-picking Ctrl and then tapping M yields Ctrl+M.
 */
export function recordHotkey(e: KeyLike, pending: ModName[]): string | null {
  const accel = keyEventToAccelerator(e);
  if (!accel) return null;
  const { mods, key } = parseHotkey(accel);
  return buildHotkey([...pending, ...mods], key);
}

/** Human-readable form of a full accelerator, e.g. "Ctrl+Shift+Num 1". */
export function formatHotkey(accel: string): string {
  const { mods, key } = parseHotkey(accel);
  if (!key) return "";
  return [...mods.map((m) => MOD_LABEL[m]), formatKeyLabel(key)].join("+");
}
