import { useState, useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import type { A1Device } from "../config";
import type { ControlMode, WindowPreset } from "../types/style";
import { invoke } from "@tauri-apps/api/core";

interface TitlebarProps {
  selectedA1: number;
  a1Choices: A1Device[];
  onA1Change: (index: number) => void;
  onSettingsClick: () => void;
  busGain: number;
  showOutputLevel: boolean;
  /** Engine is temporarily unreachable (restarting after a device switch, etc.) */
  reconnecting?: boolean;
  pinned: boolean;
  onPinToggle: () => void;
  sizeLocked: boolean;
  onSizeLockToggle: () => void;
  controlMode: ControlMode;
  onControlModeToggle: () => void;
  /** Shrinks the window to the smallest usable size for the current control mode. */
  onShrinkToFit: () => void;
  /** Smallest usable size for the current control mode — presets can't go below this. */
  minSize: { width: number; height: number };
  /** Sizes offered when right-clicking the minimize button. */
  windowPresets: WindowPreset[];
}

function formatDb(v: number): string {
  const rounded = Math.round(v);
  const sign = rounded >= 0 ? "+" : "-";
  return `${sign}${String(Math.abs(rounded)).padStart(2, "0")}dB`;
}

export default function Titlebar({ selectedA1, a1Choices, onA1Change, onSettingsClick, busGain, showOutputLevel, reconnecting, pinned, onPinToggle, sizeLocked, onSizeLockToggle, controlMode, onControlModeToggle, onShrinkToFit, minSize, windowPresets }: TitlebarProps) {
  const appWindow = getCurrentWindow();
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [presetMenuOpen, setPresetMenuOpen] = useState(false);
  const presetMenuRef = useRef<HTMLDivElement>(null);

  // Dismiss the preset menu on outside click or Escape.
  useEffect(() => {
    if (!presetMenuOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!presetMenuRef.current?.contains(e.target as Node)) setPresetMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPresetMenuOpen(false);
    };
    window.addEventListener("mousedown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("mousedown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [presetMenuOpen]);

  const applyPreset = async (preset: WindowPreset) => {
    setPresetMenuOpen(false);
    try {
      // Never let a preset shrink below what the current control mode/channel
      // count actually needs — that's what caused columns to get cropped.
      await appWindow.setSize(
        new LogicalSize(
          Math.max(preset.width, minSize.width),
          Math.max(preset.height, minSize.height),
        ),
      );
    } catch {
      // Nothing useful to do — the window simply stays its current size.
    }
  };

  const handleA1Change = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const idx = Number(e.target.value);
    const device: A1Device | undefined = a1Choices[idx];
    if (!device) return;

    const previous = selectedA1;
    setSwitchError(null);
    setSwitching(true);
    onA1Change(idx);

    try {
      await invoke("vm_set_a1_device", { driver: device.driver, name: device.name });
    } catch (err) {
      // Never leave the dropdown claiming a device that didn't actually become
      // active — that's what made the old silent catch so confusing.
      onA1Change(previous);
      setSwitchError(String(err));
    } finally {
      setSwitching(false);
    }
  };

  const busy = switching || reconnecting;

  return (
    <div
      // z-[45] keeps the titlebar above the connection overlay (z-40) so the window
      // stays closable/movable while waiting for Voicemeeter. The settings panel
      // (z-50) is still allowed to cover it.
      className="glass-titlebar relative z-[45] flex items-center h-[clamp(24px,8dvh,36px)] px-[clamp(6px,2vw,12px)] select-none shrink-0"
      data-tauri-drag-region
    >
      {/* Pin / always-on-top */}
      <button
        className="w-[clamp(16px,4vw,24px)] h-[clamp(16px,4dvh,24px)] flex items-center justify-center rounded-[3px] border-none cursor-pointer hover:bg-white/20 mr-[clamp(2px,0.5vw,6px)] shrink-0"
        style={{
          color: "var(--accent-fg)",
          backgroundColor: pinned ? "rgba(255,255,255,0.28)" : "transparent",
          opacity: pinned ? 1 : 0.65,
        }}
        onClick={onPinToggle}
        title={pinned ? "Unpin — allow other windows on top" : "Pin — keep on top of other windows"}
        aria-pressed={pinned}
      >
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          className="w-[clamp(10px,2.5vw,14px)] h-[clamp(10px,2.5vw,14px)]"
        >
          <path d="M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z" />
        </svg>
      </button>

      {/* Lock / unlock window size */}
      <button
        className="w-[clamp(16px,4vw,24px)] h-[clamp(16px,4dvh,24px)] flex items-center justify-center rounded-[3px] border-none cursor-pointer hover:bg-white/20 mr-[clamp(2px,0.5vw,6px)] shrink-0"
        style={{
          color: "var(--accent-fg)",
          backgroundColor: sizeLocked ? "rgba(255,255,255,0.28)" : "transparent",
          opacity: sizeLocked ? 1 : 0.65,
        }}
        onClick={onSizeLockToggle}
        title={sizeLocked ? "Unlock window size" : "Lock window size — disable manual resizing"}
        aria-pressed={sizeLocked}
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-[clamp(10px,2.5vw,14px)] h-[clamp(10px,2.5vw,14px)]">
          {sizeLocked ? (
            <path d="M12 2a4 4 0 0 0-4 4v3H7a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-1V6a4 4 0 0 0-4-4Zm0 2a2 2 0 0 1 2 2v3h-4V6a2 2 0 0 1 2-2Z" />
          ) : (
            <path d="M18 8h-1V6a5 5 0 0 0-9.9-1 1 1 0 1 0 1.98.3A3 3 0 0 1 15 6v2H7a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2Z" />
          )}
        </svg>
      </button>

      {/* Settings gear */}
      <button
        className="w-[clamp(16px,4vw,24px)] h-[clamp(16px,4dvh,24px)] flex items-center justify-center rounded-[3px] border-none cursor-pointer hover:bg-white/20 mr-[clamp(2px,0.5vw,6px)] shrink-0"
        style={{ color: "var(--accent-fg)", backgroundColor: "transparent" }}
        onClick={onSettingsClick}
        title="Settings"
      >
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          className="w-[clamp(10px,2.5vw,14px)] h-[clamp(10px,2.5vw,14px)]"
        >
          <path
            fillRule="evenodd"
            d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.062 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {/* Fader / knob toggle */}
      <button
        className="w-[clamp(16px,4vw,24px)] h-[clamp(16px,4dvh,24px)] flex items-center justify-center rounded-[3px] border-none cursor-pointer hover:bg-white/20 mr-[clamp(2px,0.5vw,6px)] shrink-0"
        style={{ color: "var(--accent-fg)", backgroundColor: "transparent" }}
        onClick={onControlModeToggle}
        title={controlMode === "fader" ? "Switch to knobs" : "Switch to faders"}
      >
        {controlMode === "fader" ? (
          <svg viewBox="0 0 20 20" fill="none" className="w-[clamp(10px,2.5vw,14px)] h-[clamp(10px,2.5vw,14px)]">
            <path d="M4 2v16M10 2v16M16 2v16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <circle cx="4" cy="7" r="2" fill="currentColor" />
            <circle cx="10" cy="13" r="2" fill="currentColor" />
            <circle cx="16" cy="5" r="2" fill="currentColor" />
          </svg>
        ) : (
          <svg viewBox="0 0 20 20" fill="none" className="w-[clamp(10px,2.5vw,14px)] h-[clamp(10px,2.5vw,14px)]">
            <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="2" />
            <path d="M10 10 L10 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        )}
      </button>

      {/* App title — hides at very small widths */}
      <span
        className="text-crisp text-[clamp(0.6rem,2.3vw,0.8rem)] font-extrabold uppercase tracking-[0.15em] mr-auto truncate hidden min-[260px]:block"
        style={{ color: "var(--accent-fg)" }}
        data-tauri-drag-region
      >
        Plantain
      </span>

      {/* Reconnecting indicator — engine restart or Voicemeeter briefly gone */}
      {busy && (
        <span
          className="w-[clamp(8px,2vw,11px)] h-[clamp(8px,2vw,11px)] rounded-full border-2 border-white/25 animate-spin mr-[clamp(3px,0.8vw,6px)] shrink-0"
          style={{ borderTopColor: "var(--accent-fg)" }}
          title="Reconnecting to Voicemeeter…"
        />
      )}

      {/* Failed device switch */}
      {switchError && !busy && (
        <span
          className="text-[clamp(0.5rem,1.6vw,0.65rem)] font-bold mr-[clamp(3px,0.8vw,6px)] shrink-0 cursor-help text-red-200"
          title={`Output switch failed: ${switchError}`}
          onClick={() => setSwitchError(null)}
        >
          ⚠
        </span>
      )}

      {/* A1 output gain readout */}
      {showOutputLevel && (
        <span
          className="font-display text-crisp text-[clamp(0.55rem,1.7vw,0.7rem)] font-bold tabular-nums whitespace-nowrap mr-[clamp(3px,0.8vw,6px)] hidden min-[260px]:block"
          style={{ color: "var(--accent-fg)", opacity: 0.9 }}
          title="A1 output gain"
        >
          {formatDb(busGain)}
        </span>
      )}

      {/* A1 picker */}
      <div className="flex items-center gap-[clamp(2px,0.5vw,4px)] mr-[clamp(4px,1vw,8px)]">
        <span
          className="text-crisp text-[clamp(0.55rem,1.9vw,0.7rem)] font-extrabold hidden min-[240px]:block"
          style={{ color: "var(--accent-fg)" }}
        >
          A1:
        </span>
        <select
          className="bg-black/20 border-none rounded-[3px] text-[clamp(0.5rem,1.6vw,0.65rem)] px-[clamp(2px,0.5vw,4px)] py-[1px] max-w-[clamp(60px,20vw,160px)] truncate outline-none cursor-pointer disabled:opacity-60"
          style={{ color: "var(--accent-fg)" }}
          value={selectedA1}
          onChange={handleA1Change}
          disabled={switching}
        >
          {a1Choices.map((d, i) => (
            <option key={i} value={i}>
              {d.display}
            </option>
          ))}
        </select>
      </div>

      {/* Window controls */}
      <div className="flex items-center gap-[2px]">
        {/* Shrink to the smallest usable size for the current control mode */}
        <button
          className="w-[clamp(16px,4vw,24px)] h-[clamp(16px,4dvh,24px)] flex items-center justify-center rounded-[3px] border-none cursor-pointer hover:bg-white/20"
          style={{ color: "var(--accent-fg)", backgroundColor: "transparent" }}
          onClick={onShrinkToFit}
          title={`Shrink to smallest size (${controlMode === "knob" ? "knobs" : "faders"})`}
        >
          <svg viewBox="0 0 20 20" fill="none" className="w-[clamp(9px,2.2vw,12px)] h-[clamp(9px,2.2vw,12px)]">
            <path
              d="M8 3 L8 7 L4 7 M12 3 L12 7 L16 7 M8 17 L8 13 L4 13 M12 17 L12 13 L16 13"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        {/* Minimize — right-click opens the window-size presets */}
        <div className="relative" ref={presetMenuRef}>
          <button
            className="w-[clamp(16px,4vw,28px)] h-[clamp(16px,4dvh,28px)] flex items-center justify-center rounded-[3px] border-none cursor-pointer text-[clamp(0.5rem,1.5vw,0.7rem)] hover:bg-white/20"
            style={{ color: "var(--accent-fg)", backgroundColor: "transparent" }}
            onClick={() => appWindow.minimize()}
            onContextMenu={(e) => {
              e.preventDefault();
              setPresetMenuOpen((v) => !v);
            }}
            title="Minimize (right-click for window sizes)"
          >
            ─
          </button>

          {presetMenuOpen && (
            <div className="absolute right-0 top-full mt-1 z-50 min-w-[clamp(96px,26vw,150px)] rounded-[4px] border border-white/15 bg-[#1a1a1a]/95 py-1 shadow-lg">
              <div className="px-2 pb-1 text-[clamp(0.45rem,1.3vw,0.6rem)] uppercase tracking-wide text-white/35">
                Window size
              </div>
              {windowPresets.length === 0 ? (
                <div className="px-2 py-1 text-[clamp(0.5rem,1.5vw,0.65rem)] text-white/40">
                  None — add some in Settings
                </div>
              ) : (
                windowPresets.map((preset, i) => (
                  <button
                    key={`${preset.name}-${i}`}
                    className="w-full text-left px-2 py-[3px] bg-transparent border-none cursor-pointer text-[clamp(0.5rem,1.5vw,0.65rem)] text-white/80 hover:bg-white/10 flex items-center justify-between gap-2"
                    onClick={() => applyPreset(preset)}
                  >
                    <span className="truncate">{preset.name}</span>
                    <span className="tabular-nums text-white/40 shrink-0">
                      {preset.width}x{preset.height}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
        <button
          className="w-[clamp(16px,4vw,28px)] h-[clamp(16px,4dvh,28px)] flex items-center justify-center rounded-[3px] border-none cursor-pointer text-[clamp(0.5rem,1.5vw,0.7rem)] hover:bg-red-500/80"
          style={{ color: "var(--accent-fg)", backgroundColor: "transparent" }}
          onClick={() => appWindow.close()}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
