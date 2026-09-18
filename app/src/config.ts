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

/**
 * Which Voicemeeter edition is actually running, as reported by the backend
 * (VBVMR_GetVoicemeeterType). Strip/bus counts differ per edition — this
 * drives every place that used to assume Potato's layout, so Plantain works
 * unmodified against Banana too. `null` = not yet known (before first
 * connect); callers fall back to Potato's layout (the superset) in that case,
 * same as the Rust side.
 */
export type VoicemeeterEdition = "standard" | "banana" | "potato";

/** (hardware, virtual) input-strip counts — mirrors VoicemeeterEdition::strip_counts in Rust. */
export const STRIP_COUNTS: Record<VoicemeeterEdition, { hw: number; virtual: number }> = {
  standard: { hw: 2, virtual: 1 },
  banana: { hw: 3, virtual: 2 },
  potato: { hw: 5, virtual: 3 },
};

/** Every input strip index for the given edition, hardware then virtual. */
export function availableStripsFor(edition: VoicemeeterEdition): number[] {
  const { hw, virtual } = STRIP_COUNTS[edition];
  return Array.from({ length: hw + virtual }, (_, i) => i);
}

/**
 * Default 4-channel layout for a fresh install: the first two hardware
 * strips (Mic/VC), then the first two virtual strips (General/Music) —
 * whichever strip indices those land on for this edition. Potato's virtual
 * strips start at 5, Banana's at 3, Standard's at 2.
 */
export function defaultChannelsFor(edition: VoicemeeterEdition): ChannelConfig[] {
  const { hw } = STRIP_COUNTS[edition];
  return [
    { label: "Mic", strip: 0, hasMute: true, minDb: -30, maxDb: 9, defaultDb: 3 },
    { label: "VC", strip: 1, hasMute: false, minDb: -36, maxDb: 12, defaultDb: -6 },
    { label: "General", strip: hw, hasMute: false, minDb: -36, maxDb: 3, defaultDb: -12 },
    { label: "Music", strip: hw + 1, hasMute: false, minDb: -45, maxDb: 3, defaultDb: -12 },
  ];
}

/** Kept for callers that need a layout before the edition is known — Potato's. */
export const DEFAULT_CHANNELS: ChannelConfig[] = defaultChannelsFor("potato");

/** Kept for backwards compat — points to defaults */
export const CHANNELS = DEFAULT_CHANNELS;

export type ModeKind = "mono" | "mc" | "karaoke";

/**
 * Hardware strips get a plain Mono toggle. Of the edition's virtual strips,
 * the first gets only the MC (mute-center, for dialogue) on/off toggle; the
 * second gets only the 5-state Karaoke cycle. These are two separate
 * controls, not a combined cycle. Any further virtual strip (Potato's third)
 * isn't assigned a role yet, so it falls back to the plain Mono toggle.
 * Computed from the edition's hardware-strip count rather than hardcoded
 * indices, so it's correct on Banana (virtual strips start at 3) and
 * Standard (start at 2) as well as Potato (start at 5).
 */
export function modeKindFor(strip: number, edition: VoicemeeterEdition = "potato"): ModeKind {
  const { hw } = STRIP_COUNTS[edition];
  const virtualIndex = strip - hw;
  if (virtualIndex === 0) return "mc";
  if (virtualIndex === 1) return "karaoke";
  return "mono";
}

/** Strip[i].K, 0-4 — virtual strips only. */
export const KARAOKE_LABELS = ["K", "K·M", "K·1", "K·2", "K·C"];

/** Human-readable strip names for the given edition's layout. */
export function stripLabelsFor(edition: VoicemeeterEdition): Record<number, string> {
  const { hw, virtual } = STRIP_COUNTS[edition];
  const labels: Record<number, string> = {};
  for (let i = 0; i < hw; i++) labels[i] = `Hardware Input ${i + 1}`;
  for (let i = 0; i < virtual; i++) labels[hw + i] = `Virtual Input ${i + 1}`;
  return labels;
}

/** Kept for callers that need labels before the edition is known — Potato's. */
export const STRIP_LABELS: Record<number, string> = stripLabelsFor("potato");

export const DEFAULT_A1_CHOICES: A1Device[] = [];

export const DRIVER_OPTIONS = ["asio", "wdm", "ks", "mme"] as const;

export const WHEEL_STEP_DB = 3.0;

