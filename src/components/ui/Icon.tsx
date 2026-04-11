import {
  BedDouble,
  Lock,
  ShowerHead,
  Wifi,
  Waves,
  Sofa,
  UtensilsCrossed,
  Dice5,
  Laptop,
  BookOpen,
  PartyPopper,
  Palette,
  Globe,
  Flame,
  Handshake,
  Leaf,
  Umbrella,
  Rainbow,
  Heart,
  Building2,
  MapPin,
  ClipboardList,
  Target,
  type LucideProps,
} from "lucide-react";
import type { ComponentType } from "react";

const iconMap: Record<string, ComponentType<LucideProps>> = {
  bed: BedDouble,
  lock: Lock,
  shower: ShowerHead,
  wifi: Wifi,
  waves: Waves,
  sofa: Sofa,
  utensils: UtensilsCrossed,
  dice: Dice5,
  laptop: Laptop,
  book: BookOpen,
  party: PartyPopper,
  palette: Palette,
  globe: Globe,
  flame: Flame,
  handshake: Handshake,
  leaf: Leaf,
  umbrella: Umbrella,
  rainbow: Rainbow,
  heart: Heart,
  building: Building2,
  mapPin: MapPin,
  clipboard: ClipboardList,
  target: Target,
};

export function Icon({
  name,
  className = "h-6 w-6",
  ...props
}: { name: string } & LucideProps) {
  const Comp = iconMap[name];
  if (!Comp) return null;
  return <Comp className={className} {...props} />;
}
