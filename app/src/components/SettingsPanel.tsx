import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { enable as autostartEnable, disable as autostartDisable, isEnabled as autostartIsEnabled } from "@tauri-apps/plugin-autostart";
import { motion, AnimatePresence } from "framer-motion";
import type { ChannelConfig, A1Device } from "../config";
import { STRIP_LABELS } from "../config";
import type { StyleSettings } from "../types/style";
import { DEFAULT_STYLE_SETTINGS } from "../types/style";
import StyleTab from "./settings/StyleTab";

interface SettingsPanelProps {
  open: boolean;
  channels: ChannelConfig[];
  outputs: A1Device[];
  meterDecay: number;
  styleSettings: StyleSettings;
  onSaveChannels: (channels: ChannelConfig[]) => void;
  onSaveOutputs: (outputs: A1Device[]) => void;
  onSaveMeterDecay: (decay: number) => void;
  onSaveStyle: (style: StyleSettings) => void;
  onPreviewStyle?: (style: StyleSettings | null) => void;
  onClose: () => void;
}

type Tab = "channels" | "outputs" | "style";

const AVAILABLE_STRIPS = [0, 1, 2, 3, 4];

/** Stable identity for an output device across driver + name. */
const deviceKey = (d: { driver: string; name: string }) => `${d.driver}|${d.name}`;

/** The label auto-generated on save when the user leaves the display field blank. */
const autoDisplay = (d: { driver: string; name: string }) =>
  `${d.driver.toUpperCase()}: ${d.name}`;

type ModName = "CmdOrCtrl" | "Shift" | "Alt";

/** Canonical modifier order, matching how accelerators are written. */
const MOD_ORDER: ModName[] = ["CmdOrCtrl", "Shift", "Alt"];
const MOD_LABEL: Record<ModName, string> = {
  CmdOrCtrl: "Ctrl",
  Shift: "Shift",
  Alt: "Alt",
};

/** Pretty names for keys whose raw token reads badly in the UI. */
const KEY_LABEL: Record<string, string> = {
  NumpadAdd: "Num +",
  NumpadSubtract: "Num -",
  NumpadMultiply: "Num *",
  NumpadDivide: "Num /",
  NumpadDecimal: "Num .",
  NumpadEnter: "Num Enter",
  NumpadEqual: "Num =",
};

function formatKeyLabel(key: string): string {
  if (!key) return "None";
  if (KEY_LABEL[key]) return KEY_LABEL[key];
  const digit = /^Numpad(\d)$/.exec(key);
  return digit ? `Num ${digit[1]}` : key;
}

/**
 * Extract the key token from a KeyboardEvent.
 *
 * Numpad keys MUST come from e.code. e.key reports "1" with NumLock on (which
 * parses as Digit1, the main-row key) and "End" with NumLock off — so using
 * e.key binds the wrong physical key either way. The e.code values
 * (Numpad0-9, NumpadAdd, NumpadEnter, ...) are exactly the tokens
 * global-hotkey's parser accepts.
 */
function eventToKeyToken(e: KeyboardEvent): string | null {
  if (e.code.startsWith("Numpad")) return e.code;

  let key = e.key;
  if (key === " ") key = "Space";
  else if (key.length === 1) key = key.toUpperCase();
  else if (key === "ArrowUp") key = "Up";
  else if (key === "ArrowDown") key = "Down";
  else if (key === "ArrowLeft") key = "Left";
  else if (key === "ArrowRight") key = "Right";
  // F1-F24, Escape, Tab, etc. are already correct casing from e.key
  return key || null;
}

/** Split an accelerator into its modifiers and key. */
function parseHotkey(accel: string): { mods: ModName[]; key: string } {
  const mods: ModName[] = [];
  let key = "";
  for (const raw of (accel || "").split("+")) {
    const part = raw.trim();
    if (!part) continue;
    if (part === "CmdOrCtrl" || part === "Ctrl" || part === "Control") {
      if (!mods.includes("CmdOrCtrl")) mods.push("CmdOrCtrl");
    } else if (part === "Shift") {
      if (!mods.includes("Shift")) mods.push("Shift");
    } else if (part === "Alt" || part === "Option") {
      if (!mods.includes("Alt")) mods.push("Alt");
    } else {
      key = part;
    }
  }
  return { mods, key };
}

