import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type SectionHeaderProps = {
  eyebrow?: string;
  title: ReactNode;
  subtitle?: string;
  align?: "left" | "center";
  className?: string;
};

export function SectionHeader({
  eyebrow,
  title,
  subtitle,
  align = "center",
  className,
}: SectionHeaderProps) {
  return (
    <div
      className={cn(
        align === "center" && "mx-auto max-w-3xl text-center",
        align === "left" && "max-w-3xl text-left",
        className
      )}
    >
      {eyebrow ? (
        <p className="font-display text-[0.7rem] font-bold uppercase tracking-[0.25em] text-brand-red">
          {eyebrow}
        </p>
      ) : null}
      <h2 className="mt-3 font-display text-display-md font-bold text-brand-green">
        {title}
      </h2>
      {subtitle ? (
        <p className="mt-5 text-base leading-relaxed text-brand-green-dark/80 md:text-lg">
          {subtitle}
        </p>
      ) : null}
      <div
        className={cn(
          "mt-6 flex items-center gap-1",
          align === "center" && "justify-center"
        )}
        aria-hidden
      >
        <div className="h-1 w-8 rounded-full bg-brand-green" />
        <div className="h-1 w-3 rounded-full bg-brand-red" />
      </div>
    </div>
  );
}
