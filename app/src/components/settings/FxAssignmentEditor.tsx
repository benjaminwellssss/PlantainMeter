import type { FxAssignment } from "../../types/fx";
import type { EditionInfo } from "../../types/edition";
import type { ChannelConfig } from "../../config";
import {
  FX_TARGET_LABEL,
  paramsForTarget,
  parseParamPath,
  findParam,
  defaultValue,
  clampValue,
  type FxTarget,
  type FxParamDef,
} from "../../lib/fxParams";
import { inputCls, smallText, removeButtonCls } from "./shared";

interface FxAssignmentEditorProps {
  value: FxAssignment;
  onChange: (next: FxAssignment) => void;
  onRemove: () => void;
  edition: EditionInfo;
  channels: ChannelConfig[];
}

const TARGETS: FxTarget[] = ["global", "strip", "bus"];

/**
 * Three-step row: what to target (master FX / a strip / a bus), which
 * parameter, and its value with a control that fits the parameter type.
 * Serializes straight to `{ param, value }` so the Rust side stays generic.
 */
export default function FxAssignmentEditor({ value, onChange, onRemove, edition, channels }: FxAssignmentEditorProps) {
  const parsed = parseParamPath(value.param);

  // A path we don't recognise (hand-edited store, newer Voicemeeter): show it
  // raw rather than silently replacing it.
  if (!parsed) {
    return (
      <div className={`flex items-center gap-1 flex-wrap ${smallText} text-white/60`}>
        <input
          className={`${inputCls} ${smallText} px-1 py-[1px] flex-1 min-w-[80px] font-mono`}
          value={value.param}
          onChange={(e) => onChange({ ...value, param: e.target.value })}
          title="Raw Voicemeeter parameter"
        />
        <span>=</span>
        <input
          type="number"
          className={`${inputCls} ${smallText} w-[clamp(36px,8vw,52px)] px-1 py-[1px] text-center`}
          value={value.value}
          onChange={(e) => onChange({ ...value, value: Number(e.target.value) })}
        />
        <button className={removeButtonCls} onClick={onRemove} title="Remove">✕</button>
      </div>
    );
  }

  const { def, index } = parsed;
  const target = def.target;

  const emit = (nextDef: FxParamDef, nextIndex: number | undefined, nextValue: number) => {
    onChange({ param: nextDef.path(nextIndex), value: clampValue(nextDef, nextValue) });
  };

  const changeTarget = (t: FxTarget) => {
    const first = paramsForTarget(t)[0];
    const nextIndex = t === "global" ? undefined : 0;
    emit(first, nextIndex, defaultValue(first));
  };

  const changeParam = (key: string) => {
    const next = findParam(key);
    if (!next) return;
    // Keep the value when the control type is unchanged (send → send), else reset.
    const keep = next.control === def.control ? value.value : defaultValue(next);
    emit(next, index, keep);
  };

  const stripName = (i: number) => {
    const ch = channels.find((c) => c.strip === i);
    const base = edition.strips[i]?.label ?? `Strip ${i}`;
    return ch ? `${ch.label} (${i})` : `${i} — ${base}`;
  };

  const selectCls = `${inputCls} ${smallText} px-[clamp(2px,0.3vw,4px)] py-[1px] cursor-pointer max-w-full`;

  return (
    <div className={`flex items-center gap-1 flex-wrap ${smallText} text-white/60`}>
      <select
        className={selectCls}
        style={{ colorScheme: "dark" }}
        value={target}
        onChange={(e) => changeTarget(e.target.value as FxTarget)}
        title="Target"
      >
        {TARGETS.map((t) => (
          <option key={t} value={t}>
            {FX_TARGET_LABEL[t]}
          </option>
        ))}
      </select>

      {target === "strip" && (
        <select
          className={selectCls}
          style={{ colorScheme: "dark" }}
          value={index ?? 0}
          onChange={(e) => emit(def, Number(e.target.value), value.value)}
          title="Strip"
        >
          {edition.strips.map((s) => (
            <option key={s.index} value={s.index}>
              {stripName(s.index)}
            </option>
          ))}
          {index !== undefined && !edition.strips[index] && (
            <option value={index}>Strip {index} (not in this edition)</option>
          )}
        </select>
      )}

      {target === "bus" && (
        <select
          className={selectCls}
          style={{ colorScheme: "dark" }}
          value={index ?? 0}
          onChange={(e) => emit(def, Number(e.target.value), value.value)}
          title="Bus"
        >
          {edition.buses.map((b) => (
            <option key={b.index} value={b.index}>
              {b.label}
            </option>
          ))}
        </select>
      )}

      <select
        className={selectCls}
        style={{ colorScheme: "dark" }}
        value={def.key}
        onChange={(e) => changeParam(e.target.value)}
        title="Parameter"
      >
        {paramsForTarget(target).map((p) => (
          <option key={p.key} value={p.key}>
            {p.label}
          </option>
        ))}
      </select>

      {def.control === "send" && (
        <span className="flex items-center gap-1">
          <input
            type="range"
            min={def.min}
            max={def.max}
            step={def.step}
            value={value.value}
            onChange={(e) => emit(def, index, Number(e.target.value))}
            onDoubleClick={() => emit(def, index, 0)}
            className="w-[clamp(44px,12vw,80px)] accent-[var(--accent)] cursor-pointer"
            title="Send level (double-click to zero)"
          />
          <span className="tabular-nums w-[3.5ch] text-right text-white/80">{value.value.toFixed(1)}</span>
        </span>
      )}

      {def.control === "toggle" && (
        <button
          className={`${inputCls} ${smallText} px-[clamp(4px,0.8vw,8px)] py-[1px] cursor-pointer min-w-[3ch]`}
          style={
            value.value >= 0.5
              ? { backgroundColor: "var(--accent)", color: "var(--accent-fg)", borderColor: "var(--accent)" }
              : undefined
          }
          onClick={() => emit(def, index, value.value >= 0.5 ? 0 : 1)}
          aria-pressed={value.value >= 0.5}
        >
          {value.value >= 0.5 ? "On" : "Off"}
        </button>
      )}

      {def.control === "ab" && (
        <span className="flex items-center">
          {(["A", "B"] as const).map((side, i) => {
            const on = (value.value >= 0.5 ? 1 : 0) === i;
            return (
              <button
                key={side}
                className={`${inputCls} ${smallText} px-[clamp(4px,0.8vw,8px)] py-[1px] cursor-pointer ${i === 0 ? "rounded-r-none" : "rounded-l-none border-l-0"}`}
                style={
                  on
                    ? { backgroundColor: "var(--accent)", color: "var(--accent-fg)", borderColor: "var(--accent)" }
                    : undefined
                }
                onClick={() => emit(def, index, i)}
                aria-pressed={on}
              >
                {side}
              </button>
            );
          })}
        </span>
      )}

      <button className={`${removeButtonCls} ml-auto`} onClick={onRemove} title="Remove assignment">
        ✕
      </button>
    </div>
  );
}
