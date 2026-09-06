import { motion, AnimatePresence } from "framer-motion";

interface StripButtonProps {
  label: string;
  active: boolean;
  /** Background color (rgba) when active — lets Mono/Solo/MC read as distinct from Mute's red. */
  activeColor: string;
  onClick: () => void;
  title?: string;
  /** "large" matches Mute's existing footprint; "compact" (default) is for Mono/Solo/MC/Karaoke. */
  size?: "compact" | "large";
}

const SIZE_CLASSES: Record<"compact" | "large", string> = {
  compact:
    "rounded-[5px] px-[clamp(3px,0.8vw,6px)] py-[clamp(0px,0.25dvh,2px)] text-[clamp(0.45rem,1.5vw,0.6rem)] font-bold tracking-wide border-white/12",
  large:
    "rounded-[6px] px-[clamp(4px,1vw,8px)] py-[clamp(1px,0.3dvh,3px)] text-[clamp(0.55rem,1.9vw,0.75rem)] font-extrabold tracking-widest border-white/15",
};

/** Shared button for Mono/Solo/MC/Karaoke and Mute — same glass language and
    structure throughout, with Mute alone kept at its larger "large" size. */
export default function StripButton({ label, active, activeColor, onClick, title, size = "compact" }: StripButtonProps) {
  const inactiveColor = size === "large" ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.07)";
  return (
    <motion.button
      className={`text-crisp flex items-center justify-center uppercase cursor-pointer border outline-none w-full ${SIZE_CLASSES[size]}`}
      style={{
        backgroundColor: active ? activeColor : inactiveColor,
        color: active ? "#fff" : "rgba(255,255,255,0.6)",
        backdropFilter: "blur(10px) saturate(160%)",
        WebkitBackdropFilter: "blur(10px) saturate(160%)",
        boxShadow: size === "large" ? "inset 0 1px 0 rgba(255,255,255,0.25)" : undefined,
      }}
      onClick={onClick}
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.95 }}
      animate={{ backgroundColor: active ? activeColor : inactiveColor }}
      transition={{ duration: 0.15 }}
      title={title}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={label}
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.85 }}
          transition={{ duration: 0.1 }}
        >
          {label}
        </motion.span>
      </AnimatePresence>
    </motion.button>
  );
}
