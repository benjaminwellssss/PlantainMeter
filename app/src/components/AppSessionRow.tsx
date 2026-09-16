import type { AppSession } from "../types/appSessions";
import MuteButton from "./MuteButton";

interface AppSessionRowProps {
  session: AppSession;
  /** Live peak 0..1, from the levels stream (falls back to the session's own). */
  peak: number;
  /** True when this row is only visible because "show hidden" is on. */
  hidden: boolean;
  onVolume: (volume: number) => void;
  onMute: (muted: boolean) => void;
  onToggleHidden: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}

const WHEEL_STEP = 0.05;

/** Fallback when no icon could be extracted: a tile with the app's initial. */
function InitialTile({ name }: { name: string }) {
  const letter = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <span
      className="flex items-center justify-center rounded-[3px] font-bold text-[clamp(0.45rem,1.3vw,0.6rem)] w-full h-full"
      style={{ backgroundColor: "rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.75)" }}
      aria-hidden
    >
      {letter}
    </span>
  );
}

/**
 * One app: icon, name, horizontal volume slider, percentage, mute, hide, and a
 * thin live meter under the slider. At 200px the name wraps onto its own line.
 */
export default function AppSessionRow({
  session,
  peak,
  hidden,
  onVolume,
  onMute,
  onToggleHidden,
  onDragStart,
  onDragEnd,
}: AppSessionRowProps) {
  const pct = Math.round(session.volume * 100);
  const idle = session.state !== "active";
  const iconBox = "w-[clamp(12px,3.2vw,18px)] h-[clamp(12px,3.2vw,18px)] shrink-0";

  return (
    <div
      className="relative flex flex-wrap items-center gap-x-[clamp(4px,1vw,8px)] gap-y-[2px] bg-white/5 rounded-[4px] px-[clamp(5px,1.2vw,8px)] pt-[clamp(3px,0.6dvh,6px)] pb-[clamp(5px,1dvh,8px)] overflow-hidden"
      style={{ opacity: hidden ? 0.45 : idle ? 0.6 : 1 }}
    >
      {/* Icon + name share a line at every width; the controls wrap below on narrow windows */}
      <span className="flex items-center gap-[clamp(3px,0.8vw,6px)] min-w-0 basis-full min-[300px]:basis-auto min-[300px]:w-[clamp(70px,22vw,130px)]">
        <span className={iconBox}>
          {session.icon ? (
            <img src={session.icon} alt="" className="w-full h-full object-contain rounded-[3px]" draggable={false} />
          ) : (
            <InitialTile name={session.display} />
          )}
        </span>
        <span
          className="truncate font-semibold text-white/85 text-[clamp(0.55rem,1.8vw,0.75rem)]"
          title={`${session.display}${session.process && session.process !== session.display ? ` (${session.process})` : ""}${idle ? " — not playing" : ""}`}
        >
          {session.display}
        </span>
      </span>

      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={pct}
        onChange={(e) => onVolume(Number(e.target.value) / 100)}
        onPointerDown={onDragStart}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
        onWheel={(e) => {
          const next = Math.min(1, Math.max(0, session.volume + (e.deltaY < 0 ? WHEEL_STEP : -WHEEL_STEP)));
          onVolume(Math.round(next * 100) / 100);
        }}
        className="flex-1 min-w-[56px] h-[clamp(10px,2.5dvh,16px)] accent-[var(--accent)] cursor-pointer"
        aria-label={`${session.display} volume`}
      />

      <span className="tabular-nums w-[4ch] text-right text-white/60 text-[clamp(0.5rem,1.5vw,0.65rem)]">{pct}%</span>

      <MuteButton muted={session.muted} onToggle={() => onMute(!session.muted)} />

      {/* Hide / unhide */}
      <button
        className="flex items-center justify-center rounded-[3px] border-none bg-transparent cursor-pointer text-white/35 hover:text-white/80 hover:bg-white/10 w-[clamp(14px,3.5vw,20px)] h-[clamp(14px,3.5vw,20px)] shrink-0"
        onClick={onToggleHidden}
        title={hidden ? "Show this app again" : "Hide this app from the list"}
        aria-pressed={hidden}
      >
        {hidden ? (
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-[70%] h-[70%]">
            <path d="M10 4C5.5 4 2.3 7.1 1 10c1.3 2.9 4.5 6 9 6s7.7-3.1 9-6c-1.3-2.9-4.5-6-9-6zm0 9.5A3.5 3.5 0 1 1 10 6.5a3.5 3.5 0 0 1 0 7zm0-5.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />
          </svg>
        ) : (
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-[70%] h-[70%]">
            <path d="M3.3 2.3 2.3 3.3l2.4 2.4C3 6.9 1.7 8.4 1 10c1.3 2.9 4.5 6 9 6 1.6 0 3-.4 4.3-1l2.4 2.4 1-1L3.3 2.3zM10 13.5a3.5 3.5 0 0 1-3.1-5.1l1.5 1.5a2 2 0 0 0 2.2 2.2l1.5 1.5c-.6.3-1.3.5-2.1.5v-.6zm8.9-3.5c-.9-1.8-2.4-3.6-4.5-4.8l-1.6 1.6A3.5 3.5 0 0 1 13.5 10c0 .4-.1.8-.2 1.2l2.9 2.9c1.2-1.1 2.1-2.5 2.7-4.1zM10 4c-.9 0-1.8.1-2.6.4l1.8 1.8c.3 0 .5-.1.8-.1 1.9 0 3.5 1.6 3.5 3.5 0 .3 0 .5-.1.8l1.9 1.9C14.7 11 15 10.5 15 10c0-2.8-2.2-5-5-5v-1z" />
          </svg>
        )}
      </button>

      {/* Live meter — a hairline along the bottom edge */}
      <div
        className="absolute left-0 bottom-0 h-[2px] pointer-events-none"
        style={{
          width: `${Math.min(1, Math.max(0, peak)) * 100}%`,
          backgroundColor: "var(--accent)",
          transition: "width 80ms linear",
          opacity: session.muted ? 0.25 : 0.9,
        }}
      />
    </div>
  );
}
