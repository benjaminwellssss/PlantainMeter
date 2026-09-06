import StripButton from "./StripButton";

interface MuteButtonProps {
  muted: boolean;
  onToggle: () => void;
}

/** Same button design as Mono/Solo/MC/Karaoke, just kept at the larger "large" size. */
export default function MuteButton({ muted, onToggle }: MuteButtonProps) {
  return (
    <StripButton
      label={muted ? "Muted" : "Mute"}
      active={muted}
      activeColor="rgba(239,68,68,0.55)"
      onClick={onToggle}
      size="large"
    />
  );
}
