"use client";

import { cn } from "@/lib/utils";
import { platformLogo } from "./utils";

/** Compact platform mark for calendar tiles / lists. Website bookings use the Goko logo. */
export function PlatformBadge({
  platform,
  className,
  size = 16,
}: {
  platform?: string | null;
  className?: string;
  size?: number;
}) {
  const mark = platformLogo(platform);
  if (!mark) return null;
  if (mark.logoSrc) {
    return (
      <img
        src={mark.logoSrc}
        alt={mark.label}
        width={size}
        height={size}
        className={cn("shrink-0 rounded-full object-contain bg-white", className)}
        style={{ width: size, height: size }}
        title={mark.label}
      />
    );
  }
  return (
    <span
      title={mark.label}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full text-[8px] font-bold text-white",
        mark.color,
        className,
      )}
      style={{ width: size, height: size }}
    >
      {mark.abbr}
    </span>
  );
}
