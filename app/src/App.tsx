import { useState, useEffect, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import type { A1Device } from "./config";
import {
  modeKindFor,
  defaultChannelsFor,
  FADER_UNIT_MIN,
  FADER_UNIT_MAX,
  KNOB_UNIT_MIN,
  KNOB_UNIT_MAX,
  FADER_CONTENT_MIN_HEIGHT,
  KNOB_CONTENT_MIN_HEIGHT,
  FX_BOX_MIN_HEIGHT,
  TITLEBAR_HEIGHT,
  SPACING_BAR_HEIGHT,
  BOTTOM_BAR_HEIGHT,
  WINDOW_MIN_WIDTH,
  VERTICAL_MARGIN_RATIO,
} from "./config";
import { useVoicemeeter } from "./hooks/useVoicemeeter";
import { useAccentColor } from "./hooks/useAccentColor";
import { useChannelConfig } from "./hooks/useChannelConfig";
import { useStyleSettings } from "./hooks/useStyleSettings";
import { useWindowFocus } from "./hooks/useWindowFocus";
import { useGlobalShortcuts } from "./hooks/useGlobalShortcuts";
import { useControlUnit, minWidthForUnit } from "./hooks/useControlUnit";
import SpacingSliders from "./components/SpacingSliders";
import type { StyleSettings } from "./types/style";
import Titlebar from "./components/Titlebar";
import Fader from "./components/Fader";
import Knob from "./components/Knob";
import FxBox from "./components/FxBox";
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

  const { channels: channelConfigs, saveChannels, outputs, saveOutputs, meterDecay, saveMeterDecay, loaded, needsOutputSetup, setNeedsOutputSetup, needsChannelSetup, setNeedsChannelSetup } = useChannelConfig();

  const {
    connection,
    connected,
    everConnected,
    error,
    edition,
    channels,
    levels,
    busGains,
    setGain,
    setMute,
    setMono,
    setSolo,
    setMc,
    setKaraoke,
    setReverbSend,
    setDelaySend,
    startDragging,
    stopDragging,
    launchVoicemeeter,
  } = useVoicemeeter(channelConfigs);

  // Extra per-channel height for FxBox (Reverb/Delay macros) — only Banana
  // and Potato have an FX section at all. Defaults to "has it" before the
  // edition is known, same as the rest of the app falling back to Potato's
  // (the superset) layout.
  const hasFxSection = (edition ?? "potato") !== "standard";

  const isKnobMode = style.controlMode === "knob";
  const unitMin = isKnobMode ? KNOB_UNIT_MIN : FADER_UNIT_MIN;
  const unitMax = isKnobMode ? KNOB_UNIT_MAX : FADER_UNIT_MAX;
  const contentMinHeight = isKnobMode ? KNOB_CONTENT_MIN_HEIGHT : FADER_CONTENT_MIN_HEIGHT;
  const gapMultiplier = style.gapMultiplier;
  const marginMultiplier = style.marginMultiplier;

  const setGapMultiplier = (v: number) => saveStyle({ ...style, gapMultiplier: v });
  const setMarginMultiplier = (v: number) => saveStyle({ ...style, marginMultiplier: v });

  const rowRef = useRef<HTMLDivElement>(null);
  const channelCount = channelConfigs.length;
  // The one shared sizing unit for the whole row — see useControlUnit for the
  // math. Margins and gaps below are `marginMultiplier` and `gapMultiplier`
  // units of this (adjustable via the titlebar sliders), so they scale
  // proportionally with the controls instead of drifting.
  const unit = useControlUnit(rowRef, channelCount, unitMin, unitMax, gapMultiplier, marginMultiplier);

  // Smallest usable window size for the current control mode. Width is the
  // exact point where N controls + their gaps + margins on both sides fit at
  // the unit's own minimum (see useControlUnit's math); height adds a margin
  // top and bottom to the natural content height, so "ample, even,
  // proportional clear space" holds even at the floor.
  const minWindowSize = useMemo(() => {
    const width = Math.max(
      WINDOW_MIN_WIDTH,
      minWidthForUnit(channelCount, unitMin, gapMultiplier, marginMultiplier),
    );
    const height =
      TITLEBAR_HEIGHT +
      SPACING_BAR_HEIGHT +
      unitMin * 2 * marginMultiplier * VERTICAL_MARGIN_RATIO +
      contentMinHeight +
      (hasFxSection ? FX_BOX_MIN_HEIGHT + unitMin * gapMultiplier * VERTICAL_MARGIN_RATIO : 0) +
      BOTTOM_BAR_HEIGHT;
    return { width: Math.round(width), height: Math.round(height) };
  }, [channelCount, unitMin, contentMinHeight, gapMultiplier, marginMultiplier, hasFxSection]);

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

  // First run for this edition: no saved channel config yet, so seed one
  // that actually matches the running edition's strip layout (Banana's
  // virtual strips start at 3, Potato's at 5) instead of always assuming
  // Potato. Only fires once — `needsChannelSetup` flips off after saving.
  useEffect(() => {
    if (!connected || !edition || !needsChannelSetup) return;
    saveChannels(defaultChannelsFor(edition));
    setNeedsChannelSetup(false);
  }, [connected, edition, needsChannelSetup, saveChannels, setNeedsChannelSetup]);

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

  // Manual fader-width override (Settings > Style) — takes priority over the
  // auto-computed unit for the control's own rendered width, but margins and
  // gaps keep following the unit either way.
  const faderWidthOverride = effectiveSettings.faderColumnWidth;
  const faderContainerStyle = faderWidthOverride > 0
    ? { "--fader-max-w": `${faderWidthOverride}px` } as React.CSSProperties
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

      {/* Gap / clear-space sliders — top-middle, drive the same multipliers
          useControlUnit uses, so dragging them live-adjusts the proportional
          system rather than fighting it. */}
      <SpacingSliders
        gapMultiplier={gapMultiplier}
        marginMultiplier={marginMultiplier}
        onGapChange={setGapMultiplier}
        onMarginChange={setMarginMultiplier}
      />

      {/* Channel faders — margins and gap are both driven by `unit` (see
          useControlUnit), so clear space scales proportionally with the
          controls themselves instead of being tuned by hand. The vertical
          margin is scaled down from the horizontal one (VERTICAL_MARGIN_RATIO)
          — a single control's height has nothing to do with the combined
          width of a whole row, so using the same absolute value for both
          read as a huge empty band top and bottom. justify-center means any
          leftover space (once `unit` hits its max, e.g. very few channels in
          a wide window) is split evenly on both sides instead of piling up
          on the right — resizing either edge keeps the group centered.
          overflow-x-auto + a real scrollbar (channel-row, in App.css) is a
          hard backstop: even if the math above were ever wrong, content
          becomes reachable by scrolling instead of hidden behind the window
          edge. */}
      <div
        ref={rowRef}
        className="channel-row flex-1 flex items-stretch justify-center overflow-x-auto min-h-0"
        style={{
          ...faderContainerStyle,
          paddingLeft: unit * marginMultiplier,
          paddingRight: unit * marginMultiplier,
          paddingTop: unit * marginMultiplier * VERTICAL_MARGIN_RATIO,
          paddingBottom: unit * marginMultiplier * VERTICAL_MARGIN_RATIO,
          gap: unit * gapMultiplier,
        }}
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
              reverbSend: null,
              delaySend: null,
            };
            const Control = style.controlMode === "knob" ? Knob : Fader;
            return (
              <div key={ch.strip} className="flex flex-col items-center justify-center shrink-0" style={{ gap: unit * gapMultiplier * VERTICAL_MARGIN_RATIO }}>
                <Control
                  label={ch.label}
                  value={state.gain}
                  min={ch.minDb}
                  max={ch.maxDb}
                  unit={unit}
                  muted={state.muted}
                  mono={state.mono}
                  solo={state.solo}
                  mc={state.mc}
                  karaoke={state.karaoke}
                  modeKind={modeKindFor(ch.strip, edition ?? "potato")}
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
                <FxBox
                  unit={unit}
                  reverbSend={state.reverbSend}
                  delaySend={state.delaySend}
                  onReverbSendChange={(v) => setReverbSend(ch.strip, v)}
                  onDelaySendChange={(v) => setDelaySend(ch.strip, v)}
                />
              </div>
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
