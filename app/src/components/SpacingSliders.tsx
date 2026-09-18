interface SpacingSlidersProps {
  gapMultiplier: number;
  marginMultiplier: number;
  onGapChange: (value: number) => void;
  onMarginChange: (value: number) => void;
}

/** Top-middle strip controlling the two spacing multipliers useControlUnit
    scales everything from: gap between controls, and clear space around the
    whole group — both expressed as a multiple of one control's own width. */
export default function SpacingSliders({ gapMultiplier, marginMultiplier, onGapChange, onMarginChange }: SpacingSlidersProps) {
  return (
    <div className="shrink-0 flex items-center justify-center gap-[clamp(8px,3vw,20px)] h-[clamp(16px,4dvh,22px)] px-[clamp(4px,1vw,8px)]">
      <label
        className="flex items-center gap-[clamp(2px,0.6vw,5px)] text-[clamp(0.45rem,1.4vw,0.6rem)] font-bold uppercase tracking-wide text-white/60 cursor-pointer select-none"
        title="Gap between faders/knobs"
      >
        Gap
        <input
          type="range"
          min={0}
          max={1.5}
          step={0.05}
          value={gapMultiplier}
          onChange={(e) => onGapChange(Number(e.target.value))}
          className="w-[clamp(30px,8vw,64px)] accent-[var(--accent)] cursor-pointer"
        />
      </label>
      <label
        className="flex items-center gap-[clamp(2px,0.6vw,5px)] text-[clamp(0.45rem,1.4vw,0.6rem)] font-bold uppercase tracking-wide text-white/60 cursor-pointer select-none"
        title="Clear space around the whole group"
      >
        Edge
        <input
          type="range"
          min={0.25}
          max={2.5}
          step={0.05}
          value={marginMultiplier}
          onChange={(e) => onMarginChange(Number(e.target.value))}
          className="w-[clamp(30px,8vw,64px)] accent-[var(--accent)] cursor-pointer"
        />
      </label>
    </div>
  );
}
