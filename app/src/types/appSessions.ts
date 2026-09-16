/** Mirrors the payloads in src-tauri/src/app_sessions.rs. */

export type AppEndpointKind = "vaio" | "aux" | "vaio3" | "hw";

export interface AppSession {
  /** Windows audio session instance identifier — stable across polls. */
  key: string;
  pid: number;
  /** Executable stem, e.g. "Spotify". */
  process: string;
  /** Best display name we could find (session display name, else process). */
  display: string;
  /** PNG data URL of the executable's icon, or null. */
  icon: string | null;
  /** Windows' own "System sounds" session. */
  system: boolean;
  /** 0..1 */
  volume: number;
  muted: boolean;
  state: "active" | "inactive";
  /** 0..1 */
  peak: number;
}

export interface AppEndpoint {
  /** Windows friendly name, e.g. "Voicemeeter Input (VB-Audio Voicemeeter VAIO)". */
  endpoint: string;
  kind: AppEndpointKind;
  /** Voicemeeter strip this endpoint feeds, or null if the running edition has none. */
  strip: number | null;
  sessions: AppSession[];
}

export interface AppSessionsPayload {
  endpoints: AppEndpoint[];
}

export interface AppLevelsPayload {
  levels: { key: string; peak: number }[];
}
