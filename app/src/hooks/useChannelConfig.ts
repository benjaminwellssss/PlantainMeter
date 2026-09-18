import { useState, useEffect, useCallback } from "react";
import { load } from "@tauri-apps/plugin-store";
import type { ChannelConfig, A1Device } from "../config";
import { DEFAULT_CHANNELS, DEFAULT_A1_CHOICES, DEFAULT_METER_DECAY } from "../config";

const CHANNELS_KEY = "channels";
const OUTPUTS_KEY = "outputs";
const METER_DECAY_KEY = "meterDecay";

export function useChannelConfig() {
  const [channels, setChannels] = useState<ChannelConfig[]>(DEFAULT_CHANNELS);
  const [outputs, setOutputs] = useState<A1Device[]>(DEFAULT_A1_CHOICES);
  const [meterDecay, setMeterDecay] = useState(DEFAULT_METER_DECAY);
  const [loaded, setLoaded] = useState(false);
  const [needsOutputSetup, setNeedsOutputSetup] = useState(false);
  const [needsChannelSetup, setNeedsChannelSetup] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const store = await load("settings.json", { defaults: {}, autoSave: true });
        const savedCh = await store.get<ChannelConfig[]>(CHANNELS_KEY);
        const savedOut = await store.get<A1Device[]>(OUTPUTS_KEY);
        if (!cancelled && savedCh && savedCh.length > 0) {
          setChannels(savedCh);
        } else if (!cancelled && (savedCh == null || savedCh.length === 0)) {
          // No usable saved config — first run, or an install that predates
          // per-edition defaults. Trigger the edition-aware seed in App.tsx
          // once the running edition is known, instead of assuming Potato.
          setNeedsChannelSetup(true);
        }
        if (!cancelled && savedOut && savedOut.length > 0) {
          setOutputs(savedOut);
        } else if (!cancelled && savedOut == null) {
          // Key doesn't exist in store — first run, trigger auto-detect
          setNeedsOutputSetup(true);
        }
        const savedDecay = await store.get<number>(METER_DECAY_KEY);
        if (!cancelled && savedDecay != null) {
          setMeterDecay(savedDecay);
        }
      } catch {
        // First run or corrupt store — use defaults
        if (!cancelled) {
          setNeedsOutputSetup(true);
          setNeedsChannelSetup(true);
        }
      }
      if (!cancelled) setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  const saveChannels = useCallback(async (next: ChannelConfig[]) => {
    setChannels(next);
    try {
      const store = await load("settings.json", { defaults: {}, autoSave: true });
      await store.set(CHANNELS_KEY, next);
    } catch {
      // Non-critical
    }
  }, []);

  const saveOutputs = useCallback(async (next: A1Device[]) => {
    setOutputs(next);
    try {
      const store = await load("settings.json", { defaults: {}, autoSave: true });
      await store.set(OUTPUTS_KEY, next);
    } catch {
      // Non-critical
    }
  }, []);

  const saveMeterDecay = useCallback(async (next: number) => {
    setMeterDecay(next);
    try {
      const store = await load("settings.json", { defaults: {}, autoSave: true });
      await store.set(METER_DECAY_KEY, next);
    } catch {
      // Non-critical
    }
  }, []);

  return { channels, saveChannels, outputs, saveOutputs, meterDecay, saveMeterDecay, loaded, needsOutputSetup, setNeedsOutputSetup, needsChannelSetup, setNeedsChannelSetup };
}
