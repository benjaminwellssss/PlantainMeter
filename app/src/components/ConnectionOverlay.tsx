import { useState } from "react";
import type { ConnectionState } from "../hooks/useVoicemeeter";

interface ConnectionOverlayProps {
  connection: ConnectionState;
  error: string | null;
  onLaunch: () => Promise<void>;
}

/**
 * Cold-start gate. Shown only before the first successful connection — once the
 * mixer has been live, a transient drop shows the titlebar indicator instead so a
 * device switch doesn't blank the whole window.
 */
export default function ConnectionOverlay({ connection, error, onLaunch }: ConnectionOverlayProps) {
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);

  const handleLaunch = async () => {
    setLaunching(true);
    setLaunchError(null);
    try {
      await onLaunch();
    } catch (e) {
      setLaunchError(String(e));
    } finally {
      setLaunching(false);
    }
  };

  const isError = connection === "error";

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-[#1a1a1a]/90 rounded-[6px] p-4">
      <div className="text-center text-white/90 text-[clamp(0.6rem,2vw,0.85rem)] flex flex-col items-center gap-[clamp(4px,1.5dvh,10px)]">
        {!isError && (
          <div
            className="w-[clamp(14px,4vw,20px)] h-[clamp(14px,4vw,20px)] rounded-full border-2 border-white/20 animate-spin"
            style={{ borderTopColor: "var(--accent)" }}
          />
        )}

        <p className="font-bold m-0">
          {isError
            ? "Connection Failed"
            : connection === "waiting"
              ? "Waiting for Voicemeeter…"
              : "Connecting…"}
        </p>

        {connection === "waiting" && (
          <>
            <p className="text-white/50 text-[clamp(0.5rem,1.5vw,0.7rem)] m-0">
              Voicemeeter Potato isn't running yet.
            </p>
            <button
              className="rounded-[4px] border-none px-[clamp(8px,2vw,14px)] py-[clamp(3px,0.7dvh,6px)] text-[clamp(0.55rem,1.8vw,0.75rem)] font-semibold cursor-pointer disabled:opacity-50"
              style={{ backgroundColor: "var(--accent)", color: "var(--accent-fg)" }}
              onClick={handleLaunch}
              disabled={launching}
            >
              {launching ? "Launching…" : "Launch Voicemeeter"}
            </button>
          </>
        )}

        {isError && (
          <>
            <p className="text-white/60 text-[clamp(0.5rem,1.5vw,0.7rem)] m-0">{error}</p>
            <p className="text-white/40 text-[clamp(0.45rem,1.3vw,0.6rem)] m-0">
              Retrying automatically…
            </p>
          </>
        )}

        {launchError && (
          <p className="text-red-400/80 text-[clamp(0.45rem,1.3vw,0.6rem)] m-0">{launchError}</p>
        )}
      </div>
    </div>
  );
}
