import { motion, AnimatePresence } from "framer-motion";

interface StripButtonProps {
  label: string;
  active: boolean;
  onClick: () => void;
  title?: string;
}

/** One shared style for every strip button — Mono, Solo, MC, Karaoke, and
    Mute all render identically (size, color, shading); only the label differs. */
export default function StripButton({ label, active, onClick, title }: StripButtonProps) {
  const activeColor = "rgba(255,255,255,0.28)";
  const inactiveColor = "rgba(255,255,255,0.07)";
  return (
    <motion.button
      className="text-crisp flex items-center justify-center uppercase cursor-pointer border border-white/12 outline-none w-full rounded-[5px] px-[clamp(3px,0.8vw,6px)] py-[clamp(0px,0.25dvh,2px)] text-[clamp(0.45rem,1.5vw,0.6rem)] font-bold tracking-wide"
      style={{
        backgroundColor: active ? activeColor : inactiveColor,
        color: active ? "#fff" : "rgba(255,255,255,0.6)",
        backdropFilter: "blur(10px) saturate(160%)",
        WebkitBackdropFilter: "blur(10px) saturate(160%)",
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
