import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { FxGroup, FxStatePayload } from "../types/fx";
import { migrateFxGroups } from "../lib/fxGroups";
import { readKey, writeKey } from "../lib/settingsStore";

const FX_GROUPS_KEY = "fxGroups";

/**
 * Persisted FX groups plus the live "which are active" set, which lives in
 * Rust (hotkeys fire there) and is mirrored here via `vm:fx-state`.
 */
export function useFxGroups(connected: boolean) {
  const [groups, setGroups] = useState<FxGroup[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [active, setActive] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const raw = await readKey<unknown>(FX_GROUPS_KEY, []);
      if (cancelled) return;
      setGroups(migrateFxGroups(raw));
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const unlisten = listen<FxStatePayload>("vm:fx-state", (event) => {
      if (!cancelled) setActive(event.payload.active);
    });
    // Catch up with whatever Rust already knows (e.g. after a hot reload).
    invoke<FxStatePayload>("vm_get_fx_state")
      .then((s) => { if (!cancelled) setActive(s.active); })
      .catch(() => {});
    return () => {
      cancelled = true;
      unlisten.then((fn) => fn());
    };
  }, []);

  // Rust forgets its snapshots when the engine drops; mirror that immediately
  // rather than waiting for the event so the bar never shows stale pills.
  useEffect(() => {
    if (!connected) setActive([]);
  }, [connected]);

  const saveFxGroups = useCallback((next: FxGroup[]) => {
    setGroups(next);
    writeKey(FX_GROUPS_KEY, next);
  }, []);

  const toggleGroup = useCallback(async (id: string) => {
    try {
      const state = await invoke<FxStatePayload>("vm_toggle_fx_group", { id });
      setActive(state.active);
    } catch (e) {
      console.warn("FX group toggle failed:", e);
    }
  }, []);

  return { groups, loaded, active, saveFxGroups, toggleGroup };
}
