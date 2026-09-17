import { motion, AnimatePresence } from "framer-motion";
import type { FxGroup } from "../types/fx";
import { formatHotkey } from "../lib/hotkey";
import { pillLabel } from "../lib/fxGroups";

interface FxBarProps {
  groups: FxGroup[];
  /** Active group ids, in activation order. */
  active: string[];
  onToggle: (id: string) => void;
}

/**
 * The window's bottom accent bar. Idle, it is the same thin strip as before.
 * While any FX group is active it grows just enough to hold one pill per
 * active group, each labelled with that group's name. Clicking a pill turns
 * that group off.
 */
export default function FxBar({ groups, active, onToggle }: FxBarProps) {
  const pills = groups
    .map((g, i) => ({ g, n: i + 1 }))
    .filter(({ g }) => active.includes(g.id))
    // Show in configured order, so the pills keep the order of the list in
    // Settings rather than jumping around by activation time.
    .sort((a, b) => a.n - b.n);

  const expanded = pills.length > 0;

  return (
    <motion.div
      className={`shrink-0 flex items-center justify-center overflow-x-auto [scrollbar-width:none] gap-[clamp(4px,1.5vw,8px)] px-[clamp(6px,2vw,12px)] ${
        expanded ? "fx-bar-glow" : ""
      }`}
      style={{ backgroundColor: "var(--accent)" }}
      initial={false}
      animate={{ height: expanded ? "clamp(14px, 4dvh, 18px)" : "clamp(2px, 0.5dvh, 4px)" }}
      transition={{ type: "spring", stiffness: 400, damping: 32 }}
      role={expanded ? "toolbar" : undefined}
      aria-label={expanded ? "Active FX groups" : undefined}
    >
      <AnimatePresence initial={false}>
        {pills.map(({ g, n }) => (
          <motion.button
            key={g.id}
            layout
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.15 }}
            className="bg-black/20 hover:bg-black/35 rounded-[3px] border-none cursor-pointer px-[clamp(4px,1vw,7px)] leading-none text-[clamp(0.5rem,1.6vw,0.65rem)] font-bold shrink-0 h-[80%] max-w-[10ch] truncate"
            style={{ color: "var(--accent-fg)" }}
            onClick={() => onToggle(g.id)}
            title={`${g.name}${g.hotkey ? ` (${formatHotkey(g.hotkey)})` : ""} — click to turn off`}
          >
            {pillLabel(g.name, n)}
          </motion.button>
        ))}
      </AnimatePresence>
    </motion.div>
  );
}
