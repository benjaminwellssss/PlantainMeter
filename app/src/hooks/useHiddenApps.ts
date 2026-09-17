import { useState, useEffect, useCallback } from "react";
import { migrateHidden } from "../lib/hiddenApps";
import { readKey, writeKey } from "../lib/settingsStore";

const HIDDEN_APPS_KEY = "hiddenApps";

/**
 * Apps the user has hidden from the per-app mixer, persisted as
 * `"<endpoint kind>:<executable name>"` so a hide applies only to the input it
 * was made under and survives restarts and new sessions.
 */
export function useHiddenApps() {
  const [hidden, setHidden] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    readKey<unknown>(HIDDEN_APPS_KEY, []).then((raw) => {
      if (cancelled) return;
      const list = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
      setHidden(list.map((s) => s.toLowerCase()));
      setLoaded(true);
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

  /**
   * Rewrite entries saved before hiding was per-channel into one entry per
   * endpoint, so what was hidden before stays hidden everywhere it showed.
   * Safe to call repeatedly — it only writes when something changes.
   */
  const migrate = useCallback((scopes: string[]) => {
    setHidden((prev) => {
      const next = migrateHidden(prev, scopes);
      if (next === prev) return prev;
      writeKey(HIDDEN_APPS_KEY, next);
      return next;
    });
  }, []);

  return { hidden, loaded, isHidden, hide, unhide, save, migrate };
}
