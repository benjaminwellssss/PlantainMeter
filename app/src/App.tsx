import { useState, useEffect, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import type { A1Device } from "./config";
import {
  modeKindFor,
  FADER_MIN_HEIGHT,
  KNOB_MIN_HEIGHT,
  FADER_COLUMN_MIN_WIDTH,
  KNOB_COLUMN_MIN_WIDTH,
  ROW_PADDING_MIN,
  ROW_GAP_MIN,
  WINDOW_MIN_WIDTH,
} from "./config";
import { useVoicemeeter } from "./hooks/useVoicemeeter";
import { useAccentColor } from "./hooks/useAccentColor";
import { useChannelConfig } from "./hooks/useChannelConfig";
import { useStyleSettings } from "./hooks/useStyleSettings";
import { useWindowFocus } from "./hooks/useWindowFocus";
import { useGlobalShortcuts } from "./hooks/useGlobalShortcuts";
import type { StyleSettings } from "./types/style";
import Titlebar from "./components/Titlebar";
import Fader from "./components/Fader";
import Knob from "./components/Knob";
import BackgroundLayer from "./components/BackgroundLayer";
import SettingsPanel from "./components/SettingsPanel";
import ConnectionOverlay from "./components/ConnectionOverlay";

export default function App() {
  const { style, saveStyle, loaded: styleLoaded } = useStyleSettings();
  const focused = useWindowFocus();

  // Live preview style when settings panel is open
  const [previewStyle, setPreviewStyle] = useState<StyleSettings | null>(null);
  const effectiveSettings = previewStyle ?? style;
  const bg = effectiveSettings.background;

  useAccentColor(
    effectiveSettings.accentSource,
    effectiveSettings.customAccentColor,
  );

  // Visualizer color: either follows accent or uses a custom color
  useEffect(() => {
    const root = document.documentElement;
    if (bg.visualizerColorSource === "custom") {
      const h = bg.visualizerColor.replace("#", "");
      root.style.setProperty("--viz-r", String(parseInt(h.substring(0, 2), 16) || 0));
      root.style.setProperty("--viz-g", String(parseInt(h.substring(2, 4), 16) || 0));
      root.style.setProperty("--viz-b", String(parseInt(h.substring(4, 6), 16) || 0));
    } else {
      root.style.setProperty("--viz-r", getComputedStyle(root).getPropertyValue("--accent-r"));
      root.style.setProperty("--viz-g", getComputedStyle(root).getPropertyValue("--accent-g"));
      root.style.setProperty("--viz-b", getComputedStyle(root).getPropertyValue("--accent-b"));
    }
  }, [bg.visualizerColorSource, bg.visualizerColor, effectiveSettings.accentSource, effectiveSettings.customAccentColor]);

  // Compute background layer props — focus only affects visualizer pause
  const bgProps = useMemo(() => {
    const isAcrylic = bg.backgroundMode === "acrylic";
    const vizPaused = !focused && bg.unfocusedVisualizerMode === "paused";

    return {
      isAcrylic,
      showColor: bg.backgroundMode === "solid",
      color: bg.backgroundColor,
      colorOpacity: bg.backgroundOpacity,
      showVisualizer: bg.backgroundMode === "visualizer",
      visualizerPaused: vizPaused,
      visualizerPreset: bg.visualizerPreset,
      visualizerOpacity: bg.visualizerOpacity,
      visualizerIntensity: bg.visualizerIntensity,
    };
  }, [bg, focused]);

  // Acrylic + CSS overlay, synced to focus state.
  // Windows DWM forces acrylic opaque when unfocused, so we clear it and
  // fall back to a CSS-only translucent overlay that preserves the look.
  useEffect(() => {
    if (!styleLoaded) return;
    if (bgProps.isAcrylic) {
      if (focused) {
        invoke("set_acrylic", { enabled: true }).catch(() => {});
        document.documentElement.style.setProperty("--glass-opacity", "0.45");
      } else {
        document.documentElement.style.setProperty("--glass-opacity", "0.85");
        invoke("set_acrylic", { enabled: false }).catch(() => {});
      }
    } else {
      invoke("set_acrylic", { enabled: false }).catch(() => {});
      document.documentElement.style.setProperty("--glass-opacity", "0.85");
    }
  }, [bgProps.isAcrylic, focused, styleLoaded]);

  // Keep the OS always-on-top flag in sync with the saved preference. Reads from
  // `style` rather than `effectiveSettings` so live style previews can't unpin the
  // window as a side effect.
  useEffect(() => {
    if (!styleLoaded) return;
    getCurrentWindow().setAlwaysOnTop(style.alwaysOnTop).catch(() => {});
  }, [style.alwaysOnTop, styleLoaded]);

  const togglePinned = () => {
    saveStyle({ ...style, alwaysOnTop: !style.alwaysOnTop });
  };

  // Reads from `style` rather than `effectiveSettings`, same as the pin, so a
  // live settings preview can't switch the control layout as a side effect.
  const toggleControlMode = () => {
    saveStyle({ ...style, controlMode: style.controlMode === "fader" ? "knob" : "fader" });
  };

  // Keep the OS-level resizable flag in sync with the saved lock preference.
  useEffect(() => {
    if (!styleLoaded) return;
    getCurrentWindow().setResizable(!style.sizeLocked).catch(() => {});
  }, [style.sizeLocked, styleLoaded]);

  const toggleSizeLock = () => {
    saveStyle({ ...style, sizeLocked: !style.sizeLocked });
  };

  // Whole-window opacity. Uses effectiveSettings so dragging the slider in
  // Settings previews live, unlike the pin which must not follow previews.
  useEffect(() => {
    if (!styleLoaded) return;
    invoke("set_window_opacity", { opacity: effectiveSettings.globalOpacity ?? 1 }).catch(() => {});
  }, [effectiveSettings.globalOpacity, styleLoaded]);

  const { channels: channelConfigs, saveChannels, outputs, saveOutputs, meterDecay, saveMeterDecay, loaded, needsOutputSetup, setNeedsOutputSetup } = useChannelConfig();

  // Smallest usable window size for the current control mode — width scales
  // with the channel count so shrinking never squeezes a column narrower
  // than its control's own minimum (a knob must never get smooshed).
  const minWindowSize = useMemo(() => {
    const count = Math.max(channelConfigs.length, 1);
    const columnWidth = style.controlMode === "knob" ? KNOB_COLUMN_MIN_WIDTH : FADER_COLUMN_MIN_WIDTH;
    const height = style.controlMode === "knob" ? KNOB_MIN_HEIGHT : FADER_MIN_HEIGHT;
    const width = Math.max(
      WINDOW_MIN_WIDTH,
      count * columnWidth + (count - 1) * ROW_GAP_MIN + ROW_PADDING_MIN * 2,
    );
    return { width, height };
  }, [style.controlMode, channelConfigs.length]);

  // Keeps the OS-enforced minimum window size in sync, so a manual resize
  // (not just the shrink-to-fit button) can't go smaller than this either.
  // Self-heals if the window is already smaller than the new floor (e.g. a
  // size saved from before a control-mode switch) — resizing up rather than
  // just tightening the constraint going forward, so content is never left
  // clipped below the visible minimum.
  useEffect(() => {
    if (!styleLoaded) return;
    const win = getCurrentWindow();
    win.setMinSize(new LogicalSize(minWindowSize.width, minWindowSize.height)).catch(() => {});

    (async () => {
      try {
        const scale = await win.scaleFactor();
        const logical = (await win.innerSize()).toLogical(scale);
        if (logical.width < minWindowSize.width || logical.height < minWindowSize.height) {
          await win.setSize(
            new LogicalSize(
              Math.max(logical.width, minWindowSize.width),
              Math.max(logical.height, minWindowSize.height),
            ),
          );
        }
      } catch {
        // Non-critical — the OS-level min-size constraint above still applies
      }
    })();
  }, [minWindowSize, styleLoaded]);

  const shrinkToFit = () => {
    getCurrentWindow().setSize(new LogicalSize(minWindowSize.width, minWindowSize.height)).catch(() => {});
  };

  const {
    connection,
    connected,
    everConnected,
    error,
    channels,
    levels,
    busGains,
    setGain,
    setMute,
    setMono,
    setSolo,
    setMc,
    setKaraoke,
    startDragging,
    stopDragging,
    launchVoicemeeter,
  } = useVoicemeeter(channelConfigs);

  // A drop after we've been live (engine restart, device switch) is transient —
  // show it in the titlebar rather than blanking the window.
  const reconnecting = everConnected && connection !== "connected";
  const [selectedA1, setSelectedA1] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Auto-detect A1 output device on first run
  const autoDetectRan = useRef(false);
  useEffect(() => {
    if (!connected || !needsOutputSetup || autoDetectRan.current) return;
    autoDetectRan.current = true;
    (async () => {
      try {
        const device = await invoke<A1Device | null>("vm_get_a1_device");
        if (device) {
          saveOutputs([device]);
          setNeedsOutputSetup(false);
        }
      } catch {
        // Non-critical — user can configure manually
      }
    })();
  }, [connected, needsOutputSetup, saveOutputs, setNeedsOutputSetup]);

  // Sync mute hotkey configs to Rust — shortcuts are handled entirely in Rust
  useGlobalShortcuts(channelConfigs);

  // Master level for visualizers: max of all strip levels, perceptually
  // shaped so quiet passages still drive visible motion — raw linear meter
  // values sit low most of the time, which made every visualizer look
  // nearly static outside of loud peaks.
  const masterLevel = useMemo(() => {
    let max = 0;
    for (const v of levels.values()) {
      if (v > max) max = v;
    }
    const shaped = Math.pow(Math.min(Math.max(max, 0), 1), 0.45) * 1.15;
    return Math.min(shaped, 1);
  }, [levels]);

  // Fader width CSS var
  const faderWidth = effectiveSettings.faderColumnWidth;
  const faderContainerStyle = faderWidth > 0
    ? { "--fader-max-w": `${faderWidth}px` } as React.CSSProperties
    : undefined;

  return (
    <div className="flex flex-col h-dvh w-dvw overflow-hidden rounded-[10px] relative isolate">
      {/* Background layer — behind all content */}
      <BackgroundLayer
        showColor={bgProps.showColor}
        color={bgProps.color}
        colorOpacity={bgProps.colorOpacity}
        showVisualizer={bgProps.showVisualizer}
        visualizerPaused={bgProps.visualizerPaused}
        visualizerPreset={bgProps.visualizerPreset}
        visualizerOpacity={bgProps.visualizerOpacity}
        visualizerIntensity={bgProps.visualizerIntensity}
        masterLevel={masterLevel}
      />

      {/* Glass overlay — rendered via CSS on #root > div */}

      <Titlebar
        selectedA1={selectedA1}
        a1Choices={outputs}
        onA1Change={setSelectedA1}
        onSettingsClick={() => setSettingsOpen(true)}
        busGain={busGains.get(0) ?? 0}
        showOutputLevel={effectiveSettings.showOutputLevel}
        reconnecting={reconnecting}
        pinned={style.alwaysOnTop}
        onPinToggle={togglePinned}
        sizeLocked={style.sizeLocked}
        onSizeLockToggle={toggleSizeLock}
        controlMode={style.controlMode}
        onControlModeToggle={toggleControlMode}
        onShrinkToFit={shrinkToFit}
        minSize={minWindowSize}
        windowPresets={effectiveSettings.windowPresets ?? []}
      />

      {/* Channel faders */}
      <div
        className="flex-1 flex items-stretch overflow-x-auto px-[clamp(16px,2.8vw,24px)] pt-[clamp(14px,2.2dvh,20px)] pb-[clamp(14px,2dvh,18px)] gap-[clamp(8px,2vw,20px)] min-h-0"
        style={faderContainerStyle}
      >
        {loaded &&
          channelConfigs.map((ch) => {
            const state = channels.get(ch.strip) ?? {
              gain: ch.defaultDb,
              muted: false,
              mono: false,
              mc: false,
              solo: false,
              karaoke: 0,
            };
            const Control = style.controlMode === "knob" ? Knob : Fader;
            return (
              <Control
                key={ch.strip}
                label={ch.label}
                value={state.gain}
                min={ch.minDb}
                max={ch.maxDb}
                muted={state.muted}
                mono={state.mono}
                solo={state.solo}
                mc={state.mc}
                karaoke={state.karaoke}
                modeKind={modeKindFor(ch.strip)}
                level={levels.get(ch.strip) ?? 0}
                levelScale={ch.levelScale ?? 1}
                meterDecay={meterDecay}
                onChange={(v) => setGain(ch.strip, v)}
                onMuteToggle={(m) => setMute(ch.strip, m)}
                onMonoToggle={(v) => setMono(ch.strip, v)}
                onSoloToggle={(v) => setSolo(ch.strip, v)}
                onMcToggle={(v) => setMc(ch.strip, v)}
                onKaraokeChange={(v) => setKaraoke(ch.strip, v)}
                onDragStart={() => startDragging(ch.strip)}
                onDragEnd={() => stopDragging(ch.strip)}
              />
            );
          })}
      </div>

      {/* Bottom accent bar */}
      <div
        className="h-[clamp(2px,0.5dvh,4px)] shrink-0"
        style={{ backgroundColor: "var(--accent)" }}
      />

      {/* Settings panel */}
      <SettingsPanel
        open={settingsOpen}
        channels={channelConfigs}
        outputs={outputs}
        meterDecay={meterDecay}
        styleSettings={style}
        onSaveChannels={saveChannels}
        onSaveOutputs={saveOutputs}
        onSaveMeterDecay={saveMeterDecay}
        onSaveStyle={saveStyle}
        onPreviewStyle={setPreviewStyle}
        onClose={() => setSettingsOpen(false)}
      />

      {/* Cold-start gate — only until the first successful connection */}
      {!everConnected && !connected && (
        <ConnectionOverlay
          connection={connection}
          error={error}
          onLaunch={launchVoicemeeter}
        />
      )}
    </div>
  );
}
