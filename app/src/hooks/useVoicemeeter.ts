import { useEffect, useRef, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ChannelConfig } from "../config";
import type { EditionInfo, LaunchEdition } from "../types/edition";

interface StripState {
  strip: number;
  gain: number;
  muted: boolean;
}

interface AllStripsState {
  strips: StripState[];
}

interface StripLevel {
  strip: number;
  level: number;
}

interface AllStripLevels {
  levels: StripLevel[];
}

interface BusLevel {
  bus: number;
  level: number;
  gain: number;
}

interface AllBusLevels {
  levels: BusLevel[];
}

/** Payload of the `vm:connection` event emitted by the Rust polling thread. */
type VmConnectionPayload =
  | { state: "connected"; edition: EditionInfo }
  | { state: "waiting" };

/**
 * - `connecting` — the very first login attempt is still in flight
 * - `waiting`    — logged in, but Voicemeeter isn't running or the engine is restarting
 * - `connected`  — engine reachable
 * - `error`      — hard failure (e.g. the Voicemeeter DLL is missing)
 */
export type ConnectionState = "connecting" | "waiting" | "connected" | "error";

export interface ChannelState {
  gain: number;
  muted: boolean;
}

/** How long to wait before retrying after a hard login failure. */
const ERROR_RETRY_MS = 3000;

export function useVoicemeeter(channelConfigs: ChannelConfig[]) {
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [error, setError] = useState<string | null>(null);
  // Once we've been live, a drop is a transient reconnect rather than a cold start,
  // and the UI should stay usable instead of throwing up a full-screen gate.
  const [everConnected, setEverConnected] = useState(false);
  // Edition reported by the backend while connected; null until then.
  const [liveEdition, setLiveEdition] = useState<EditionInfo | null>(null);

  const [channels, setChannels] = useState<Map<number, ChannelState>>(() => {
    const map = new Map<number, ChannelState>();
    for (const ch of channelConfigs) {
      map.set(ch.strip, { gain: ch.defaultDb, muted: false });
    }
    return map;
  });

  const [levels, setLevels] = useState<Map<number, number>>(() => {
    const map = new Map<number, number>();
    for (const ch of channelConfigs) {
      map.set(ch.strip, 0);
    }
    return map;
  });

  const [busLevels, setBusLevels] = useState<Map<number, number>>(new Map());
  const [busGains, setBusGains] = useState<Map<number, number>>(new Map());

  // Track which strips are being actively dragged to avoid overwriting
  const dragging = useRef<Set<number>>(new Set());

  const applyStrips = useCallback((strips: StripState[]) => {
    setChannels((prev) => {
      const next = new Map(prev);
      for (const s of strips) {
        // Don't overwrite a strip the user is currently dragging
        if (!dragging.current.has(s.strip)) {
          next.set(s.strip, { gain: s.gain, muted: s.muted });
        }
      }
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;

    const markConnected = (edition: EditionInfo) => {
      if (cancelled) return;
      setLiveEdition(edition);
      setConnection("connected");
      setEverConnected(true);
      setError(null);
    };

    async function attempt() {
      try {
        const status = await invoke<VmConnectionPayload>("vm_login");
        if (cancelled) return;
        setError(null);

        if (status.state === "connected") {
          markConnected(status.edition);
          const state = await invoke<AllStripsState>("vm_get_all_strips");
          if (cancelled) return;
          applyStrips(state.strips);
        } else {
          // Not a failure: Voicemeeter isn't up yet. The Rust poller stays alive
          // and will emit `vm:connection` the moment the engine appears, so there
          // is nothing to retry from here.
          setConnection("waiting");
        }
      } catch (e) {
        if (cancelled) return;
        setError(String(e));
        setConnection("error");
        // No API handle means no poller, so nothing else can recover. Retry slowly.
        retryTimer = window.setTimeout(attempt, ERROR_RETRY_MS);
      }
    }

    attempt();

    const unlistenConn = listen<VmConnectionPayload>("vm:connection", (event) => {
      if (cancelled) return;
      if (event.payload.state === "connected") {
        markConnected(event.payload.edition);
        // Resync gains/mutes — they may have changed while we were disconnected
        // (an engine restart re-reads Voicemeeter's own config).
        invoke<AllStripsState>("vm_get_all_strips")
          .then((state) => { if (!cancelled) applyStrips(state.strips); })
          .catch(() => {});
      } else {
        setConnection("waiting");
      }
    });

    const unlisten = listen<AllStripsState>("vm:state-update", (event) => {
      applyStrips(event.payload.strips);
    });

    const unlistenLevels = listen<AllStripLevels>("vm:levels", (event) => {
      setLevels((prev) => {
        const next = new Map(prev);
        for (const l of event.payload.levels) {
          next.set(l.strip, l.level);
        }
        return next;
      });
    });

    const unlistenBusLevels = listen<AllBusLevels>("vm:bus-levels", (event) => {
      setBusLevels((prev) => {
        const next = new Map(prev);
        for (const l of event.payload.levels) {
          next.set(l.bus, l.level);
        }
        return next;
      });
      setBusGains((prev) => {
        const next = new Map(prev);
        for (const l of event.payload.levels) {
          next.set(l.bus, l.gain);
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      unlistenConn.then((fn) => fn());
      unlisten.then((fn) => fn());
      unlistenLevels.then((fn) => fn());
      unlistenBusLevels.then((fn) => fn());
      invoke("vm_logout").catch(() => {});
    };
  }, [applyStrips]);

  const setGain = useCallback(async (strip: number, value: number) => {
    setChannels((prev) => {
      const next = new Map(prev);
      const current = next.get(strip) ?? { gain: value, muted: false };
      next.set(strip, { ...current, gain: value });
      return next;
    });
    try {
      await invoke("vm_set_gain", { strip, value });
    } catch {
      // Silently fail — polling will correct state
    }
  }, []);

  const setMute = useCallback(async (strip: number, muted: boolean) => {
    setChannels((prev) => {
      const next = new Map(prev);
      const current = next.get(strip) ?? { gain: 0, muted };
      next.set(strip, { ...current, muted });
      return next;
    });
    try {
      await invoke("vm_set_mute", { strip, muted });
    } catch {
      // Silently fail — polling will correct state
    }
  }, []);

  const startDragging = useCallback((strip: number) => {
    dragging.current.add(strip);
  }, []);

  const stopDragging = useCallback((strip: number) => {
    dragging.current.delete(strip);
  }, []);

  /**
   * Launch Voicemeeter. Only ever called from an explicit user action.
   * "auto" lets the backend pick: last seen edition, else newest installed.
   */
  const launchVoicemeeter = useCallback(async (edition: LaunchEdition) => {
    await invoke("vm_run_voicemeeter", { edition: edition === "auto" ? null : edition });
  }, []);

  return {
    connection,
    connected: connection === "connected",
    everConnected,
    liveEdition,
    error,
    channels,
    levels,
    busLevels,
    busGains,
    setGain,
    setMute,
    startDragging,
    stopDragging,
    launchVoicemeeter,
  };
}
