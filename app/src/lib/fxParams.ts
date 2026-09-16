import type { FxAssignment } from "../types/fx";
import type { EditionInfo } from "../types/edition";
import type { ChannelConfig } from "../config";

/**
 * Catalog of the Voicemeeter Potato FX parameters an FX group may set.
 * Names and ranges come from the Remote API documentation (v3.1.0.1).
 */
export type FxTarget = "strip" | "bus" | "global";
export type FxControl = "send" | "toggle" | "ab";

export interface FxParamDef {
  /** Stable key used by the UI, e.g. "strip.reverb". */
  key: string;
  label: string;
  target: FxTarget;
  control: FxControl;
  min: number;
  max: number;
  step: number;
  /** Build the Voicemeeter parameter path. `index` is required for strip/bus. */
  path: (index?: number) => string;
}

const send = (key: string, label: string, target: FxTarget, name: string): FxParamDef => ({
  key,
  label,
  target,
  control: "send",
  min: 0,
  max: 10,
  step: 0.1,
  path: (i) => `${target === "strip" ? "Strip" : "Bus"}[${i ?? 0}].${name}`,
});

const stripToggle = (key: string, label: string, name: string): FxParamDef => ({
  key,
  label,
  target: "strip",
  control: "toggle",
  min: 0,
  max: 1,
  step: 1,
  path: (i) => `Strip[${i ?? 0}].${name}`,
});

const global = (key: string, label: string, control: FxControl, name: string): FxParamDef => ({
  key,
  label,
  target: "global",
  control,
  min: 0,
  max: 1,
  step: 1,
  path: () => `Fx.${name}`,
});

export const FX_PARAMS: FxParamDef[] = [
  // Strip sends
  send("strip.reverb", "Reverb send", "strip", "Reverb"),
  send("strip.delay", "Delay send", "strip", "Delay"),
  send("strip.fx1", "FX1 send", "strip", "Fx1"),
  send("strip.fx2", "FX2 send", "strip", "Fx2"),
  stripToggle("strip.postReverb", "Post-fader reverb", "PostReverb"),
  stripToggle("strip.postDelay", "Post-fader delay", "PostDelay"),
  stripToggle("strip.postFx1", "Post-fader FX1", "PostFx1"),
  stripToggle("strip.postFx2", "Post-fader FX2", "PostFx2"),
  // Bus returns
  send("bus.returnReverb", "Reverb return", "bus", "ReturnReverb"),
  send("bus.returnDelay", "Delay return", "bus", "ReturnDelay"),
  send("bus.returnFx1", "FX1 return", "bus", "ReturnFx1"),
  send("bus.returnFx2", "FX2 return", "bus", "ReturnFx2"),
  // Master FX section
  global("fx.reverbOn", "Reverb", "toggle", "Reverb.On"),
  global("fx.reverbAB", "Reverb preset", "ab", "Reverb.AB"),
  global("fx.delayOn", "Delay", "toggle", "Delay.On"),
  global("fx.delayAB", "Delay preset", "ab", "Delay.AB"),
];

export const FX_TARGET_LABEL: Record<FxTarget, string> = {
  global: "Master FX",
  strip: "Strip",
  bus: "Bus",
};

export function paramsForTarget(target: FxTarget): FxParamDef[] {
  return FX_PARAMS.filter((p) => p.target === target);
}

export function findParam(key: string): FxParamDef | undefined {
  return FX_PARAMS.find((p) => p.key === key);
}

/** Reverse of `def.path(index)`: recover the catalog entry from a saved path. */
export function parseParamPath(path: string): { def: FxParamDef; index?: number } | null {
  const indexed = /^(Strip|Bus)\[(\d+)\]\.(\w+)$/.exec(path);
  if (indexed) {
    const index = Number(indexed[2]);
    const def = FX_PARAMS.find((p) => p.path(index) === path);
    return def ? { def, index } : null;
  }
  const def = FX_PARAMS.find((p) => p.target === "global" && p.path() === path);
  return def ? { def } : null;
}

export function clampValue(def: FxParamDef, value: number): number {
  if (!Number.isFinite(value)) return def.min;
  return Math.min(def.max, Math.max(def.min, value));
}

/** Sensible starting value when a new assignment is created. */
export function defaultValue(def: FxParamDef): number {
  switch (def.control) {
    case "send":
      return 5;
    case "toggle":
      return 1;
    case "ab":
      return 0;
  }
}

export function formatValue(def: FxParamDef, value: number): string {
  switch (def.control) {
    case "send":
      return value.toFixed(1);
    case "toggle":
      return value >= 0.5 ? "on" : "off";
    case "ab":
      return value >= 0.5 ? "B" : "A";
  }
}

/** Name for a strip or bus target: the user's channel label if configured. */
export function targetName(
  def: FxParamDef,
  index: number | undefined,
  edition: EditionInfo,
  channels: ChannelConfig[],
): string {
  if (def.target === "global") return FX_TARGET_LABEL.global;
  if (def.target === "strip") {
    const ch = channels.find((c) => c.strip === index);
    return ch?.label ?? edition.strips[index ?? -1]?.label ?? `Strip ${index}`;
  }
  return `Bus ${edition.buses[index ?? -1]?.label ?? index}`;
}

/** One-line summary of an assignment, e.g. "Mic → Reverb send 6.0". */
export function describeAssignment(
  a: FxAssignment,
  edition: EditionInfo,
  channels: ChannelConfig[],
): string {
  const parsed = parseParamPath(a.param);
  if (!parsed) return `${a.param} = ${a.value}`;
  const { def, index } = parsed;
  return `${targetName(def, index, edition, channels)} → ${def.label} ${formatValue(def, a.value)}`;
}
