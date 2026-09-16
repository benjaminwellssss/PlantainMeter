import type { Edition, EditionInfo, StripInfo, BusInfo } from "../types/edition";

/**
 * Fallback layout tables for when Voicemeeter is not reachable and nothing has
 * been persisted yet. The live tables come from Rust (`EditionInfo`); these must
 * stay in step with `edition.rs`.
 */
interface EditionShape {
  hwStrips: number;
  virtualStrips: number;
  hwBuses: number;
  virtualBuses: number;
}

const SHAPES: Record<Edition, EditionShape> = {
  standard: { hwStrips: 2, virtualStrips: 1, hwBuses: 1, virtualBuses: 1 },
  banana: { hwStrips: 3, virtualStrips: 2, hwBuses: 3, virtualBuses: 2 },
  potato: { hwStrips: 5, virtualStrips: 3, hwBuses: 5, virtualBuses: 3 },
};

const VIRTUAL_LABELS = ["Virtual Input", "Virtual Input AUX", "VAIO3"];

export const EDITION_NAMES: Record<Edition, string> = {
  standard: "Voicemeeter",
  banana: "Banana",
  potato: "Potato",
};

function buildInfo(edition: Edition): EditionInfo {
  const shape = SHAPES[edition];
  const stripCount = shape.hwStrips + shape.virtualStrips;
  const busCount = shape.hwBuses + shape.virtualBuses;
  const strips: StripInfo[] = [];
  for (let i = 0; i < stripCount; i++) {
    const isVirtual = i >= shape.hwStrips;
    strips.push({
      index: i,
      label: isVirtual ? VIRTUAL_LABELS[i - shape.hwStrips] : `Hardware Input ${i + 1}`,
      isVirtual,
    });
  }
  const buses: BusInfo[] = [];
  for (let i = 0; i < busCount; i++) {
    const isVirtual = i >= shape.hwBuses;
    buses.push({
      index: i,
      label: isVirtual ? `B${i - shape.hwBuses + 1}` : `A${i + 1}`,
      isVirtual,
    });
  }
  return {
    edition,
    stripCount,
    busCount,
    hwStripCount: shape.hwStrips,
    hasFx: edition === "potato",
    strips,
    buses,
  };
}

export const EDITION_DEFAULTS: Record<Edition, EditionInfo> = {
  standard: buildInfo("standard"),
  banana: buildInfo("banana"),
  potato: buildInfo("potato"),
};

/** Label for a strip, falling back to a generic name for out-of-range indices. */
export function stripLabel(info: EditionInfo, strip: number): string {
  return info.strips[strip]?.label ?? `Strip ${strip}`;
}

/** Short label used as the default channel name when adding a channel. */
export function shortStripLabel(info: EditionInfo, strip: number): string {
  const s = info.strips[strip];
  if (!s) return `Strip ${strip}`;
  if (!s.isVirtual) return `HW ${strip + 1}`;
  return s.label.replace("Virtual Input AUX", "AUX").replace("Virtual Input", "Virtual");
}
