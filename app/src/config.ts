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

export const DEFAULT_A1_CHOICES: A1Device[] = [];

export const DRIVER_OPTIONS = ["asio", "wdm", "ks", "mme"] as const;

export const WHEEL_STEP_DB = 3.0;

/** Default meter decay speed (units/sec) when signal goes silent. ~3s from full to empty. */
export const DEFAULT_METER_DECAY = 0.3;
