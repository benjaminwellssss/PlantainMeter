import { useState, useEffect } from "react";
import {
  MOD_ORDER,
  MOD_LABEL,
  parseHotkey,
  buildHotkey,
  recordHotkey,
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
 * done; Escape cancels. Modifiers can be flipped afterwards without re-recording,
 * or picked *before* recording — with no key yet there is no accelerator to
 * store them in, so they live in `pending` until a key press absorbs them.
 */
export default function HotkeyRecorder({ value, onChange }: HotkeyRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [pending, setPending] = useState<ModName[]>([]);
  const { mods: savedMods, key } = parseHotkey(value);
  const mods = key ? savedMods : pending;
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
      const accel = recordHotkey(e, pending);
      if (accel) {
        onChange(accel);
        setPending([]);
        setRecording(false);
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [recording, onChange, pending]);

  const toggleMod = (mod: ModName) => {
    const next = mods.includes(mod) ? mods.filter((m) => m !== mod) : [...mods, mod];
    if (key) onChange(buildHotkey(next, key));
    else setPending(MOD_ORDER.filter((m) => next.includes(m)));
  };

  const clear = () => {
    setPending([]);
    onChange("");
  };

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {MOD_ORDER.map((mod) => {
        const on = mods.includes(mod);
        return (
          <button
            key={mod}
            className={`${inputCls} ${smallText} px-[clamp(2px,0.4vw,5px)] py-[1px] cursor-pointer`}
            style={
              on
                ? { backgroundColor: "var(--accent)", color: "var(--accent-fg)", borderColor: "var(--accent)" }
                : undefined
            }
            onClick={() => toggleMod(mod)}
            aria-pressed={on}
            title={key ? `Toggle ${MOD_LABEL[mod]}` : `${MOD_LABEL[mod]} — applied to the key you record next`}
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
      {(value || pending.length > 0) && (
        <button
          className="text-white/40 hover:text-white/70 bg-transparent border-none cursor-pointer text-[clamp(0.5rem,1.2vw,0.6rem)] p-0"
          onClick={clear}
          title="Clear hotkey"
        >
          ✕
        </button>
      )}
    </div>
  );
}
