import { load, type Store } from "@tauri-apps/plugin-store";

/**
 * Thin wrapper over the single `settings.json` store so every hook doesn't
 * repeat the load/try/catch dance. Reads return the fallback on any failure;
 * writes are best-effort (settings are never critical to the mixer working).
 */
let storePromise: Promise<Store> | null = null;

export function getStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = load("settings.json", { defaults: {}, autoSave: true });
  }
  return storePromise;
}

export async function readKey<T>(key: string, fallback: T): Promise<T> {
  try {
    const store = await getStore();
    const value = await store.get<T>(key);
    return value === undefined || value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

export async function writeKey<T>(key: string, value: T): Promise<void> {
  try {
    const store = await getStore();
    await store.set(key, value);
  } catch {
    // Non-critical
  }
}
