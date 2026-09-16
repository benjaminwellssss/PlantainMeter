/** One Voicemeeter parameter an FX group sets, e.g. `Strip[0].Reverb` = 6. */
export interface FxAssignment {
  param: string;
  value: number;
}

/** A named preset bundle toggled by a hotkey or a click. Mirrors fx.rs. */
export interface FxGroup {
  id: string;
  name: string;
  hotkey?: string;
  assignments: FxAssignment[];
}

/** Payload of the `vm:fx-state` event: active group ids in activation order. */
export interface FxStatePayload {
  active: string[];
}

/** One entry for `vm_sync_shortcuts`. Mirrors `HotkeyBinding` in hotkeys.rs. */
export type HotkeyAction =
  | { type: "toggleMute"; strip: number }
  | { type: "toggleFxGroup"; id: string };

export interface HotkeyBinding {
  hotkey: string;
  action: HotkeyAction;
}
