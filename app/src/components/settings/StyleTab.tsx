import { useState, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  enable as autostartEnable,
  disable as autostartDisable,
  isEnabled as autostartIsEnabled,
} from "@tauri-apps/plugin-autostart";
import type { StyleSettings, WindowPreset } from "../../types/style";
import { DEFAULT_STYLE_SETTINGS } from "../../types/style";
import WindowStateStyleEditor from "./WindowStateStyleEditor";

interface StyleTabProps {
  draft: StyleSettings;
  onChange: (next: StyleSettings) => void;
  meterDecay: number;
  onMeterDecayChange: (decay: number) => void;
  smallText: string;
  medText: string;
  inputCls: string;
}

export default function StyleTab({
  draft,
  onChange,
  meterDecay,
  onMeterDecayChange,
  smallText,
  medText,
  inputCls,
}: StyleTabProps) {
  const update = (patch: Partial<StyleSettings>) => {
    onChange({ ...draft, ...patch });
  };

  // Launch-on-startup is an OS registration, not a saved setting, so it
  // applies immediately rather than on Save.
  const [autostartEnabled, setAutostartEnabled] = useState(false);
  useEffect(() => {
    autostartIsEnabled().then(setAutostartEnabled).catch(() => setAutostartEnabled(false));
  }, []);
  const handleAutostartToggle = async (checked: boolean) => {
    setAutostartEnabled(checked);
    try {
      if (checked) await autostartEnable();
      else await autostartDisable();
    } catch {
      setAutostartEnabled(!checked);
    }
  };

  const presets: WindowPreset[] = draft.windowPresets ?? [];

  const updatePreset = (idx: number, patch: Partial<WindowPreset>) => {
    update({ windowPresets: presets.map((p, i) => (i === idx ? { ...p, ...patch } : p)) });
  };

  const removePreset = (idx: number) => {
    update({ windowPresets: presets.filter((_, i) => i !== idx) });
  };

  const addPreset = () => {
    update({ windowPresets: [...presets, { name: "New size", width: 420, height: 340 }] });
  };

  /** Snap a preset to whatever size the window is right now — far easier than
   *  guessing pixel values by hand. */
  const captureCurrentSize = async (idx: number) => {
    try {
      const win = getCurrentWindow();
      const [size, scale] = await Promise.all([win.innerSize(), win.scaleFactor()]);
      const logical = size.toLogical(scale);
      updatePreset(idx, {
        width: Math.round(logical.width),
        height: Math.round(logical.height),
      });
    } catch {
      // Leave the preset untouched if the window won't report its size.
    }
  };

  return (
    <div className="flex flex-col gap-[clamp(6px,1.2dvh,10px)]">
      {/* Accent color */}
      <div className="bg-white/5 rounded-[4px] p-[clamp(4px,1vw,8px)] flex flex-col gap-[clamp(2px,0.5dvh,4px)]">
        <span className={`${medText} font-semibold text-white/80`}>Accent Color</span>
        <div className={`flex items-center gap-[clamp(4px,0.8vw,8px)] ${smallText} text-white/60 pl-[clamp(6px,1.5vw,12px)]`}>
          <label className="flex items-center gap-1 cursor-pointer select-none">
            <input
              type="radio"
              name="accent"
              checked={draft.accentSource === "system"}
              onChange={() => update({ accentSource: "system" })}
              className="accent-[var(--accent)] cursor-pointer"
            />
            System
          </label>
          <label className="flex items-center gap-1 cursor-pointer select-none">
            <input
              type="radio"
              name="accent"
              checked={draft.accentSource === "custom"}
              onChange={() => update({ accentSource: "custom" })}
              className="accent-[var(--accent)] cursor-pointer"
            />
            Custom
          </label>
          {draft.accentSource === "custom" && (
            <>
              <input
                type="color"
                value={draft.customAccentColor}
                onChange={(e) => update({ customAccentColor: e.target.value })}
                className="w-[clamp(20px,4vw,28px)] h-[clamp(16px,3vw,22px)] border border-white/20 rounded-[2px] cursor-pointer bg-transparent p-0"
              />
              <span className="tabular-nums">{draft.customAccentColor}</span>
            </>
          )}
        </div>
      </div>

      {/* Meter decay */}
      <div className="bg-white/5 rounded-[4px] p-[clamp(4px,1vw,8px)] flex flex-col gap-[clamp(2px,0.5dvh,4px)]">
        <span className={`${medText} font-semibold text-white/80`}>Meter Decay</span>
        <div className={`flex items-center gap-[clamp(4px,1vw,8px)] ${smallText} text-white/60 pl-[clamp(6px,1.5vw,12px)]`}>
          <input
            type="range"
            min="0.05"
            max="2"
            step="0.05"
            value={meterDecay}
            onChange={(e) => onMeterDecayChange(Number(e.target.value))}
            onDoubleClick={() => onMeterDecayChange(0.3)}
            className="flex-1 min-w-[clamp(40px,10vw,80px)] accent-[var(--accent)] cursor-pointer"
          />
          <span className={`${smallText} text-white/60 tabular-nums w-[4ch] text-right`}>
            {meterDecay < 0.15 ? "Slow" : meterDecay > 1.5 ? "Fast" : meterDecay.toFixed(2)}
          </span>
        </div>
      </div>

      {/* Fader column width */}
      <div className="bg-white/5 rounded-[4px] p-[clamp(4px,1vw,8px)] flex flex-col gap-[clamp(2px,0.5dvh,4px)]">
        <span className={`${medText} font-semibold text-white/80`}>Fader Width</span>
        <div className={`flex items-center gap-1 ${smallText} text-white/60 pl-[clamp(6px,1.5vw,12px)]`}>
          <label className="flex items-center gap-1 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={draft.faderColumnWidth === 0}
              onChange={(e) => update({ faderColumnWidth: e.target.checked ? 0 : 60 })}
              className="accent-[var(--accent)] cursor-pointer"
            />
            Auto
          </label>
          {draft.faderColumnWidth > 0 && (
            <>
              <input
                type="range"
                min="42"
                max="120"
                step="1"
                value={draft.faderColumnWidth}
                onChange={(e) => update({ faderColumnWidth: Number(e.target.value) })}
                className="flex-1 min-w-[clamp(40px,10vw,80px)] accent-[var(--accent)] cursor-pointer"
              />
              <span className="tabular-nums w-[4ch] text-right">{draft.faderColumnWidth}px</span>
            </>
          )}
        </div>
      </div>

      {/* Output level in titlebar */}
      <div className="bg-white/5 rounded-[4px] p-[clamp(4px,1vw,8px)] flex flex-col gap-[clamp(2px,0.5dvh,4px)]">
        <span className={`${medText} font-semibold text-white/80`}>Titlebar</span>
        <div className={`flex items-center gap-1 ${smallText} text-white/60 pl-[clamp(6px,1.5vw,12px)]`}>
          <label className="flex items-center gap-1 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={draft.showOutputLevel}
              onChange={(e) => update({ showOutputLevel: e.target.checked })}
              className="accent-[var(--accent)] cursor-pointer"
            />
            Show A1 output level
          </label>
        </div>
      </div>

      {/* Global opacity */}
      <div className="bg-white/5 rounded-[4px] p-[clamp(4px,1vw,8px)] flex flex-col gap-[clamp(2px,0.5dvh,4px)]">
        <span className={`${medText} font-semibold text-white/80`}>Global Opacity</span>
        <div className={`flex items-center gap-[clamp(4px,1vw,8px)] ${smallText} text-white/60 pl-[clamp(6px,1.5vw,12px)]`}>
          <input
            type="range"
            min="0.2"
            max="1"
            step="0.01"
            value={draft.globalOpacity ?? 1}
            onChange={(e) => update({ globalOpacity: Number(e.target.value) })}
            onDoubleClick={() => update({ globalOpacity: 1 })}
            className="flex-1 min-w-[clamp(40px,10vw,80px)] accent-[var(--accent)] cursor-pointer"
          />
          <span className={`${smallText} text-white/60 tabular-nums w-[4ch] text-right`}>
            {Math.round((draft.globalOpacity ?? 1) * 100)}%
          </span>
        </div>
        <span className={`${smallText} text-white/35 pl-[clamp(6px,1.5vw,12px)]`}>
          Fades the whole window. The visualizer slider only affects the animation.
        </span>
      </div>

      {/* Window size presets */}
      <div className="bg-white/5 rounded-[4px] p-[clamp(4px,1vw,8px)] flex flex-col gap-[clamp(2px,0.5dvh,4px)]">
        <span className={`${medText} font-semibold text-white/80`}>Window Sizes</span>
        <span className={`${smallText} text-white/35 pl-[clamp(6px,1.5vw,12px)]`}>
          Right-click the minimize button to switch between these.
        </span>
        {presets.map((preset, idx) => (
          <div key={idx} className="flex flex-wrap items-center gap-[clamp(3px,0.8vw,6px)] pl-[clamp(6px,1.5vw,12px)]">
            <input
              className={`${inputCls} ${smallText} px-[clamp(3px,0.5vw,6px)] py-[1px] w-[clamp(56px,14vw,96px)]`}
              value={preset.name}
              onChange={(e) => updatePreset(idx, { name: e.target.value })}
              placeholder="Name"
            />
            <input
              type="number"
              min="200"
              className={`${inputCls} ${smallText} px-1 py-[1px] w-[clamp(34px,8vw,52px)] text-center`}
              value={preset.width}
              onChange={(e) => updatePreset(idx, { width: Number(e.target.value) })}
            />
            <span className="text-white/40">x</span>
            <input
              type="number"
              min="275"
              className={`${inputCls} ${smallText} px-1 py-[1px] w-[clamp(34px,8vw,52px)] text-center`}
              value={preset.height}
              onChange={(e) => updatePreset(idx, { height: Number(e.target.value) })}
            />
            <button
              className={`${inputCls} ${smallText} px-[clamp(3px,0.5vw,6px)] py-[1px] cursor-pointer text-white/70`}
              onClick={() => captureCurrentSize(idx)}
              title="Set to the window's current size"
            >
              Use current
            </button>
            <button
              className="ml-auto text-red-400/70 hover:text-red-400 bg-transparent border-none cursor-pointer text-[clamp(0.6rem,1.8vw,0.8rem)] p-0"
              onClick={() => removePreset(idx)}
              title="Remove preset"
            >
              x
            </button>
          </div>
        ))}
        <button
          className={`flex items-center justify-center gap-1 bg-white/10 hover:bg-white/15 border border-dashed border-white/20 rounded-[4px] ${smallText} text-white/70 py-[clamp(2px,0.5dvh,5px)] cursor-pointer ml-[clamp(6px,1.5vw,12px)]`}
          onClick={addPreset}
        >
          + Add Window Size
        </button>
      </div>

      {/* Background */}
      <div className="bg-white/5 rounded-[4px] p-[clamp(4px,1vw,8px)]">
        <WindowStateStyleEditor
          label="Background"
          draft={draft.background}
          onChange={(background) => update({ background })}
          smallText={smallText}
          medText={medText}
          inputCls={inputCls}
        />
      </div>

      {/* Startup */}
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

      {/* Reset */}
      <button
        className={`${smallText} text-white/40 hover:text-white/70 bg-transparent border border-white/10 hover:border-white/20 rounded-[3px] py-[clamp(2px,0.4dvh,4px)] cursor-pointer`}
        onClick={() => onChange({ ...DEFAULT_STYLE_SETTINGS })}
      >
        Reset to defaults
      </button>
    </div>
  );
}
