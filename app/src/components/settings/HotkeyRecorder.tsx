import { useState, useEffect } from "react";
import {
  MOD_ORDER,
  MOD_LABEL,
  parseHotkey,
  buildHotkey,
  keyEventToAccelerator,
  formatKeyLabel,
  type ModName,
} from "../../lib/hotkey";
import { inputCls, smallText } from "./shared";

interface HotkeyRecorderProps {
  /** Accelerator string, "" for none. */
  value: string;
  onChange: (accel: string) => void;
}

/**
 * Modifier toggles + a record button + clear. Click the button, press a key,
 * done; Escape cancels. Modifiers can be flipped afterwards without re-recording.
 */
export default function HotkeyRecorder({ value, onChange }: HotkeyRecorderProps) {
  const [recording, setRecording] = useState(false);
  const { mods, key } = parseHotkey(value);
  const bareHotkey = !!key && mods.length === 0;

  useEffect(() => {
    if (!recording) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setRecording(false);
        return;
      }
      const accel = keyEventToAccelerator(e);
      if (accel) {
        onChange(accel);
        setRecording(false);
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [recording, onChange]);

  const toggleMod = (mod: ModName) => {
    if (!key) return;
    const next = mods.includes(mod) ? mods.filter((m) => m !== mod) : [...mods, mod];
    onChange(buildHotkey(next, key));
  };

  return (
    <div className="flex items-center gap-1 flex-wrap">
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
            onClick={() => toggleMod(mod)}
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
        style={recording ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined}
        onClick={() => setRecording((r) => !r)}
        title="Click to record a key, Escape to cancel"
      >
        {recording ? "Press key..." : formatKeyLabel(key)}
      </button>
      {bareHotkey && (
        <span
          className="text-amber-300/80 cursor-help"
          title={`${formatKeyLabel(key)} is captured system-wide, so it won't reach other apps. Add a modifier to avoid that.`}
        >
          ⚠
        </span>
      )}
      {value && (
        <button
          className="text-white/40 hover:text-white/70 bg-transparent border-none cursor-pointer text-[clamp(0.5rem,1.2vw,0.6rem)] p-0"
          onClick={() => onChange("")}
          title="Clear hotkey"
        >
          ✕
        </button>
      )}
    </div>
  );
}
