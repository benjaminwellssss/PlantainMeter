import { useRef, useCallback, useEffect, useState } from "react";
import { motion, useTransform, useSpring } from "framer-motion";
import { WHEEL_STEP_DB, UNITY_DB, FADER_COLUMN_MIN_WIDTH, KARAOKE_LABELS } from "../config";
import type { ModeKind } from "../config";
import MuteButton from "./MuteButton";
import StripButton from "./StripButton";

interface FaderProps {
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

export default function Fader({
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
}: FaderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  // Drives the glow while the fader is actively being dragged.
  const [active, setActive] = useState(false);

  // --- Live level meter (smooth tracking, silence hold + configurable decay) ---
  const meterRef = useRef<HTMLDivElement>(null);
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

      if (meterRef.current) {
        meterRef.current.style.height = `${Math.min(displayLevel.current * 100, 100)}%`;
      }

      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  // Normalized 0..1 where 0 = max dB (top) and 1 = min dB (bottom)
  const normalized = (max - value) / (max - min);

  // Spring-animated position for smooth external updates
  const springY = useSpring(normalized, { damping: 30, stiffness: 300 });

  // Update spring when value changes externally (not during drag)
  useEffect(() => {
    if (!isDragging.current) {
      springY.set(normalized);
    }
  }, [normalized, springY]);

  // Fill height tracks the thumb position
  const fillScale = useTransform(springY, [0, 1], [1, 0]);

  // --- Dragging ---
  //
  // Pointer capture with a preserved grab offset, rather than framer-motion's
  // pan gesture. Pan waits for a movement threshold before firing and works in
  // deltas, which made this feel unresponsive and drifty. Here the whole track
  // column is a grab surface and the thumb never jumps to the cursor: press
  // anywhere and it moves relative to where you started, so a plain click can't
  // yank the level.
  const drag = useRef<{ pointerId: number; offset: number; startY: number } | null>(null);
  const lastPressTime = useRef(0);
  // A quick drag-release-drag must not be mistaken for a double-click, so a
  // gesture that actually moved disqualifies the next press.
  const movedDuringDrag = useRef(false);

  const applyNorm = useCallback(
    (norm: number) => {
      springY.jump(norm);
      const db = max - norm * (max - min);
      onChange(Math.round(db * 10) / 10);
    },
    [max, min, onChange, springY],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      if (rect.height <= 0) return;

      const now = performance.now();
      const isDoubleClick = now - lastPressTime.current < DOUBLE_CLICK_MS;
      lastPressTime.current = now;

      if (isDoubleClick) {
        // Snap to unity (0 dB). Detected by timing rather than the dblclick
        // event, because preventDefault below suppresses the compatibility
        // mouse events that would normally produce it.
        const target = Math.max(min, Math.min(max, UNITY_DB));
        applyNorm((max - target) / (max - min));
        return;
      }

      // Offset from the thumb's current position keeps the grab point steady,
      // so pressing away from the thumb doesn't yank the level.
      const thumbY = rect.top + springY.get() * rect.height;
      drag.current = { pointerId: e.pointerId, offset: e.clientY - thumbY, startY: e.clientY };
      movedDuringDrag.current = false;
      e.currentTarget.setPointerCapture(e.pointerId);
      e.preventDefault();
      isDragging.current = true;
      setActive(true);
      onDragStart();
    },
    [applyNorm, max, min, onDragStart, springY],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const state = drag.current;
      if (!state || state.pointerId !== e.pointerId) return;
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      if (rect.height <= 0) return;

      if (Math.abs(e.clientY - state.startY) > 3) movedDuringDrag.current = true;

      const norm = Math.max(
        0,
        Math.min(1, (e.clientY - state.offset - rect.top) / rect.height),
      );
      applyNorm(norm);
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

  // Unity (0 dB) mark position — hidden if the channel's range doesn't include it.
  const unityInRange = min <= UNITY_DB && UNITY_DB <= max;
  const unityNorm = (max - UNITY_DB) / (max - min);

  return (
    <div
      className="flex flex-col items-center gap-[clamp(4px,1.2dvh,8px)] flex-1"
      style={{ minWidth: FADER_COLUMN_MIN_WIDTH }}
    >
      {/* Channel label */}
      <span className="text-crisp text-[clamp(0.65rem,2.6vw,0.9rem)] font-extrabold uppercase tracking-widest text-white truncate w-full text-center">
        {label}
      </span>

      {/* Fader border + track — glows while being dragged, matching the knob.
          Sized as a % of its own column (not vw) so it can't overshoot when
          there are many channels; leaves clear space on both sides. */}
      <div
        className={`glass-border-glow rounded-[8px] p-[1px] w-full flex-1 flex flex-col min-h-0 transition-shadow duration-150 ${active ? "fader-active" : ""}`}
        style={{ maxWidth: "var(--fader-max-w, clamp(42px, 88%, 68px))" }}
        onWheel={handleWheel}
      >
        <div className="glass-panel rounded-[7px] p-[clamp(6px,1.2vw,10px)] flex flex-col items-center gap-[clamp(3px,0.7dvh,6px)] flex-1 min-h-0">
          {/* dB readout */}
          <span className="font-display text-crisp text-[clamp(0.65rem,2.3vw,0.85rem)] font-bold text-white tabular-nums whitespace-nowrap">
            {formatDb(value)}
          </span>

          {/* Grab surface — the full column width, so you never have to hit the
              thin track or the thumb exactly. */}
          <div
            className="relative flex-1 min-h-[80px] w-full flex justify-center touch-none cursor-grab active:cursor-grabbing"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            title={`Double-click to reset to ${formatDb(Math.max(min, Math.min(max, UNITY_DB)))}`}
          >
            {/* Visual track */}
            <div
              ref={trackRef}
              className="relative w-[clamp(8px,2vw,12px)] h-full bg-[#2b2b2b] rounded-full"
            >
              {/* Fill from bottom */}
              <motion.div
                className="absolute bottom-0 left-0 right-0 rounded-full origin-bottom pointer-events-none"
                style={{
                  scaleY: fillScale,
                  backgroundColor: "var(--accent)",
                  opacity: 0.4,
                  height: "100%",
                }}
              />

              {/* Audio level meter — driven by RAF peak-hold loop. Visualizer-accent
                  colored and glowing, matching the knob's VU meter. */}
              <div
                ref={meterRef}
                className="absolute bottom-0 left-[15%] right-[15%] rounded-full pointer-events-none"
                style={{
                  height: "0%",
                  backgroundColor: "var(--viz-color)",
                  boxShadow: "0 0 4px var(--viz-color)",
                }}
              />

              {/* Unity (0 dB) mark */}
              {unityInRange && (
                <div
                  className="absolute left-[-3px] right-[-3px] h-[2px] rounded-full pointer-events-none"
                  style={{
                    top: `${unityNorm * 100}%`,
                    transform: "translateY(-50%)",
                    backgroundColor: "rgba(255,255,255,0.9)",
                    boxShadow: "0 0 2px rgba(0,0,0,0.6)",
                  }}
                />
              )}

              {/* Thumb — pentagon pointing right. Purely visual; the wrapper
                  above owns all pointer handling. */}
              <motion.div
                className="absolute pointer-events-none flex items-center justify-center"
                style={{
                  width: "clamp(18px,4.5vw,30px)",
                  height: "clamp(8px,1.5dvh,14px)",
                  top: useTransform(
                    springY,
                    (v: number) => `calc(${v * 100}% - clamp(4px,0.75dvh,7px))`,
                  ),
                  right: "35%",
                }}
              >
                <svg viewBox="0 0 24 14" className="w-full h-full" style={{ overflow: "visible" }}>
                  <path
                    d="M 0 0 L 18 0 L 24 7 L 18 14 L 0 14 Z"
                    fill="var(--accent)"
                    stroke="white"
                    strokeWidth="1.5"
                  />
                </svg>
              </motion.div>
            </div>
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
