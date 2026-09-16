import { useState } from "react";
import type { ChannelConfig } from "../../config";
import type { EditionInfo, LaunchEdition } from "../../types/edition";
import { EDITION_NAMES, stripLabel, shortStripLabel } from "../../lib/editions";
import HotkeyRecorder from "./HotkeyRecorder";
import {
  inputCls,
  smallText,
  medText,
  rowLabelCls,
  sectionCls,
  addButtonCls,
  removeButtonCls,
  arrowButtonCls,
} from "./shared";

interface ChannelsTabProps {
  draft: ChannelConfig[];
  onChange: (next: ChannelConfig[]) => void;
  /** Edition to lay strips out for (live, or last seen when disconnected). */
  edition: EditionInfo;
  editionIsLive: boolean;
  launchEdition: LaunchEdition;
  onLaunchEditionChange: (next: LaunchEdition) => void;
}

const LAUNCH_OPTIONS: { value: LaunchEdition; label: string }[] = [
  { value: "auto", label: "Auto (last seen, else newest installed)" },
  { value: "potato", label: "Voicemeeter Potato" },
  { value: "banana", label: "Voicemeeter Banana" },
];

export default function ChannelsTab({
  draft,
  onChange,
  edition,
  editionIsLive,
  launchEdition,
  onLaunchEditionChange,
}: ChannelsTabProps) {
  // Only one channel's details open at a time — the row was too dense flat.
  const [expandedCh, setExpandedCh] = useState<number | null>(null);

  const availableStrips = edition.strips.map((s) => s.index);

  /**
   * Strip options for one row: every strip of the current edition, plus this
   * row's own strip if it is out of range (a Potato config viewed while Banana
   * is running) so editing never silently drops a configured channel.
   */
  const stripOptionsFor = (strip: number): number[] =>
    availableStrips.includes(strip) ? availableStrips : [...availableStrips, strip];

  const updateField = (idx: number, field: keyof ChannelConfig, value: string | number | boolean) => {
    onChange(draft.map((ch, i) => (i === idx ? { ...ch, [field]: value } : ch)));
  };

  const removeChannel = (idx: number) => {
    setExpandedCh(null);
    onChange(draft.filter((_, i) => i !== idx));
  };

  const moveChannel = (idx: number, dir: -1 | 1) => {
    setExpandedCh(null);
    const target = idx + dir;
    if (target < 0 || target >= draft.length) return;
    const next = [...draft];
    [next[idx], next[target]] = [next[target], next[idx]];
    onChange(next);
  };

  const addChannel = () => {
    const usedStrips = new Set(draft.map((c) => c.strip));
    const nextStrip = availableStrips.find((s) => !usedStrips.has(s)) ?? 0;
    onChange([
      ...draft,
      {
        label: shortStripLabel(edition, nextStrip),
        strip: nextStrip,
        hasMute: false,
        minDb: -36,
        maxDb: 12,
        defaultDb: 0,
        levelScale: 1,
      },
    ]);
  };

  return (
    <>
      {/* Edition — which Voicemeeter we lay strips out for, and which to launch */}
      <div className={sectionCls}>
        <div className={`flex items-center gap-1 ${smallText} text-white/60 flex-wrap`}>
          <span className={rowLabelCls}>Edition</span>
          <span className="text-white/80 font-semibold">{EDITION_NAMES[edition.edition]}</span>
          <span className="text-white/35">
            {editionIsLive ? "(detected)" : "(last seen — Voicemeeter not running)"}
          </span>
        </div>
        <div className={`flex items-center gap-1 ${smallText} text-white/60 flex-wrap`}>
          <span className={rowLabelCls}>Launch</span>
          <select
            className={`${inputCls} ${smallText} px-[clamp(2px,0.3vw,4px)] py-[2px] cursor-pointer max-w-full`}
            style={{ colorScheme: "dark" }}
            value={launchEdition}
            onChange={(e) => onLaunchEditionChange(e.target.value as LaunchEdition)}
            title="Edition started by the Launch Voicemeeter button"
          >
            {LAUNCH_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {draft.map((ch, idx) => {
        const expanded = expandedCh === idx;
        const clampedDefault = Math.max(ch.minDb, Math.min(ch.maxDb, ch.defaultDb));
        const defaultOutOfRange = ch.defaultDb !== clampedDefault;
        const stripOutOfRange = !availableStrips.includes(ch.strip);

        return (
          <div key={idx} className="bg-white/5 rounded-[4px] overflow-hidden shrink-0">
            {/* Compact header — identity only, so the list stays scannable */}
            <div className="flex items-center gap-[clamp(3px,0.8vw,6px)] p-[clamp(4px,1vw,8px)]">
              <div className="flex flex-col gap-0 shrink-0">
                <button className={arrowButtonCls} onClick={() => moveChannel(idx, -1)} disabled={idx === 0} title="Move up">
                  ▲
                </button>
                <button
                  className={arrowButtonCls}
                  onClick={() => moveChannel(idx, 1)}
                  disabled={idx === draft.length - 1}
                  title="Move down"
                >
                  ▼
                </button>
              </div>

              <input
                className={`${inputCls} ${medText} px-[clamp(3px,0.5vw,6px)] py-[2px] w-[clamp(48px,12vw,80px)]`}
                value={ch.label}
                onChange={(e) => updateField(idx, "label", e.target.value)}
                placeholder="Label"
              />

              <select
                className={`${inputCls} ${smallText} px-[clamp(2px,0.3vw,4px)] py-[2px] cursor-pointer`}
                style={{ colorScheme: "dark" }}
                value={ch.strip}
                onChange={(e) => updateField(idx, "strip", Number(e.target.value))}
              >
                {stripOptionsFor(ch.strip).map((s) => (
                  <option key={s} value={s}>
                    Strip {s} — {stripLabel(edition, s)}
                  </option>
                ))}
              </select>
              {stripOutOfRange && (
                <span
                  className={`${smallText} text-amber-300/80 cursor-help shrink-0`}
                  title={`Strip ${ch.strip} does not exist in ${EDITION_NAMES[edition.edition]}. Kept so you don't lose it.`}
                >
                  ⚠
                </span>
              )}

              <label className={`flex items-center gap-1 ${smallText} text-white/70 cursor-pointer select-none shrink-0`}>
                <input
                  type="checkbox"
                  checked={ch.hasMute}
                  onChange={(e) => updateField(idx, "hasMute", e.target.checked)}
                  className="accent-[var(--accent)] cursor-pointer"
                />
                Mute
              </label>

              <button
                className={`ml-auto ${smallText} bg-transparent border-none cursor-pointer text-white/50 hover:text-white/90 px-1 shrink-0`}
                onClick={() => setExpandedCh(expanded ? null : idx)}
                aria-expanded={expanded}
                title={expanded ? "Hide settings" : "More settings"}
              >
                {expanded ? "▲" : "▼"}
              </button>

              <button className={removeButtonCls} onClick={() => removeChannel(idx)} title="Remove channel">
                ✕
              </button>
            </div>

            {expanded && (
              <div className="border-t border-white/10 px-[clamp(6px,1.5vw,12px)] py-[clamp(4px,1vw,8px)] flex flex-col gap-[clamp(3px,0.8dvh,6px)]">
                {/* Range */}
                <div className={`flex items-center gap-1 ${smallText} text-white/60 flex-wrap`}>
                  <span className={rowLabelCls}>Range</span>
                  <input
                    type="number"
                    className={`${inputCls} ${smallText} w-[clamp(30px,7vw,44px)] px-1 py-[1px] text-center`}
                    value={ch.minDb}
                    onChange={(e) => updateField(idx, "minDb", Number(e.target.value))}
                  />
                  <span>to</span>
                  <input
                    type="number"
                    className={`${inputCls} ${smallText} w-[clamp(30px,7vw,44px)] px-1 py-[1px] text-center`}
                    value={ch.maxDb}
                    onChange={(e) => updateField(idx, "maxDb", Number(e.target.value))}
                  />
                  <span>dB</span>
                </div>

                {/* Default — what a double-click on the fader snaps to */}
                <div className={`flex items-center gap-1 ${smallText} text-white/60 flex-wrap`}>
                  <span className={rowLabelCls}>Default</span>
                  <input
                    type="number"
                    className={`${inputCls} ${smallText} w-[clamp(30px,7vw,44px)] px-1 py-[1px] text-center`}
                    value={ch.defaultDb}
                    onChange={(e) => updateField(idx, "defaultDb", Number(e.target.value))}
                  />
                  <span>dB</span>
                  {defaultOutOfRange && (
                    <span
                      className="text-amber-300/80 cursor-help"
                      title={`Outside this channel's range — a double-click will land on ${clampedDefault} dB instead.`}
                    >
                      ⚠
                    </span>
                  )}
                  <span className="text-white/35">double-click the fader</span>
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
                    onChange={(e) => updateField(idx, "levelScale", Number(e.target.value))}
                    onDoubleClick={() => updateField(idx, "levelScale", 1)}
                    className="w-[clamp(40px,10vw,64px)] accent-[var(--accent)] cursor-pointer"
                  />
                  <span className="tabular-nums w-[3ch] text-right">{(ch.levelScale ?? 1).toFixed(1)}x</span>
                </div>

                {/* Mute hotkey */}
                {ch.hasMute && (
                  <div className={`flex items-center gap-1 ${smallText} text-white/60 flex-wrap`}>
                    <span className={rowLabelCls}>Hotkey</span>
                    <HotkeyRecorder
                      value={ch.muteHotkey ?? ""}
                      onChange={(accel) => updateField(idx, "muteHotkey", accel)}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {draft.length < edition.stripCount && (
        <button className={addButtonCls} onClick={addChannel}>
          + Add Channel
        </button>
      )}
    </>
  );
}
