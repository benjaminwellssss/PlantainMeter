import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { ChannelConfig } from "../config";
import type { EditionInfo } from "../types/edition";
import { useAppSessions } from "../hooks/useAppSessions";
import { useHiddenApps, hideKey } from "../hooks/useHiddenApps";
import AppSessionRow from "./AppSessionRow";

interface AppMixerPanelProps {
  open: boolean;
  onClose: () => void;
  channels: ChannelConfig[];
  edition: EditionInfo;
  connected: boolean;
}

/**
 * Slide-over listing every app playing into Voicemeeter's inputs, grouped by
 * the strip each virtual input feeds. Sits under the titlebar (z-44 < z-45)
 * so the titlebar button that opened it can close it too.
 */
export default function AppMixerPanel({ open, onClose, channels, edition, connected }: AppMixerPanelProps) {
  const { endpoints, levels, error, loaded, setVolume, setMute, startDragging, stopDragging } =
    useAppSessions(open && connected);
  const { isHidden, hide, unhide } = useHiddenApps();
  const [showHidden, setShowHidden] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  // Endpoints the running edition actually routes somewhere; empty ones stay
  // listed so the user can see the input exists.
  const visible = endpoints.filter((e) => e.strip !== null);
  const allSessions = visible.flatMap((e) => e.sessions);
  const hiddenCount = allSessions.filter((s) => isHidden(hideKey(s))).length;
  const shownCount = allSessions.length - hiddenCount;

  const groupLabel = (strip: number, fallback: string) =>
    channels.find((c) => c.strip === strip)?.label ?? edition.strips[strip]?.label ?? fallback;

  const smallText = "text-[clamp(0.5rem,1.5vw,0.65rem)]";

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="absolute inset-x-0 bottom-0 top-[clamp(24px,8dvh,36px)] z-[44] flex flex-col overflow-hidden"
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", stiffness: 320, damping: 32 }}
        >
          <div className="absolute inset-0 bg-[#1a1a1a]/92" onClick={onClose} />

          <div className="relative flex flex-col flex-1 min-h-0 p-[clamp(8px,2vw,16px)] gap-[clamp(6px,1.5dvh,10px)]">
            <div className="flex items-center gap-[clamp(4px,1vw,8px)] shrink-0">
              <span className="text-[clamp(0.7rem,2.5vw,0.95rem)] font-bold text-white/90">
                Apps
                {shownCount > 0 && (
                  <span className={`${smallText} font-normal text-white/40 ml-[clamp(4px,1vw,8px)]`}>{shownCount}</span>
                )}
              </span>

              {hiddenCount > 0 && (
                <button
                  className={`${smallText} ml-auto bg-white/10 hover:bg-white/15 border-none rounded-[3px] px-[clamp(4px,1vw,8px)] py-[1px] cursor-pointer text-white/60`}
                  onClick={() => setShowHidden((v) => !v)}
                  aria-pressed={showHidden}
                  title={showHidden ? "Hide the hidden apps again" : "Show apps you have hidden"}
                >
                  {showHidden ? "Hide hidden" : `${hiddenCount} hidden`}
                </button>
              )}

              <button
                className={`text-white/60 hover:text-white/90 text-[clamp(0.7rem,2vw,1rem)] bg-transparent border-none cursor-pointer p-1 ${hiddenCount > 0 ? "" : "ml-auto"}`}
                onClick={onClose}
                title="Close (Esc)"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto min-h-0 flex flex-col gap-[clamp(6px,1.5dvh,10px)]">
              {!connected && (
                <p className={`${smallText} text-white/50 m-0`}>Connect to Voicemeeter first.</p>
              )}
              {connected && error && (
                <p className={`${smallText} text-amber-300/70 m-0`}>Couldn't read Windows audio sessions: {error}</p>
              )}
              {connected && !error && loaded && visible.length === 0 && (
                <p className={`${smallText} text-white/50 m-0`}>
                  No Voicemeeter input devices found. Are the Voicemeeter virtual audio drivers installed?
                </p>
              )}
              {connected && !error && loaded && visible.length > 0 && allSessions.length === 0 && (
                <p className={`${smallText} text-white/50 m-0`}>
                  No apps are playing into Voicemeeter right now. Start something that outputs to a Voicemeeter input.
                </p>
              )}
              {connected && !error && loaded && allSessions.length > 0 && shownCount === 0 && !showHidden && (
                <p className={`${smallText} text-white/50 m-0`}>Every app here is hidden. Use “{hiddenCount} hidden” above to show them.</p>
              )}

              {visible.map((ep) => {
                const rows = ep.sessions.filter((s) => showHidden || !isHidden(hideKey(s)));
                if (ep.sessions.length > 0 && rows.length === 0) return null;
                return (
                  <section key={ep.endpoint} className="flex flex-col gap-[clamp(3px,0.8dvh,5px)]">
                    <header className={`flex items-baseline gap-[clamp(4px,1vw,8px)] ${smallText} px-[2px]`}>
                      <span className="font-semibold text-white/80 truncate">{groupLabel(ep.strip!, ep.endpoint)}</span>
                      <span className="text-white/35 shrink-0">Strip {ep.strip}</span>
                      {ep.sessions.length === 0 && <span className="text-white/30 truncate">— nothing playing</span>}
                    </header>
                    {rows.map((s) => {
                      const key = hideKey(s);
                      const hidden = isHidden(key);
                      return (
                        <AppSessionRow
                          key={s.key}
                          session={s}
                          peak={levels.get(s.key) ?? s.peak}
                          hidden={hidden}
                          onVolume={(v) => setVolume(s.key, v)}
                          onMute={(m) => setMute(s.key, m)}
                          onToggleHidden={() => (hidden ? unhide(key) : hide(key))}
                          onDragStart={() => startDragging(s.key)}
                          onDragEnd={() => stopDragging(s.key)}
                        />
                      );
                    })}
                  </section>
                );
              })}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
