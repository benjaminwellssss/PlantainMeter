import { useState, useEffect, useCallback } from "react";
import type { AppSession } from "../types/appSessions";
import { readKey, writeKey } from "../lib/settingsStore";

const HIDDEN_APPS_KEY = "hiddenApps";

/** Identity used for hiding: the executable name, or the display name for pid-less sessions. */
export function hideKey(session: Pick<AppSession, "process" | "display">): string {
  return (session.process || session.display).trim().toLowerCase();
}

/**
 * Apps the user has hidden from the per-app mixer, persisted by executable
 * name so they stay hidden across restarts and new sessions.
 */
export function useHiddenApps() {
  const [hidden, setHidden] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    readKey<unknown>(HIDDEN_APPS_KEY, []).then((raw) => {
      if (cancelled) return;
      const list = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
      setHidden(list.map((s) => s.toLowerCase()));
    });
    return () => { cancelled = true; };
  }, []);

  const save = useCallback((next: string[]) => {
    setHidden(next);
    writeKey(HIDDEN_APPS_KEY, next);
  }, []);

  const hide = useCallback((key: string) => {
    if (!key) return;
    setHidden((prev) => {
      if (prev.includes(key)) return prev;
      const next = [...prev, key];
      writeKey(HIDDEN_APPS_KEY, next);
      return next;
    });
  }, []);

  const unhide = useCallback((key: string) => {
    setHidden((prev) => {
      const next = prev.filter((k) => k !== key);
      writeKey(HIDDEN_APPS_KEY, next);
      return next;
    });
  }, []);

  const isHidden = useCallback((key: string) => hidden.includes(key), [hidden]);

  return { hidden, isHidden, hide, unhide, save };
}
