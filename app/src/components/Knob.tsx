import { useRef, useCallback, useEffect, useLayoutEffect, useState } from "react";
import { useSpring, useMotionValueEvent } from "framer-motion";
import { WHEEL_STEP_DB, UNITY_DB, KNOB_COLUMN_MIN_WIDTH, KARAOKE_LABELS } from "../config";
import type { ModeKind } from "../config";
import MuteButton from "./MuteButton";
import StripButton from "./StripButton";

interface KnobProps {
  label: string;
  value: number;
  min: number;
  max: number;
  muted: boolean;
  /** Strip[i].Mono — hardware strips only. */
  mono: boolean;
  solo: boolean;
  /** Strip[i].MC (mute-center, for dialogue) — first virtual strip only. */
  mc: boolean;
  /** Strip[i].K, 0-4 — second virtual strip only. */
  karaoke: number;
  /** Which control this channel's top button shows — Mono, MC, or the Karaoke cycle. */
  modeKind: ModeKind;
  level: number;
  levelScale: number;
  meterDecay: number;
  onChange: (value: number) => void;
  onMuteToggle: (muted: boolean) => void;
  onMonoToggle: (value: boolean) => void;
  onSoloToggle: (value: boolean) => void;
  onMcToggle: (value: boolean) => void;
  onKaraokeChange: (value: number) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}

/** Treat two presses this close together as a double-click. */
const DOUBLE_CLICK_MS = 350;
/** Vertical drag distance (px) that sweeps the full min→max range. */
const DRAG_PIXELS_FOR_FULL_SWEEP = 150;

// Dial geometry — a 270° sweep with a 90° gap centered at the bottom, in an
// angle system where 0° = east and angles increase clockwise (SVG's y-down).
const CX = 20;
const CY = 20;
const R_TRACK = 14;
const R_METER = 17;
const R_POINTER_OUT = 12;
const R_POINTER_IN = 5;
const TRACK_START = 135;
const SWEEP = 270;

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