/**
 * Fraction of the fader/knob travel (measured from the max/top end) where
 * 0 dB sits — fixed the same for every channel, regardless of that channel's
 * own min/max range. A real mixer's unity mark lines up across every channel
 * because every channel has the *same* physical range; ours lets each
 * channel have its own min/max, so a plain linear (value-min)/(max-min)
 * mapping put 0 dB at a different relative position on every fader/knob.
 * dbToNorm/normToDb use a two-segment (piecewise-linear) scale instead —
 * different slope above vs below 0 dB — so unity always lands here.
 */
export const UNITY_POSITION: number = 0.25;

/**
 * Converts a dB value to a normalized 0..1 position, where 0 = the max end
 * and 1 = the min end (Fader's convention — Knob inverts this itself).
 * 0 dB always maps to exactly UNITY_POSITION, regardless of min/max, as
 * long as 0 actually falls within [min, max] (otherwise it degenerates to
 * a plain linear map across the whole range).
 */
export function dbToNorm(value: number, min: number, max: number): number {
  const unity = Math.max(min, Math.min(max, UNITY_DB));
  if (value >= unity) {
    if (max === unity) return 0;
    return ((max - value) / (max - unity)) * UNITY_POSITION;
  }
  if (unity === min) return UNITY_POSITION;
  return UNITY_POSITION + ((unity - value) / (unity - min)) * (1 - UNITY_POSITION);
}

/** Inverse of dbToNorm. */
export function normToDb(norm: number, min: number, max: number): number {
  const unity = Math.max(min, Math.min(max, UNITY_DB));
  const clamped = Math.max(0, Math.min(1, norm));
  if (clamped <= UNITY_POSITION) {
    if (UNITY_POSITION === 0) return max;
    return max - (clamped / UNITY_POSITION) * (max - unity);
  }
  if (UNITY_POSITION === 1) return unity;
  return unity - ((clamped - UNITY_POSITION) / (1 - UNITY_POSITION)) * (unity - min);
}

/** 0 dB — unity gain. Faders mark this position and double-click snaps to it. */
export const UNITY_DB = 0;

/** Default meter decay speed (units/sec) when signal goes silent. ~3s from full to empty. */
export const DEFAULT_METER_DECAY = 0.3;

/**
 * The whole channel row is one proportional system built from a single
 * "unit" — one control's width (see useControlUnit). Left/right margins and
 * the gap between controls equal `gapMultiplier`/`marginMultiplier` units
 * (adjustable via the titlebar sliders, default 0.5 and 1) — that ratio was
 * tuned against *several controls side by side*, so it looks right. Applying
 * the same absolute unit to the top/bottom margin looked wrong in practice:
 * a single control's height is nowhere near the combined width of a whole
 * row, so it read as a huge empty band. VERTICAL_MARGIN_RATIO scales the
 * vertical margin down relative to the horizontal one instead of 1:1.
 */
export const FADER_UNIT_MIN = 46;
export const FADER_UNIT_MAX = 100;
export const KNOB_UNIT_MIN = 56;
export const KNOB_UNIT_MAX = 160;
/** Vertical margin (top+bottom) = horizontal margin * this ratio. */
export const VERTICAL_MARGIN_RATIO = 0.5;

/**
 * Natural height of everything inside a column *other than* the top/bottom
 * margins (handled separately, scaled by VERTICAL_MARGIN_RATIO) — label,
 * card padding, the control itself at its minimum unit size, the mode/solo
 * row, and Mute. Faders additionally need a usable minimum track length.
 */
export const FADER_CONTENT_MIN_HEIGHT = 168;
export const KNOB_CONTENT_MIN_HEIGHT = 140;

/**
 * Extra height reserved below the control for FxBox (Reverb/Delay macro
 * buttons) — only added to the window's minimum height when the running
 * edition actually has an FX section (Banana/Potato), see App.tsx.
 */
export const FX_BOX_MIN_HEIGHT = 32;

/** Rendered heights outside the channel row, for the window min-height calc. */
export const TITLEBAR_HEIGHT = 24;
export const SPACING_BAR_HEIGHT = 16;
export const BOTTOM_BAR_HEIGHT = 2;

/** Absolute floor, matching Tauri's own tauri.conf.json window minimum. */
export const WINDOW_MIN_WIDTH = 200;
