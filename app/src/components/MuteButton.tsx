import StripButton from "./StripButton";

interface MuteButtonProps {
  muted: boolean;
  onToggle: () => void;
}

/** Same button design as Mono/Solo/MC/Karaoke — identical size and shading. */
export default function MuteButton({ muted, onToggle }: MuteButtonProps) {
  return <StripButton label={muted ? "Muted" : "Mute"} active={muted} onClick={onToggle} />;
}
