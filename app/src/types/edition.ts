/** Voicemeeter edition as reported by the Rust backend (VBVMR_GetVoicemeeterType). */
export type Edition = "standard" | "banana" | "potato";

/** Which edition the "Launch Voicemeeter" button should start. */
export type LaunchEdition = "auto" | "banana" | "potato";

export interface StripInfo {
  index: number;
  label: string;
  isVirtual: boolean;
}

export interface BusInfo {
  index: number;
  label: string;
  isVirtual: boolean;
}

/** Mirrors `EditionInfo` in src-tauri/src/edition.rs. */
export interface EditionInfo {
  edition: Edition;
  stripCount: number;
  busCount: number;
  hwStripCount: number;
  hasFx: boolean;
  strips: StripInfo[];
  buses: BusInfo[];
}
