import { useState, useEffect, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { A1Device } from "./config";
import { useVoicemeeter } from "./hooks/useVoicemeeter";
import { useAccentColor } from "./hooks/useAccentColor";
import { useChannelConfig } from "./hooks/useChannelConfig";
import { useStyleSettings } from "./hooks/useStyleSettings";
import { useWindowFocus } from "./hooks/useWindowFocus";
import { useGlobalShortcuts } from "./hooks/useGlobalShortcuts";
import { useEditionInfo } from "./hooks/useEditionInfo";
import type { StyleSettings } from "./types/style";
import Titlebar from "./components/Titlebar";
import Fader from "./components/Fader";
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

  // Whole-window opacity. Uses effectiveSettings so dragging the slider in
  // Settings previews live, unlike the pin which must not follow previews.
  useEffect(() => {
    if (!styleLoaded) return;
    invoke("set_window_opacity", { opacity: effectiveSettings.globalOpacity ?? 1 }).catch(() => {});
  }, [effectiveSettings.globalOpacity, styleLoaded]);

  const { channels: channelConfigs, saveChannels, outputs, saveOutputs, meterDecay, saveMeterDecay, loaded, needsOutputSetup, setNeedsOutputSetup } = useChannelConfig();
  const {
    connection,
    connected,
    everConnected,
    liveEdition,
    error,
    channels,
    levels,
    busGains,
    setGain,
    setMute,
    startDragging,
    stopDragging,
    launchVoicemeeter,
  } = useVoicemeeter(channelConfigs);

  // Which Voicemeeter to lay strips out for: live while connected, else last seen.
  const { edition, isLive: editionIsLive, launchEdition, saveLaunchEdition } =
    useEditionInfo(liveEdition);

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

  // Master level for visualizers: max of all strip levels
  const masterLevel = useMemo(() => {
    let max = 0;
    for (const v of levels.values()) {
      if (v > max) max = v;
    }
    return max;
  }, [levels]);

  // Fader width CSS var
  const faderWidth = effectiveSettings.faderColumnWidth;
  const faderContainerStyle = faderWidth > 0
    ? { "--fader-max-w": `${faderWidth}px` } as React.CSSProperties
    : undefined;

  return (
    <div className="flex flex-col h-dvh w-dvw overflow-hidden rounded-[6px] relative isolate">
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
        windowPresets={effectiveSettings.windowPresets ?? []}
      />

      {/* Channel faders */}
      <div
        className="flex-1 flex items-stretch px-[clamp(6px,2vw,16px)] pt-[clamp(4px,1.5dvh,12px)] pb-[clamp(4px,1dvh,8px)] gap-[clamp(4px,1.5vw,16px)] min-h-0"
        style={faderContainerStyle}
      >
        {loaded &&
          channelConfigs.map((ch) => {
            const state = channels.get(ch.strip) ?? {
              gain: ch.defaultDb,
              muted: false,
            };
            return (
              <Fader
                key={ch.strip}
                label={ch.label}
                value={state.gain}
                min={ch.minDb}
                max={ch.maxDb}
                hasMute={ch.hasMute}
                muted={state.muted}
                level={levels.get(ch.strip) ?? 0}
                levelScale={ch.levelScale ?? 1}
                meterDecay={meterDecay}
                onChange={(v) => setGain(ch.strip, v)}
                onMuteToggle={(m) => setMute(ch.strip, m)}
                onDragStart={() => startDragging(ch.strip)}
                onDragEnd={() => stopDragging(ch.strip)}
                defaultDb={ch.defaultDb}
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
        edition={edition}
        editionIsLive={editionIsLive}
        launchEdition={launchEdition}
        onLaunchEditionChange={saveLaunchEdition}
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
          launchEdition={launchEdition}
          onLaunchEditionChange={saveLaunchEdition}
          onLaunch={launchVoicemeeter}
        />
      )}
    </div>
  );
}
