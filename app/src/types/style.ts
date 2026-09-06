export type AccentSource = "system" | "custom";

/** How channel gain controls are drawn — vertical faders or compact rotary knobs. */
export type ControlMode = "fader" | "knob";

/** A named window size the user can snap to from the titlebar. */
export interface WindowPreset {
  name: string;
  width: number;
  height: number;
}

export type BackgroundMode = "solid" | "acrylic" | "visualizer";

export type UnfocusedVisualizerMode = "animated" | "paused";

export type VisualizerColorSource = "accent" | "custom";

export type VisualizerPreset =
  | "xmb-smoke"
  | "starfield"
  | "matrix-rain"
  | "gradient-mesh"
  | "noise-flow"
  | "geometric-pulse";

export interface BackgroundStyle {
  backgroundMode: BackgroundMode;
  backgroundColor: string;
  backgroundOpacity: number;
  visualizerPreset: VisualizerPreset;
  visualizerOpacity: number;
  visualizerIntensity: number;
  visualizerColorSource: VisualizerColorSource;
  visualizerColor: string;
  unfocusedVisualizerMode: UnfocusedVisualizerMode;
}

export interface StyleSettings {
  accentSource: AccentSource;
  customAccentColor: string;
  faderColumnWidth: number;
  /** Toggled by the titlebar fader/knob switch. */
  controlMode: ControlMode;
  background: BackgroundStyle;
  showOutputLevel: boolean;
  /** Keep the window above other windows. Toggled by the titlebar pin. */
  alwaysOnTop: boolean;
  /** Disable manual window resizing. Toggled by the titlebar lock. */
  sizeLocked: boolean;
  /** Opacity of the entire window, chrome and backdrop included (0.2 - 1). */
  globalOpacity: number;
  /** Named window sizes, reachable by right-clicking the minimize button. */
  windowPresets: WindowPreset[];
}

/** Sized against the 200x275 minimum in tauri.conf.json. */
export const DEFAULT_WINDOW_PRESETS: WindowPreset[] = [
  { name: "Compact", width: 220, height: 300 },
  { name: "Default", width: 420, height: 340 },
  { name: "Tall", width: 420, height: 560 },
];

export const DEFAULT_BACKGROUND_STYLE: BackgroundStyle = {
  backgroundMode: "acrylic",
  backgroundColor: "#1e1e1e",
  backgroundOpacity: 1,
  visualizerPreset: "xmb-smoke",
  visualizerOpacity: 0.4,
  visualizerIntensity: 0.5,
  visualizerColorSource: "accent",
  visualizerColor: "#3a86ff",
  unfocusedVisualizerMode: "paused",
};

export const DEFAULT_STYLE_SETTINGS: StyleSettings = {
  accentSource: "system",
  customAccentColor: "#3a86ff",
  faderColumnWidth: 0,
  controlMode: "fader",
  background: { ...DEFAULT_BACKGROUND_STYLE },
  showOutputLevel: false,
  alwaysOnTop: false,
  sizeLocked: false,
  globalOpacity: 1,
  windowPresets: [...DEFAULT_WINDOW_PRESETS],
};
