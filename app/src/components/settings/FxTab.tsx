import { useState } from "react";
import type { FxGroup, FxAssignment } from "../../types/fx";
import type { EditionInfo } from "../../types/edition";
import type { ChannelConfig } from "../../config";
import { newGroup } from "../../lib/fxGroups";
import { describeAssignment, FX_PARAMS, defaultValue } from "../../lib/fxParams";
import HotkeyRecorder from "./HotkeyRecorder";
import FxAssignmentEditor from "./FxAssignmentEditor";
import {
  inputCls,
  smallText,
  medText,
  rowLabelCls,
  addButtonCls,
  removeButtonCls,
  arrowButtonCls,
} from "./shared";

interface FxTabProps {
  draft: FxGroup[];
  onChange: (next: FxGroup[]) => void;
  edition: EditionInfo;
  channels: ChannelConfig[];
  /** Groups as last saved — only these exist on the Rust side and can be toggled. */
  saved: FxGroup[];
  active: string[];
  onToggle: (id: string) => void;
  connected: boolean;
}

/**
 * FX preset groups. Each group is a hotkey plus a list of parameter values;
 * the group's position in this list is the number shown on its pill (FX1,
 * FX2, ...), which is why reordering is offered.
 */
export default function FxTab({ draft, onChange, edition, channels, saved, active, onToggle, connected }: FxTabProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const update = (id: string, patch: Partial<FxGroup>) => {
    onChange(draft.map((g) => (g.id === id ? { ...g, ...patch } : g)));
  };

  const updateAssignment = (id: string, idx: number, next: FxAssignment) => {
    const g = draft.find((x) => x.id === id);
    if (!g) return;
    update(id, { assignments: g.assignments.map((a, i) => (i === idx ? next : a)) });
  };

  const removeAssignment = (id: string, idx: number) => {
    const g = draft.find((x) => x.id === id);
    if (!g) return;
    update(id, { assignments: g.assignments.filter((_, i) => i !== idx) });
  };

  const addAssignment = (id: string) => {
    const g = draft.find((x) => x.id === id);
    if (!g) return;
    // Start from the most common case: a reverb send on the first configured
    // strip, or the master reverb switch if there are no channels yet.
    const strip = channels[0]?.strip ?? 0;
    const def = FX_PARAMS.find((p) => p.key === "strip.reverb")!;
    update(id, {
      assignments: [...g.assignments, { param: def.path(strip), value: defaultValue(def) }],
    });
  };

  const move = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= draft.length) return;
    const next = [...draft];
    [next[idx], next[target]] = [next[target], next[idx]];
    onChange(next);
  };

  const remove = (id: string) => {
    if (expanded === id) setExpanded(null);
    onChange(draft.filter((g) => g.id !== id));
  };

  const add = () => {
    const g = newGroup(draft.length + 1);
    onChange([...draft, g]);
    setExpanded(g.id);
  };

  return (
    <>
      <p className={`${smallText} text-white/50 m-0`}>
        A group applies its values when toggled on and restores the previous values when toggled off.
        Active groups show as FX pills along the bottom of the window.
      </p>
      {!edition.hasFx && (
        <p className={`${smallText} text-amber-300/70 m-0`}>
          Reverb, delay and FX sends need Voicemeeter Potato. You can still set up groups here.
        </p>
      )}

      {draft.map((g, idx) => {
        const isOpen = expanded === g.id;
        const savedGroup = saved.find((s) => s.id === g.id);
        const unsaved = !savedGroup || JSON.stringify(savedGroup.assignments) !== JSON.stringify(g.assignments);
        const isActive = active.includes(g.id);
        const toggleTitle = !connected
          ? "Voicemeeter is not connected"
          : unsaved
            ? "Save first to try this group"
            : isActive
              ? "Turn off"
              : "Turn on";
        return (
          <div key={g.id} className="bg-white/5 rounded-[4px] overflow-hidden shrink-0">
            <div className="flex items-center gap-[clamp(3px,0.8vw,6px)] p-[clamp(4px,1vw,8px)] flex-wrap">
              <div className="flex flex-col gap-0 shrink-0">
                <button className={arrowButtonCls} onClick={() => move(idx, -1)} disabled={idx === 0} title="Move up">
                  ▲
                </button>
                <button
                  className={arrowButtonCls}
                  onClick={() => move(idx, 1)}
                  disabled={idx === draft.length - 1}
                  title="Move down"
                >
                  ▼
                </button>
              </div>

              <span
                className={`${smallText} font-bold tabular-nums px-[clamp(3px,0.6vw,5px)] py-[1px] rounded-[3px] shrink-0`}
                style={{ backgroundColor: "var(--accent)", color: "var(--accent-fg)" }}
                title="Pill label"
              >
                FX{idx + 1}
              </span>

              <input
                className={`${inputCls} ${medText} px-[clamp(3px,0.5vw,6px)] py-[2px] w-[clamp(56px,14vw,96px)]`}
                value={g.name}
                onChange={(e) => update(g.id, { name: e.target.value })}
                placeholder="Name"
              />

              <span className={`${smallText} text-white/40 truncate min-w-0 flex-1`}>
                {g.assignments.length === 0
                  ? "No assignments"
                  : `${g.assignments.length} assignment${g.assignments.length === 1 ? "" : "s"}`}
              </span>

              <button
                className={`${inputCls} ${smallText} px-[clamp(4px,0.8vw,8px)] py-[1px] cursor-pointer shrink-0 disabled:opacity-30 disabled:cursor-default`}
                style={
                  isActive
                    ? { backgroundColor: "var(--accent)", color: "var(--accent-fg)", borderColor: "var(--accent)" }
                    : undefined
                }
                onClick={() => onToggle(g.id)}
                disabled={unsaved || !connected}
                aria-pressed={isActive}
                title={toggleTitle}
              >
                {isActive ? "On" : "Off"}
              </button>

              <button
                className={`${smallText} bg-transparent border-none cursor-pointer text-white/50 hover:text-white/90 px-1 shrink-0`}
                onClick={() => setExpanded(isOpen ? null : g.id)}
                aria-expanded={isOpen}
                title={isOpen ? "Hide" : "Edit"}
              >
                {isOpen ? "▲" : "▼"}
              </button>

              <button className={removeButtonCls} onClick={() => remove(g.id)} title="Remove group">
                ✕
              </button>
            </div>

            {isOpen && (
              <div className="border-t border-white/10 px-[clamp(6px,1.5vw,12px)] py-[clamp(4px,1vw,8px)] flex flex-col gap-[clamp(3px,0.8dvh,6px)]">
                <div className={`flex items-center gap-1 ${smallText} text-white/60 flex-wrap`}>
                  <span className={rowLabelCls}>Hotkey</span>
                  <HotkeyRecorder value={g.hotkey ?? ""} onChange={(accel) => update(g.id, { hotkey: accel })} />
                </div>

                <div className={`flex flex-col gap-[clamp(3px,0.8dvh,6px)] ${smallText}`}>
                  <span className="text-white/40">Sets</span>
                  {g.assignments.map((a, i) => (
                    <div key={i} className="flex flex-col gap-[2px] bg-white/5 rounded-[3px] p-[clamp(3px,0.6vw,5px)]">
                      <FxAssignmentEditor
                        value={a}
                        onChange={(next) => updateAssignment(g.id, i, next)}
                        onRemove={() => removeAssignment(g.id, i)}
                        edition={edition}
                        channels={channels}
                      />
                      <span className="text-white/35 truncate">{describeAssignment(a, edition, channels)}</span>
                    </div>
                  ))}
                  <button className={addButtonCls} onClick={() => addAssignment(g.id)}>
                    + Add value
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      <button className={addButtonCls} onClick={add}>
        + Add FX Group
      </button>
    </>
  );
}
