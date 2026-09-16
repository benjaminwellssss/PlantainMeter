import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AppEndpoint, AppSessionsPayload, AppLevelsPayload } from "../types/appSessions";

/**
 * Windows audio sessions playing into Voicemeeter's virtual inputs.
 *
 * While `enabled`, the Rust worker pushes `vm:app-sessions` (~1 Hz, full list)
 * and `vm:app-levels` (~15 Hz, peaks only). Disabling stops the worker's loop
 * so a closed panel costs nothing.
 */
export function useAppSessions(enabled: boolean) {
  const [endpoints, setEndpoints] = useState<AppEndpoint[]>([]);
  const [levels, setLevels] = useState<Map<string, number>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Sessions whose slider is mid-drag: incoming volumes must not fight the thumb.
  const dragging = useRef<Set<string>>(new Set());

  const applyEndpoints = useCallback((next: AppEndpoint[]) => {
    setEndpoints((prev) => {
      if (dragging.current.size === 0) return next;
      const prevByKey = new Map(prev.flatMap((e) => e.sessions).map((s) => [s.key, s]));
      return next.map((e) => ({
        ...e,
        sessions: e.sessions.map((s) => {
          const old = prevByKey.get(s.key);
          return dragging.current.has(s.key) && old ? { ...s, volume: old.volume } : s;
        }),
      }));
    });
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setError(null);

    invoke<AppSessionsPayload>("vm_list_app_sessions")
      .then((p) => {
        if (cancelled) return;
        applyEndpoints(p.endpoints);
        setLoaded(true);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(String(e));
          setLoaded(true);
        }
      });
    invoke("vm_set_app_polling", { enabled: true }).catch(() => {});

    const unlistenSessions = listen<AppSessionsPayload>("vm:app-sessions", (event) => {
      if (!cancelled) applyEndpoints(event.payload.endpoints);
    });
    const unlistenLevels = listen<AppLevelsPayload>("vm:app-levels", (event) => {
      if (cancelled) return;
      setLevels(new Map(event.payload.levels.map((l) => [l.key, l.peak])));
    });

    return () => {
      cancelled = true;
      invoke("vm_set_app_polling", { enabled: false }).catch(() => {});
      unlistenSessions.then((fn) => fn());
      unlistenLevels.then((fn) => fn());
      setLevels(new Map());
    };
  }, [enabled, applyEndpoints]);

  const patchSession = (key: string, patch: { volume?: number; muted?: boolean }) => {
    setEndpoints((prev) =>
      prev.map((e) => ({
        ...e,
        sessions: e.sessions.map((s) => (s.key === key ? { ...s, ...patch } : s)),
      })),
    );
  };

  const setVolume = useCallback(async (key: string, volume: number) => {
    patchSession(key, { volume });
    try {
      await invoke("vm_set_app_volume", { key, volume });
    } catch {
      // The next session push corrects the optimistic value.
    }
  }, []);

  const setMute = useCallback(async (key: string, muted: boolean) => {
    patchSession(key, { muted });
    try {
      await invoke("vm_set_app_mute", { key, muted });
    } catch {
      // As above.
    }
  }, []);

  const startDragging = useCallback((key: string) => {
    dragging.current.add(key);
  }, []);

  const stopDragging = useCallback((key: string) => {
    dragging.current.delete(key);
  }, []);

  return { endpoints, levels, error, loaded, setVolume, setMute, startDragging, stopDragging };
}
