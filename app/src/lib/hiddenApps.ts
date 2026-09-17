/**
 * Keys for apps the user has hidden from the per-app mixer.
 *
 * An entry is `"<scope>:<app name>"`, so hiding Spotify under the VAIO input
 * leaves it visible under AUX. The scope is derived from the endpoint rather
 * than its strip number because strip numbers move between Banana and Potato
 * while the endpoints do not — hides survive an edition change.
 */

import type { AppEndpoint, AppSession } from "../types/appSessions";

/** A scope token: "vaio", "aux", "vaio3", or "hw1".."hwN". */
const SCOPE_RE = /^(?:vaio3|vaio|aux|hw\d+)$/;

/**
 * Scope token per endpoint. Every hardware input reports the same `kind`
 * ("hw"), so they are numbered by their position in the payload — which the
 * Rust side sorts by input number — to keep them apart.
 */
export function buildScopes(endpoints: Pick<AppEndpoint, "endpoint" | "kind">[]): Map<string, string> {
  const scopes = new Map<string, string>();
  let hw = 0;
  for (const e of endpoints) {
    scopes.set(e.endpoint, e.kind === "hw" ? `hw${++hw}` : e.kind);
  }
  return scopes;
}

/** Identity used for hiding: the endpoint's scope, plus the executable name (or the display name for pid-less sessions). */
export function hideKey(scope: string, session: Pick<AppSession, "process" | "display">): string {
  return `${scope}:${(session.process || session.display).trim().toLowerCase()}`;
}

/**
 * Split a stored entry. A `scope` of null means a legacy entry written before
 * hiding was per-channel, which applies to every endpoint until migrated.
 */
export function parseHideKey(entry: string): { scope: string | null; name: string } {
  const idx = entry.indexOf(":");
  if (idx > 0) {
    const prefix = entry.slice(0, idx);
    if (SCOPE_RE.test(prefix)) return { scope: prefix, name: entry.slice(idx + 1) };
  }
  return { scope: null, name: entry };
}

/**
 * Rewrite legacy global entries as one scoped entry per endpoint, preserving
 * what is currently hidden. Returns `entries` itself when nothing changes, so
 * the caller can skip the write.
 */
export function migrateHidden(entries: string[], scopes: string[]): string[] {
  if (scopes.length === 0) return entries;
  const legacy = entries.filter((e) => parseHideKey(e).scope === null);
  if (legacy.length === 0) return entries;

  const next = entries.filter((e) => parseHideKey(e).scope !== null);
  for (const name of legacy) {
    for (const scope of scopes) {
      const key = `${scope}:${name}`;
      if (!next.includes(key)) next.push(key);
    }
  }
  return next;
}
