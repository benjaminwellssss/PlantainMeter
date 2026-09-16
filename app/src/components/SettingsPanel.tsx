import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { ChannelConfig, A1Device } from "../config";
import type { EditionInfo, LaunchEdition } from "../types/edition";
import type { FxGroup } from "../types/fx";
import type { StyleSettings } from "../types/style";
import { DEFAULT_STYLE_SETTINGS } from "../types/style";
import StyleTab from "./settings/StyleTab";
import ChannelsTab from "./settings/ChannelsTab";
import OutputsTab from "./settings/OutputsTab";
import FxTab from "./settings/FxTab";
import { autoDisplay } from "./settings/OutputsTab";
import { inputCls, smallText, medText } from "./settings/shared";

interface SettingsPanelProps {
  open: boolean;
  channels: ChannelConfig[];
  outputs: A1Device[];
  meterDecay: number;
  styleSettings: StyleSettings;
  fxGroups: FxGroup[];
  activeFx: string[];
  onToggleFx: (id: string) => void;
  connected: boolean;
  /** Edition to lay strips out for (live, or last seen when disconnected). */
  edition: EditionInfo;
  editionIsLive: boolean;
  launchEdition: LaunchEdition;
  onLaunchEditionChange: (next: LaunchEdition) => void;
  onSaveChannels: (channels: ChannelConfig[]) => void;
  onSaveOutputs: (outputs: A1Device[]) => void;
  onSaveMeterDecay: (decay: number) => void;
  onSaveStyle: (style: StyleSettings) => void;
  onSaveFxGroups: (groups: FxGroup[]) => void;
  onPreviewStyle?: (style: StyleSettings | null) => void;
  onClose: () => void;
}

type Tab = "style" | "channels" | "outputs" | "fx";
const TABS: Tab[] = ["style", "channels", "outputs", "fx"];
const TAB_LABEL: Record<Tab, string> = { style: "Style", channels: "Channels", outputs: "Outputs", fx: "FX" };

/**
 * Settings shell: tab bar, per-tab drafts seeded when the panel opens, and a
 * single Save that commits every draft at once. The tabs themselves live in
 * ./settings/ and only ever edit their draft through `onChange`.
 */
export default function SettingsPanel({
  open,
  channels,
  outputs,
  meterDecay,
  styleSettings,
  fxGroups,
  activeFx,
  onToggleFx,
  connected,
  edition,
  editionIsLive,
  launchEdition,
  onLaunchEditionChange,
  onSaveChannels,
  onSaveOutputs,
  onSaveMeterDecay,
  onSaveStyle,
  onSaveFxGroups,
  onPreviewStyle,
  onClose,
}: SettingsPanelProps) {
  const [tab, setTab] = useState<Tab>("style");
  const [chDraft, setChDraft] = useState<ChannelConfig[]>([]);
  const [outDraft, setOutDraft] = useState<A1Device[]>([]);
  const [decayDraft, setDecayDraft] = useState(0.3);
  const [styleDraft, setStyleDraft] = useState<StyleSettings>(DEFAULT_STYLE_SETTINGS);
  const [fxDraft, setFxDraft] = useState<FxGroup[]>([]);

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
      setFxDraft(fxGroups.map((g) => ({ ...g, assignments: g.assignments.map((a) => ({ ...a })) })));
    }
  }

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

  const handleSave = () => {
    // Auto-generate display from driver + name for outputs
    const finalOutputs = outDraft.map((o) => ({ ...o, display: o.display || autoDisplay(o) }));
    onSaveChannels(chDraft);
    onSaveOutputs(finalOutputs);
    onSaveMeterDecay(decayDraft);
    // alwaysOnTop isn't editable here — carry the live value so pinning while the
    // panel is open doesn't get reverted by a stale draft.
    onSaveStyle({ ...styleDraft, alwaysOnTop: styleSettings.alwaysOnTop });
    onSaveFxGroups(fxDraft);
    onClose();
  };

  return (
    <AnimatePresence>
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
              <span className="text-[clamp(0.7rem,2.5vw,0.95rem)] font-bold text-white/90">Settings</span>
              <button
                className="text-white/60 hover:text-white/90 text-[clamp(0.7rem,2vw,1rem)] bg-transparent border-none cursor-pointer p-1"
                onClick={onClose}
              >
                ✕
              </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 shrink-0 overflow-x-auto">
              {TABS.map((t) => (
                <button
                  key={t}
                  className={`px-[clamp(6px,1.5vw,12px)] py-[clamp(2px,0.5dvh,4px)] rounded-[3px] border-none cursor-pointer ${medText} font-semibold shrink-0`}
                  style={{
                    backgroundColor: tab === t ? "var(--accent)" : "rgba(255,255,255,0.1)",
                    color: tab === t ? "var(--accent-fg)" : "rgba(255,255,255,0.7)",
                  }}
                  onClick={() => setTab(t)}
                >
                  {TAB_LABEL[t]}
                </button>
              ))}
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto flex flex-col gap-[clamp(4px,1dvh,8px)] min-h-0">
              {tab === "channels" && (
                <ChannelsTab
                  draft={chDraft}
                  onChange={setChDraft}
                  edition={edition}
                  editionIsLive={editionIsLive}
                  launchEdition={launchEdition}
                  onLaunchEditionChange={onLaunchEditionChange}
                />
              )}

              {tab === "style" && (
                <StyleTab
                  draft={styleDraft}
                  onChange={setStyleDraft}
                  meterDecay={decayDraft}
                  onMeterDecayChange={setDecayDraft}
                  smallText={smallText}
                  medText={medText}
                  inputCls={inputCls}
                />
              )}

              {tab === "outputs" && <OutputsTab draft={outDraft} onChange={setOutDraft} />}

              {tab === "fx" && (
                <FxTab
                  draft={fxDraft}
                  onChange={setFxDraft}
                  edition={edition}
                  channels={chDraft}
                  saved={fxGroups}
                  active={activeFx}
                  onToggle={onToggleFx}
                  connected={connected}
                />
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
