export interface ChannelConfig {
  label: string;
  strip: number;
  hasMute: boolean;
  minDb: number;
  maxDb: number;
  defaultDb: number;
  /** Multiplier for level meter display (default 1) */
  levelScale?: number;
  /** Global hotkey to toggle mute (Tauri accelerator format, e.g. "CmdOrCtrl+Shift+M") */
  muteHotkey?: string;
}

export interface A1Device {
  driver: string;
  name: string;
  display: string;
}

export const DEFAULT_CHANNELS: ChannelConfig[] = [
  { label: "Mic", strip: 0, hasMute: true, minDb: -30, maxDb: 9, defaultDb: 3 },
  { label: "VC", strip: 1, hasMute: false, minDb: -36, maxDb: 12, defaultDb: -6 },
  { label: "General", strip: 3, hasMute: false, minDb: -36, maxDb: 3, defaultDb: -12 },
  { label: "Music", strip: 4, hasMute: false, minDb: -45, maxDb: 3, defaultDb: -12 },
];

/** Kept for backwards compat — points to defaults */
export const CHANNELS = DEFAULT_CHANNELS;

/** Banana: strips 0-2 are hardware inputs, 3-4 are virtual inputs. */
export function isVirtualStrip(strip: number): boolean {
  return strip >= 3;
}

export type ModeKind = "mono" | "mc" | "karaoke";

/**
 * Banana: hardware strips (0-2) get a plain Mono toggle. Of the two virtual
 * strips, the first (General, strip 3) gets only the MC (mute-center, for
 * dialogue) on/off toggle; the second (Music, strip 4) gets only the 5-state
 * Karaoke cycle. These are two separate controls, not a combined cycle.
 */
export function modeKindFor(strip: number): ModeKind {
  if (strip === 3) return "mc";
  if (strip === 4) return "karaoke";
  return "mono";
}

/** Strip[i].K, 0-4 — the second virtual strip only. */
export const KARAOKE_LABELS = ["K", "K·M", "K·1", "K·2", "K·C"];

/** Voicemeeter Banana strip names */
export const STRIP_LABELS: Record<number, string> = {
  0: "Hardware Input 1",
  1: "Hardware Input 2",
  2: "Hardware Input 3",
  3: "Virtual Input 1",
  4: "Virtual Input 2",
};

export const DEFAULT_A1_CHOICES: A1Device[] = [];

export const DRIVER_OPTIONS = ["asio", "wdm", "ks", "mme"] as const;

export const WHEEL_STEP_DB = 3.0;

/** 0 dB — unity gain. Faders mark this position and double-click snaps to it. */
export const UNITY_DB = 0;

/** Default meter decay speed (units/sec) when signal goes silent. ~3s from full to empty. */
export const DEFAULT_METER_DECAY = 0.3;

/**
 * Smallest usable window size per control layout. Height alone differs
 * between modes (knobs need far less than faders); width is computed from
 * the channel count so shrinking never squeezes a column below its control's
 * own minimum size — see minWindowSizeFor() in App.tsx.
 */
export const FADER_MIN_HEIGHT = 360;
export const KNOB_MIN_HEIGHT = 290;
/** Wide enough for typical channel names (e.g. "GUITAR INPUT") at the uppercase/tracked label style, not just the bare control. */
export const FADER_COLUMN_MIN_WIDTH = 64;
export const KNOB_COLUMN_MIN_WIDTH = 130;
/**
 * Matches the channel row's px-[clamp(16px,...)] and gap-[clamp(8px,...)]
 * minimums in App.tsx. Padding must clear each column's own glow/box-shadow
 * (which extends past its box) or the window's rounded edge clips it.
 */
export const ROW_PADDING_MIN = 16;
export const ROW_GAP_MIN = 8;
/** Absolute floor — Tauri's own tauri.conf.json window minimum. */
export const WINDOW_MIN_WIDTH = 200;