/** Recombine modifiers and key. A modifier alone is not a valid hotkey. */
function buildHotkey(mods: ModName[], key: string): string {
  if (!key) return "";
  return [...MOD_ORDER.filter((m) => mods.includes(m)), key].join("+");
}

/** Convert a KeyboardEvent into a Tauri accelerator string */
function keyEventToAccelerator(e: KeyboardEvent): string | null {
  // Ignore lone modifier presses
  if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return null;

  const key = eventToKeyToken(e);
  if (!key) return null;

  const mods: ModName[] = [];
  if (e.ctrlKey || e.metaKey) mods.push("CmdOrCtrl");
  if (e.shiftKey) mods.push("Shift");
  if (e.altKey) mods.push("Alt");

  return buildHotkey(mods, key);
}

export default function SettingsPanel({
  open,
  channels,
  outputs,
  meterDecay,
  styleSettings,
  onSaveChannels,
  onSaveOutputs,
  onSaveMeterDecay,
  onSaveStyle,
  onPreviewStyle,
  onClose,
}: SettingsPanelProps) {
  const [tab, setTab] = useState<Tab>("style");
  const [chDraft, setChDraft] = useState<ChannelConfig[]>([]);
  const [outDraft, setOutDraft] = useState<A1Device[]>([]);
  const [decayDraft, setDecayDraft] = useState(0.3);
  const [styleDraft, setStyleDraft] = useState<StyleSettings>(DEFAULT_STYLE_SETTINGS);

  const [autostartEnabled, setAutostartEnabled] = useState(false);

  // Output devices Voicemeeter can currently see.
  const [detectedDevices, setDetectedDevices] = useState<A1Device[]>([]);
  const [deviceError, setDeviceError] = useState<string | null>(null);

  // Hotkey recording state: index of channel currently being recorded, or null
  const [recordingIdx, setRecordingIdx] = useState<number | null>(null);
  // Only one channel's details open at a time — the row was too dense flat.
  const [expandedCh, setExpandedCh] = useState<number | null>(null);
  const recordingRef = useRef<number | null>(null);

  useEffect(() => {
    recordingRef.current = recordingIdx;
  }, [recordingIdx]);

  useEffect(() => {
    if (recordingIdx === null) return;

    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Escape cancels recording
      if (e.key === "Escape") {
        setRecordingIdx(null);
        return;
      }

      const accel = keyEventToAccelerator(e);
      if (accel && recordingRef.current !== null) {
        updateChField(recordingRef.current, "muteHotkey", accel);
        setRecordingIdx(null);
      }
    };

    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [recordingIdx]);

  // Seed the drafts the moment `open` flips true, during render rather than from a
  // framer-motion animation callback. Effects — including the live preview below —
  // then see the real saved settings on their first run. Previously they briefly saw
  // DEFAULT_STYLE_SETTINGS, whose "system" accent kicked off a stale colour fetch
  // that landed after the custom colour had been reapplied and overwrote it.
  const [prevOpen, setPrevOpen] = useState(false);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setChDraft(channels.map((c) => ({ ...c })));
      setOutDraft(outputs.map((o) => ({ ...o })));
      setDecayDraft(meterDecay);
      setStyleDraft({ ...DEFAULT_STYLE_SETTINGS, ...styleSettings });
    }
  }

  // Genuinely async, so it stays in an effect.
  useEffect(() => {
    if (!open) return;
    autostartIsEnabled().then(setAutostartEnabled).catch(() => setAutostartEnabled(false));
  }, [open]);

  // Enumerate real output devices when the Outputs tab is shown.
  useEffect(() => {
    if (!open || tab !== "outputs") return;
    let cancelled = false;
    invoke<A1Device[]>("vm_list_output_devices")
      .then((devices) => {
        if (cancelled) return;
        setDetectedDevices(devices);
        setDeviceError(null);
      })
      .catch((e) => {
        if (!cancelled) setDeviceError(String(e));
      });
    return () => { cancelled = true; };
  }, [open, tab]);

  const handleAutostartToggle = async (checked: boolean) => {
    setAutostartEnabled(checked);
    try {
      if (checked) await autostartEnable();
      else await autostartDisable();
    } catch {
      setAutostartEnabled(!checked);
    }
  };

  // Live preview style changes when on style tab
  useEffect(() => {
    if (open && tab === "style") {
      onPreviewStyle?.(styleDraft);
    }
  }, [styleDraft, open, tab]);

  // Clear preview on close
  useEffect(() => {
    if (!open) {
      onPreviewStyle?.(null);
    }
  }, [open]);

  // --- Channel helpers ---

  const updateChField = (idx: number, field: keyof ChannelConfig, value: string | number | boolean) => {
    setChDraft((prev) => prev.map((ch, i) => (i === idx ? { ...ch, [field]: value } : ch)));
  };

  /** Add or remove one modifier on an already-recorded hotkey. */
  const toggleHotkeyMod = (idx: number, mod: ModName) => {
    const { mods, key } = parseHotkey(chDraft[idx]?.muteHotkey ?? "");
    if (!key) return;
    const next = mods.includes(mod) ? mods.filter((m) => m !== mod) : [...mods, mod];
    updateChField(idx, "muteHotkey", buildHotkey(next, key));
  };

  const removeChannel = (idx: number) => {
    setExpandedCh(null);
    setChDraft((prev) => prev.filter((_, i) => i !== idx));
  };

  const moveChannel = (idx: number, dir: -1 | 1) => {
    setExpandedCh(null);
    setChDraft((prev) => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };

  const addChannel = () => {
    const usedStrips = new Set(chDraft.map((c) => c.strip));
    const nextStrip = AVAILABLE_STRIPS.find((s) => !usedStrips.has(s)) ?? 0;
    setChDraft((prev) => [
      ...prev,
      {
        label: STRIP_LABELS[nextStrip]?.split(" ").pop() ?? `Strip ${nextStrip}`,
        strip: nextStrip,
        hasMute: false,
        minDb: -36,
        maxDb: 12,
        defaultDb: 0,
        levelScale: 1,
      },
    ]);
  };

  // --- Output helpers ---

  const updateOutField = (idx: number, field: keyof A1Device, value: string) => {
    setOutDraft((prev) => prev.map((o, i) => (i === idx ? { ...o, [field]: value } : o)));
  };

  const removeOutput = (idx: number) => {
    setOutDraft((prev) => prev.filter((_, i) => i !== idx));
  };

  const addOutput = () => {
    const first = detectedDevices[0];
    setOutDraft((prev) => [
      ...prev,
      first ? { ...first, display: "" } : { driver: "wdm", name: "", display: "" },
    ]);
  };

  /**
   * Options for one row: everything detected, plus this row's own device if it
   * isn't currently enumerable (unplugged, or Voicemeeter not reachable) so
   * editing never silently drops a configured entry.
   */
  const optionsFor = (out: A1Device): A1Device[] => {
    if (!out.name) return detectedDevices;
    const known = detectedDevices.some((d) => deviceKey(d) === deviceKey(out));
    return known ? detectedDevices : [...detectedDevices, out];
  };

  const selectDevice = (idx: number, key: string) => {
    const match = [...detectedDevices, ...outDraft].find((d) => deviceKey(d) === key);
    if (!match) return;
    setOutDraft((prev) =>
      prev.map((o, i) => {
        if (i !== idx) return o;
        // Clear an auto-generated label so it regenerates for the new device;
        // keep anything the user typed themselves.
        const wasAuto = !o.display || o.display === autoDisplay(o);
        return {
          ...o,
          driver: match.driver,
          name: match.name,
          display: wasAuto ? "" : o.display,
        };
      }),
    );
  };

  // --- Save ---

  const handleSave = () => {
    // Auto-generate display from driver + name for outputs
    const finalOutputs = outDraft.map((o) => ({
      ...o,
      display: o.display || `${o.driver.toUpperCase()}: ${o.name}`,
    }));
    onSaveChannels(chDraft);
    onSaveOutputs(finalOutputs);
    onSaveMeterDecay(decayDraft);
    // alwaysOnTop isn't editable here — carry the live value so pinning while the
    // panel is open doesn't get reverted by a stale draft.
    onSaveStyle({ ...styleDraft, alwaysOnTop: styleSettings.alwaysOnTop });
    onClose();
  };

  // Shared styles
  const inputCls = "bg-white/10 border border-white/20 rounded-[3px] text-white/90 outline-none focus:border-[var(--accent)]";
  const smallText = "text-[clamp(0.5rem,1.5vw,0.65rem)]";
  const medText = "text-[clamp(0.55rem,1.8vw,0.75rem)]";
  const rowLabelCls = "w-[clamp(34px,9vw,52px)] shrink-0 text-white/40";

  return (
    <AnimatePresence onExitComplete={() => {}}>
      {open && (
        <motion.div
          className="absolute inset-0 z-50 flex flex-col rounded-[6px] overflow-hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-[#1a1a1a]/90" onClick={onClose} />

          {/* Panel content */}
          <div className="relative flex flex-col flex-1 p-[clamp(8px,2vw,16px)] gap-[clamp(6px,1.5dvh,12px)] overflow-hidden">
            {/* Header + close */}
            <div className="flex items-center justify-between">
              <span className="text-[clamp(0.7rem,2.5vw,0.95rem)] font-bold text-white/90">
                Settings
              </span>
              <button
                className="text-white/60 hover:text-white/90 text-[clamp(0.7rem,2vw,1rem)] bg-transparent border-none cursor-pointer p-1"
                onClick={onClose}
              >
                ✕
              </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 shrink-0">
              {(["style", "channels", "outputs"] as Tab[]).map((t) => (
                <button
                  key={t}
                  className={`px-[clamp(6px,1.5vw,12px)] py-[clamp(2px,0.5dvh,4px)] rounded-[3px] border-none cursor-pointer ${medText} font-semibold capitalize`}
                  style={{
                    backgroundColor: tab === t ? "var(--accent)" : "rgba(255,255,255,0.1)",
                    color: tab === t ? "var(--accent-fg)" : "rgba(255,255,255,0.7)",
                  }}
                  onClick={() => setTab(t)}
                >
                  {t}
                </button>
              ))}
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto flex flex-col gap-[clamp(4px,1dvh,8px)] min-h-0">
              {tab === "channels" && (
                <>
                  {chDraft.map((ch, idx) => {
                    const expanded = expandedCh === idx;
                    const clampedDefault = Math.max(ch.minDb, Math.min(ch.maxDb, ch.defaultDb));
                    const defaultOutOfRange = ch.defaultDb !== clampedDefault;
                    const { mods, key } = parseHotkey(ch.muteHotkey ?? "");
                    const bareHotkey = !!key && mods.length === 0;

                    return (
                      <div key={idx} className="bg-white/5 rounded-[4px] overflow-hidden shrink-0">
                        {/* Compact header — identity only, so the list stays scannable */}
                        <div className="flex items-center gap-[clamp(3px,0.8vw,6px)] p-[clamp(4px,1vw,8px)]">
                          <div className="flex flex-col gap-0 shrink-0">
                            <button
                              className="bg-transparent border-none cursor-pointer text-white/40 hover:text-white/80 text-[clamp(0.5rem,1.2vw,0.65rem)] leading-none p-0 disabled:opacity-20 disabled:cursor-default"
                              onClick={() => moveChannel(idx, -1)}
                              disabled={idx === 0}
                              title="Move up"
                            >
                              ▲
                            </button>
                            <button
                              className="bg-transparent border-none cursor-pointer text-white/40 hover:text-white/80 text-[clamp(0.5rem,1.2vw,0.65rem)] leading-none p-0 disabled:opacity-20 disabled:cursor-default"
                              onClick={() => moveChannel(idx, 1)}
                              disabled={idx === chDraft.length - 1}
                              title="Move down"
                            >
                              ▼
                            </button>
                          </div>

                          <input
                            className={`${inputCls} ${medText} px-[clamp(3px,0.5vw,6px)] py-[2px] w-[clamp(48px,12vw,80px)]`}
                            value={ch.label}
                            onChange={(e) => updateChField(idx, "label", e.target.value)}
                            placeholder="Label"
                          />

                          <select
                            className={`${inputCls} ${smallText} px-[clamp(2px,0.3vw,4px)] py-[2px] cursor-pointer`}
                            style={{ colorScheme: "dark" }}
                            value={ch.strip}
                            onChange={(e) => updateChField(idx, "strip", Number(e.target.value))}
                          >
                            {AVAILABLE_STRIPS.map((s) => (
                              <option key={s} value={s}>
                                Strip {s} — {STRIP_LABELS[s]}
                              </option>
                            ))}
                          </select>

                          <label
                            className={`flex items-center gap-1 ${smallText} text-white/70 cursor-pointer select-none shrink-0`}
                            title="Every fader always has a mute button — this only enables a global hotkey for it"
                          >
                            <input
                              type="checkbox"
                              checked={ch.hasMute}
                              onChange={(e) => updateChField(idx, "hasMute", e.target.checked)}
                              className="accent-[var(--accent)] cursor-pointer"
                            />
                            Hotkey
                          </label>

                          <button
                            className={`ml-auto ${smallText} bg-transparent border-none cursor-pointer text-white/50 hover:text-white/90 px-1 shrink-0`}
                            onClick={() => setExpandedCh(expanded ? null : idx)}
                            aria-expanded={expanded}
                            title={expanded ? "Hide settings" : "More settings"}
                          >
                            {expanded ? "▲" : "▼"}
                          </button>

                          <button
                            className="text-red-400/70 hover:text-red-400 bg-transparent border-none cursor-pointer text-[clamp(0.6rem,1.8vw,0.8rem)] p-0 shrink-0"
                            onClick={() => removeChannel(idx)}
                            title="Remove channel"
                          >
                            ✕
                          </button>
                        </div>

                        {/* Details — collapsed by default; this is where the row
                            was getting unreadable. */}
                        {expanded && (
                          <div className="border-t border-white/10 px-[clamp(6px,1.5vw,12px)] py-[clamp(4px,1vw,8px)] flex flex-col gap-[clamp(3px,0.8dvh,6px)]">
                            {/* Range */}
                            <div className={`flex items-center gap-1 ${smallText} text-white/60 flex-wrap`}>
                              <span className={rowLabelCls}>Range</span>
                              <input
                                type="number"
                                className={`${inputCls} ${smallText} w-[clamp(30px,7vw,44px)] px-1 py-[1px] text-center`}
                                value={ch.minDb}
                                onChange={(e) => updateChField(idx, "minDb", Number(e.target.value))}
                              />
                              <span>to</span>
                              <input
                                type="number"
                                className={`${inputCls} ${smallText} w-[clamp(30px,7vw,44px)] px-1 py-[1px] text-center`}
                                value={ch.maxDb}
                                onChange={(e) => updateChField(idx, "maxDb", Number(e.target.value))}
                              />
                              <span>dB</span>
                            </div>

                            {/* Startup gain — shown before the app connects to Voicemeeter.
                                Double-click on the fader always snaps to 0 dB (unity), not this value. */}
                            <div className={`flex items-center gap-1 ${smallText} text-white/60 flex-wrap`}>
                              <span className={rowLabelCls}>Startup</span>
                              <input
                                type="number"
                                className={`${inputCls} ${smallText} w-[clamp(30px,7vw,44px)] px-1 py-[1px] text-center`}
                                value={ch.defaultDb}
                                onChange={(e) => updateChField(idx, "defaultDb", Number(e.target.value))}
                              />
                              <span>dB</span>
                              {defaultOutOfRange && (
                                <span
                                  className="text-amber-300/80 cursor-help"
                                  title={`Outside this channel's range — will show as ${clampedDefault} dB until Voicemeeter connects.`}
                                >
                                  ⚠
                                </span>
                              )}
                              <span className="text-white/35">shown before Voicemeeter connects</span>
                            </div>

                            {/* Meter scale — double-click slider to reset to 1x */}
                            <div className={`flex items-center gap-1 ${smallText} text-white/60 flex-wrap`}>
                              <span className={rowLabelCls}>Meter</span>
                              <input
                                type="range"
                                min="0.5"
                                max="10"
                                step="0.25"
                                value={ch.levelScale ?? 1}
                                onChange={(e) => updateChField(idx, "levelScale", Number(e.target.value))}
                                onDoubleClick={() => updateChField(idx, "levelScale", 1)}
                                className="w-[clamp(40px,10vw,64px)] accent-[var(--accent)] cursor-pointer"
                              />
                              <span className="tabular-nums w-[3ch] text-right">{(ch.levelScale ?? 1).toFixed(1)}x</span>
                            </div>

                            {/* Mute hotkey */}
                            {ch.hasMute && (
                              <div className={`flex items-center gap-1 ${smallText} text-white/60 flex-wrap`}>
                                <span className={rowLabelCls}>Hotkey</span>
                                {MOD_ORDER.map((mod) => {
                                  const on = mods.includes(mod);
                                  return (
                                    <button
                                      key={mod}
                                      className={`${inputCls} ${smallText} px-[clamp(2px,0.4vw,5px)] py-[1px] cursor-pointer disabled:opacity-30 disabled:cursor-default`}
                                      style={
                                        on
                                          ? { backgroundColor: "var(--accent)", color: "var(--accent-fg)", borderColor: "var(--accent)" }
                                          : undefined
                                      }
                                      onClick={() => toggleHotkeyMod(idx, mod)}
                                      disabled={!key}
                                      aria-pressed={on}
                                      title={key ? `Toggle ${MOD_LABEL[mod]}` : "Record a key first"}
                                    >
                                      {MOD_LABEL[mod]}
                                    </button>
                                  );
                                })}
                                <button
                                  className={`${inputCls} ${smallText} px-[clamp(3px,0.5vw,6px)] py-[1px] cursor-pointer min-w-[clamp(50px,10vw,90px)] text-center`}
                                  style={recordingIdx === idx ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined}
                                  onClick={() => setRecordingIdx(recordingIdx === idx ? null : idx)}
                                  title="Click to record a key, Escape to cancel"
                                >
                                  {recordingIdx === idx ? "Press key..." : formatKeyLabel(key)}
                                </button>
                                {bareHotkey && (
                                  <span
                                    className="text-amber-300/80 cursor-help"
                                    title={`${formatKeyLabel(key)} is captured system-wide, so it won't reach other apps. Add a modifier to avoid that.`}
                                  >
                                    ⚠
                                  </span>
                                )}
                                {ch.muteHotkey && (
                                  <button
                                    className="text-white/40 hover:text-white/70 bg-transparent border-none cursor-pointer text-[clamp(0.5rem,1.2vw,0.6rem)] p-0"
                                    onClick={() => updateChField(idx, "muteHotkey", "")}
                                    title="Clear hotkey"
                                  >
                                    ✕
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {chDraft.length < 5 && (
                    <button
                      className={`flex items-center justify-center gap-1 bg-white/10 hover:bg-white/15 border border-dashed border-white/20 rounded-[4px] ${medText} text-white/70 py-[clamp(4px,0.8dvh,8px)] cursor-pointer shrink-0`}
                      onClick={addChannel}
                    >
                      + Add Channel
                    </button>
                  )}
                </>
              )}

              {tab === "style" && (
                <>
                  <StyleTab
                    draft={styleDraft}
                    onChange={setStyleDraft}
                    meterDecay={decayDraft}
                    onMeterDecayChange={setDecayDraft}
                    smallText={smallText}
                    medText={medText}
                    inputCls={inputCls}
                  />
                  <div className="bg-white/5 rounded-[4px] p-[clamp(4px,1vw,8px)] flex flex-col gap-[clamp(2px,0.5dvh,4px)]">
                    <span className={`${medText} font-semibold text-white/80`}>Startup</span>
                    <div className={`flex items-center gap-1 ${smallText} text-white/60 pl-[clamp(6px,1.5vw,12px)]`}>
                      <label className="flex items-center gap-1 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={autostartEnabled}
                          onChange={(e) => handleAutostartToggle(e.target.checked)}
                          className="accent-[var(--accent)] cursor-pointer"
                        />
                        Launch on startup
                      </label>
                    </div>
                  </div>
                </>
              )}

              {tab === "outputs" && (
                <>
                  <p className={`${smallText} text-white/50 m-0`}>
                    Configure A1 output device options shown in the title bar dropdown.
                  </p>
                  {deviceError && (
                    <p className={`${smallText} text-amber-300/70 m-0`}>
                      Couldn't read the device list ({deviceError}). Existing entries are
                      still editable.
                    </p>
                  )}
                  {!deviceError && detectedDevices.length === 0 && (
                    <p className={`${smallText} text-white/40 m-0`}>
                      No output devices detected — is Voicemeeter running?
                    </p>
                  )}
                  {outDraft.map((out, idx) => (
                    <div
                      key={idx}
                      className="flex flex-wrap items-center gap-[clamp(4px,1vw,8px)] bg-white/5 rounded-[4px] p-[clamp(4px,1vw,8px)]"
                    >
                      {/* Device — driver and name come as a pair, so a typo can't
                          produce a name Voicemeeter will silently reject. */}
                      <select
                        className={`${inputCls} ${medText} px-[clamp(3px,0.5vw,6px)] py-[2px] flex-1 min-w-[clamp(100px,24vw,200px)] cursor-pointer`}
                        style={{ colorScheme: "dark" }}
                        value={out.name ? deviceKey(out) : ""}
                        onChange={(e) => selectDevice(idx, e.target.value)}
                      >
                        {!out.name && <option value="">Select a device…</option>}
                        {optionsFor(out).map((d) => (
                          <option key={deviceKey(d)} value={deviceKey(d)}>
                            {autoDisplay(d)}
                          </option>
                        ))}
                      </select>

                      {/* Display label */}
                      <input
                        className={`${inputCls} ${medText} px-[clamp(3px,0.5vw,6px)] py-[2px] flex-1 min-w-[clamp(60px,15vw,120px)]`}
                        value={out.display}
                        onChange={(e) => updateOutField(idx, "display", e.target.value)}
                        placeholder="Display label (auto)"
                      />

                      {/* Remove */}
                      <button
                        className="text-red-400/70 hover:text-red-400 bg-transparent border-none cursor-pointer text-[clamp(0.6rem,1.8vw,0.8rem)] p-0"
                        onClick={() => removeOutput(idx)}
                        title="Remove output"
                      >
                        ✕
                      </button>
                    </div>
                  ))}

                  <button
                    className={`flex items-center justify-center gap-1 bg-white/10 hover:bg-white/15 border border-dashed border-white/20 rounded-[4px] ${medText} text-white/70 py-[clamp(4px,0.8dvh,8px)] cursor-pointer`}
                    onClick={addOutput}
                  >
                    + Add Output Device
                  </button>
                </>
              )}
            </div>

            {/* Save / Cancel */}
            <div className="flex items-center gap-[clamp(4px,1vw,8px)] shrink-0 pt-[clamp(4px,1dvh,8px)]">
              <button
                className={`flex-1 rounded-[4px] border-none py-[clamp(4px,0.8dvh,8px)] ${medText} font-semibold cursor-pointer`}
                style={{ backgroundColor: "var(--accent)", color: "var(--accent-fg)" }}
                onClick={handleSave}
              >
                Save
              </button>
              <button
                className={`flex-1 rounded-[4px] border border-white/20 bg-transparent py-[clamp(4px,0.8dvh,8px)] ${medText} text-white/70 cursor-pointer hover:bg-white/10`}
                onClick={onClose}
              >
                Cancel
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