/** SVG arc path from startAngle to endAngle (degrees, clockwise). Empty for a near-zero span. */
function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  if (endAngle - startAngle < 0.5) return "";
  const start = polarToCartesian(cx, cy, r, startAngle);
  const end = polarToCartesian(cx, cy, r, endAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 1 ${end.x} ${end.y}`;
}

const TRACK_D = describeArc(CX, CY, R_TRACK, TRACK_START, TRACK_START + SWEEP);
// Static outline for the level-meter ring, so it's visible (as an empty gutter)
// even at zero signal — otherwise an idle knob looks like it has no meter at all.
const METER_TRACK_D = describeArc(CX, CY, R_METER, TRACK_START, TRACK_START + SWEEP);
/** The visualizer's accent color — distinct from the UI-accent-colored gain fill, so the live level reads as its own indicator. */
const METER_COLOR = "var(--viz-color)";

/**
 * Same functionality as Fader (drag/wheel/double-click-to-unity, mute, live
 * level meter) in a fixed-size rotary control — no flex-1 vertical stretch,
 * so a row of these needs far less height than a row of faders.
 */
export default function Knob({
  label,
  value,
  min,
  max,
  muted,
  mono,
  solo,
  mc,
  karaoke,
  modeKind,
  level,
  levelScale,
  meterDecay,
  onChange,
  onMuteToggle,
  onMonoToggle,
  onSoloToggle,
  onMcToggle,
  onKaraokeChange,
  onDragStart,
  onDragEnd,
}: KnobProps) {
  const isDragging = useRef(false);
  // Drives the glow while the knob is actively being turned.
  const [active, setActive] = useState(false);

  // --- Live level meter (smooth tracking, silence hold + configurable decay) ---
  const meterPathRef = useRef<SVGPathElement>(null);
  const targetLevel = useRef(0);
  const displayLevel = useRef(0);
  const lastSignalTime = useRef(0);
  const rafRef = useRef<number>(0);
  const decayRef = useRef(meterDecay);

  useEffect(() => {
    targetLevel.current = level * levelScale;
  }, [level, levelScale]);

  useEffect(() => {
    decayRef.current = meterDecay;
  }, [meterDecay]);

  useEffect(() => {
    let lastTime = performance.now();
    const SIGNAL_THRESHOLD = 0.005;
    const HOLD_MS = 200;
    const ATTACK_SPEED = 14;
    const RELEASE_SPEED = 10;

    const animate = (now: number) => {
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      const target = targetLevel.current;
      const current = displayLevel.current;

      if (target > SIGNAL_THRESHOLD) {
        // Signal present — smooth exponential tracking
        lastSignalTime.current = now;
        const speed = target >= current ? ATTACK_SPEED : RELEASE_SPEED;
        const factor = 1 - Math.exp(-speed * dt);
        displayLevel.current = current + (target - current) * factor;
      } else if (now - lastSignalTime.current > HOLD_MS) {
        // Silence — creep down at configurable decay speed
        displayLevel.current = Math.max(0, current - decayRef.current * dt);
      }
      // else: within hold period, keep current level

      if (meterPathRef.current) {
        const frac = Math.min(displayLevel.current, 1);
        meterPathRef.current.setAttribute("d", describeArc(CX, CY, R_METER, TRACK_START, TRACK_START + frac * SWEEP));
      }

      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  // Normalized 0..1 where 0 = min (lower-left rest position), 1 = max (lower-right)
  const norm = (value - min) / (max - min);

  // Spring-animated position for smooth external updates
  const springNorm = useSpring(norm, { damping: 30, stiffness: 300 });

  useEffect(() => {
    if (!isDragging.current) springNorm.set(norm);
  }, [norm, springNorm]);

  // Fill arc + pointer needle track the spring imperatively (no per-frame re-render)
  const fillPathRef = useRef<SVGPathElement>(null);
  const pointerRef = useRef<SVGLineElement>(null);

  const updateVisuals = useCallback((v: number) => {
    const angle = TRACK_START + v * SWEEP;
    if (fillPathRef.current) {
      fillPathRef.current.setAttribute("d", describeArc(CX, CY, R_TRACK, TRACK_START, angle));
    }
    if (pointerRef.current) {
      const inner = polarToCartesian(CX, CY, R_POINTER_IN, angle);
      const outer = polarToCartesian(CX, CY, R_POINTER_OUT, angle);
      pointerRef.current.setAttribute("x1", String(inner.x));
      pointerRef.current.setAttribute("y1", String(inner.y));
      pointerRef.current.setAttribute("x2", String(outer.x));
      pointerRef.current.setAttribute("y2", String(outer.y));
    }
  }, []);

  useMotionValueEvent(springNorm, "change", updateVisuals);
  // Paint the initial position before the first frame — otherwise the needle
  // and fill are missing until the spring's first "change" event fires.
  useLayoutEffect(() => {
    updateVisuals(springNorm.get());
  }, [springNorm, updateVisuals]);

  // --- Dragging — vertical drag distance maps to a value delta, since a knob
  // (unlike a fader track) has no absolute position to click into. ---
  const drag = useRef<{ pointerId: number; startY: number; startNorm: number } | null>(null);
  const lastPressTime = useRef(0);
  // A quick drag-release-drag must not be mistaken for a double-click, so a
  // gesture that actually moved disqualifies the next press.
  const movedDuringDrag = useRef(false);

  const applyNorm = useCallback(
    (n: number) => {
      const clamped = Math.max(0, Math.min(1, n));
      springNorm.jump(clamped);
      updateVisuals(clamped);
      const db = min + clamped * (max - min);
      onChange(Math.round(db * 10) / 10);
    },
    [max, min, onChange, springNorm, updateVisuals],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;

      const now = performance.now();
      const isDoubleClick = now - lastPressTime.current < DOUBLE_CLICK_MS;
      lastPressTime.current = now;

      if (isDoubleClick) {
        // Snap to unity (0 dB), same as double-clicking a fader.
        const target = Math.max(min, Math.min(max, UNITY_DB));
        applyNorm((target - min) / (max - min));
        return;
      }

      drag.current = { pointerId: e.pointerId, startY: e.clientY, startNorm: springNorm.get() };
      movedDuringDrag.current = false;
      e.currentTarget.setPointerCapture(e.pointerId);
      e.preventDefault();
      isDragging.current = true;
      setActive(true);
      onDragStart();
    },
    [applyNorm, max, min, onDragStart, springNorm],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const state = drag.current;
      if (!state || state.pointerId !== e.pointerId) return;

      const deltaY = state.startY - e.clientY;
      if (Math.abs(deltaY) > 3) movedDuringDrag.current = true;
      applyNorm(state.startNorm + deltaY / DRAG_PIXELS_FOR_FULL_SWEEP);
    },
    [applyNorm],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const state = drag.current;
      if (!state || state.pointerId !== e.pointerId) return;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      drag.current = null;
      isDragging.current = false;
      setActive(false);
      // Only a stationary press can begin a double-click.
      if (movedDuringDrag.current) lastPressTime.current = 0;
      onDragEnd();
    },
    [onDragEnd],
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      const direction = e.deltaY < 0 ? 1 : -1;
      const newVal = Math.max(min, Math.min(max, value + WHEEL_STEP_DB * direction));
      onChange(Math.round(newVal * 10) / 10);
    },
    [min, max, value, onChange],
  );

  const formatDb = (v: number): string => {
    const rounded = Math.round(v);
    const sign = rounded >= 0 ? "+" : "-";
    return `${sign}${String(Math.abs(rounded)).padStart(2, "0")} dB`;
  };

  // Unity (0 dB) tick — hidden if the channel's range doesn't include it.
  const unityInRange = min <= UNITY_DB && UNITY_DB <= max;
  const unityAngle = TRACK_START + ((UNITY_DB - min) / (max - min)) * SWEEP;
  const unityInner = polarToCartesian(CX, CY, R_TRACK - 3, unityAngle);
  const unityOuter = polarToCartesian(CX, CY, R_TRACK + 3, unityAngle);

  return (
    <div
      className="flex flex-col items-center justify-start gap-[clamp(4px,1.2dvh,8px)] flex-1 h-full"
      style={{ minWidth: KNOB_COLUMN_MIN_WIDTH }}
    >
      {/* Channel label — laid out top-first (not centered) so it's the last
          thing to ever get cropped if a column runs short on height. */}
      <span className="text-crisp text-[clamp(0.65rem,2.6vw,0.9rem)] font-extrabold uppercase tracking-widest text-white truncate w-full text-center shrink-0">
        {label}
      </span>

      {/* Knob border — sized as a % of its own column (not vw), so it can't
          overshoot when there are many channels; leaves clear space on both
          sides within the column, on top of the row's own gap. */}
      <div
        className="glass-border-glow rounded-[8px] p-[1px] flex flex-col items-center"
        style={{ width: "clamp(130px, 88%, 160px)" }}
        onWheel={handleWheel}
      >
        <div className="glass-panel rounded-[7px] p-[clamp(6px,1.2vw,10px)] flex flex-col items-center gap-[clamp(3px,0.7dvh,6px)] w-full">
          {/* dB readout */}
          <span className="font-display text-crisp text-[clamp(0.65rem,2.3vw,0.85rem)] font-bold text-white tabular-nums whitespace-nowrap">
            {formatDb(value)}
          </span>

          {/* Dial — fixed size, so it doesn't stretch to fill available height.
              Glows while being turned (see .knob-active). */}
          <div
            className={`relative touch-none cursor-grab active:cursor-grabbing shrink-0 rounded-full transition-shadow duration-150 ${active ? "knob-active" : ""}`}
            style={{ width: "clamp(80px,85%,130px)", aspectRatio: "1 / 1" }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            title={`Double-click to reset to ${formatDb(Math.max(min, Math.min(max, UNITY_DB)))}`}
          >
            <svg viewBox="0 0 40 40" className="w-full h-full" style={{ overflow: "visible" }}>
              {/* Background track */}
              <path d={TRACK_D} fill="none" stroke="#2b2b2b" strokeWidth="4" strokeLinecap="round" />

              {/* Gain fill — how far turned up from the minimum */}
              <path ref={fillPathRef} fill="none" stroke="var(--accent)" strokeWidth="4" strokeLinecap="round" opacity={0.5} />

              {/* Level-meter gutter — visible even at zero signal, so the meter ring
                  itself is never mistaken for "not there". */}
              <path d={METER_TRACK_D} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="2" strokeLinecap="round" />

              {/* Live audio level meter — same live output level the faders show,
                  in its own color so it never blends into the accent-colored fill. */}
              <path
                ref={meterPathRef}
                fill="none"
                stroke={METER_COLOR}
                strokeWidth="2.5"
                strokeLinecap="round"
                style={{ filter: `drop-shadow(0 0 3px ${METER_COLOR})` }}
              />

              {/* Unity (0 dB) mark */}
              {unityInRange && (
                <line
                  x1={unityInner.x}
                  y1={unityInner.y}
                  x2={unityOuter.x}
                  y2={unityOuter.y}
                  stroke="rgba(255,255,255,0.9)"
                  strokeWidth="2"
                />
              )}

              {/* Pointer needle */}
              <line ref={pointerRef} stroke="white" strokeWidth="2.5" strokeLinecap="round" />

              {/* Center hub */}
              <circle cx={CX} cy={CY} r="2.5" fill="var(--accent)" stroke="white" strokeWidth="1" />
            </svg>
          </div>

          {/* Mono / MC / Karaoke (whichever this strip has), then Solo — matches
              Voicemeeter's own strip order, stacked above Mute without resizing it. */}
          <div className="flex flex-col gap-[clamp(1px,0.3dvh,2px)] w-full">
            {modeKind === "mono" && (
              <StripButton
                label="Mono"
                active={mono}
                activeColor="rgba(245,166,35,0.75)"
                onClick={() => onMonoToggle(!mono)}
                title="Mono"
              />
            )}
            {modeKind === "mc" && (
              <StripButton
                label="MC"
                active={mc}
                activeColor="rgba(56,189,248,0.75)"
                onClick={() => onMcToggle(!mc)}
                title="Mute Center — for dialogue"
              />
            )}
            {modeKind === "karaoke" && (
              <StripButton
                label={KARAOKE_LABELS[Math.min(Math.max(karaoke, 0), 4)]}
                active={karaoke > 0}
                activeColor="rgba(56,189,248,0.75)"
                onClick={() => onKaraokeChange((karaoke + 1) % 5)}
                title="Karaoke mode — cycles K, K-M, K-1, K-2, K-center"
              />
            )}
            <StripButton
              label="Solo"
              active={solo}
              activeColor="rgba(34,197,94,0.75)"
              onClick={() => onSoloToggle(!solo)}
              title="Solo"
            />
          </div>

          {/* Mute button — always shown, on every fader */}
          <MuteButton muted={muted} onToggle={() => onMuteToggle(!muted)} />
        </div>
      </div>
    </div>
  );
}
