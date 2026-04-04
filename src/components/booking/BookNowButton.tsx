"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useBookingGate } from "./BookingGateProvider";
import type { ComponentProps, MouseEventHandler, ReactNode } from "react";

type BookNowButtonProps = Omit<ComponentProps<typeof Button>, "type" | "onClick"> & {
  onClick?: MouseEventHandler<HTMLButtonElement>;
};

export function BookNowButton({
  onClick,
  variant = "cta",
  ...props
}: BookNowButtonProps) {
  const { openBookingGate } = useBookingGate();
  return (
    <Button
      type="button"
      variant={variant}
      {...props}
      onClick={(e) => {
        onClick?.(e);
        openBookingGate();
      }}
    />
  );
}

type BookNowBareProps = {
  className?: string;
  children: ReactNode;
};

/** Plain &lt;button&gt; styled like a link — footer column, inline text, etc. */
export function BookNowBare({ className, children }: BookNowBareProps) {
  const { openBookingGate } = useBookingGate();
  return (
    <button
      type="button"
      className={cn("cursor-pointer border-0", className)}
      onClick={openBookingGate}
    >
      {children}
    </button>
  );
}
