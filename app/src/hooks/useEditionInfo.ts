import { useState, useEffect, useCallback } from "react";
import type { EditionInfo, LaunchEdition } from "../types/edition";
import { EDITION_DEFAULTS } from "../lib/editions";
import { readKey, writeKey } from "../lib/settingsStore";

const LAST_EDITION_KEY = "lastEdition";
const LAUNCH_EDITION_KEY = "launchEdition";

/**
 * Single source of truth for "which Voicemeeter are we laying out for".
 *
 * `live` is what the backend reports while connected. When disconnected we fall
 * back to the last edition we saw (persisted) so Settings stays usable, and
 * finally to Banana, the historical default.
 */
export function useEditionInfo(live: EditionInfo | null) {
  const [persisted, setPersisted] = useState<EditionInfo | null>(null);
  const [launchEdition, setLaunchEdition] = useState<LaunchEdition>("auto");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await readKey<EditionInfo | null>(LAST_EDITION_KEY, null);
      const launch = await readKey<LaunchEdition>(LAUNCH_EDITION_KEY, "auto");
      if (cancelled) return;
      if (saved && Array.isArray(saved.strips)) setPersisted(saved);
      setLaunchEdition(launch);
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  // Remember the live edition so a cold start without Voicemeeter still knows it.
  useEffect(() => {
    if (!live) return;
    setPersisted(live);
    writeKey(LAST_EDITION_KEY, live);
  }, [live]);

  const saveLaunchEdition = useCallback((next: LaunchEdition) => {
    setLaunchEdition(next);
    writeKey(LAUNCH_EDITION_KEY, next);
  }, []);

  return {
    edition: live ?? persisted ?? EDITION_DEFAULTS.banana,
    isLive: live !== null,
    loaded,
    launchEdition,
    saveLaunchEdition,
  };
}
