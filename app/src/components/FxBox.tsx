import StripButton from "./StripButton";

interface FxBoxProps {
  /** This column's exact rendered width, in px — matches the control above it. */
  unit: number;
  /** Reverb/Delay send level, 0-10. `null` = this edition has no FX section
      (Standard) — the whole box is skipped in that case, see App.tsx. */
  reverbSend: number | null;
  delaySend: number | null;
  onReverbSendChange: (value: number) => void;
  onDelaySendChange: (value: number) => void;
}

/** Toggles a send knob: off -> straight to 5, anything on -> straight to 0. */
function toggleStep(value: number): number {
  return Math.round(value) > 0 ? 0 : 5;
}

/**
 * A second bounding box below each channel strip (same glass styling as the
 * Fader/Knob card above it) — houses the Reverb/Delay send macro buttons,
 * kept off the main strip so that only Mono/Solo/Mute live there.
 */
export default function FxBox({
  unit,
  reverbSend,
  delaySend,
  onReverbSendChange,
  onDelaySendChange,
}: FxBoxProps) {
  if (reverbSend === null && delaySend === null) return null;

  return (
    <div className="flex flex-col items-center shrink-0" style={{ width: unit }}>
      <div className="glass-border-glow rounded-[8px] p-[1px] w-full flex flex-col items-center">
        <div className="glass-panel rounded-[7px] p-[clamp(6px,1.2vw,10px)] flex gap-[clamp(2px,0.5vw,4px)] w-full">
          {reverbSend !== null && (
            <div className="flex-1 min-w-0">
              <StripButton
                label={Math.round(reverbSend) === 0 ? "Verb: Off" : `Verb: ${Math.round(reverbSend)}`}
                active={reverbSend > 0}
                onClick={() => onReverbSendChange(toggleStep(reverbSend))}
                title="Reverb send — toggles between off and 5"
              />
            </div>
          )}
          {delaySend !== null && (
            <div className="flex-1 min-w-0">
              <StripButton
                label={Math.round(delaySend) === 0 ? "Delay: Off" : `Delay: ${Math.round(delaySend)}`}
                active={delaySend > 0}
                onClick={() => onDelaySendChange(toggleStep(delaySend))}
                title="Delay send — toggles between off and 5"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
