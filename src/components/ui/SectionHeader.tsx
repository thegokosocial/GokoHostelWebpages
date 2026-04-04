import { cn } from "@/lib/utils";

type SectionHeaderProps = {
  eyebrow?: string;
  title: string;
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
        <p className="font-display text-xs font-bold uppercase tracking-[0.2em] text-brand-red">
          {eyebrow}
        </p>
      ) : null}
      <h2 className="mt-2 font-display text-display-md font-bold text-brand-green">
        {title}
      </h2>
      {subtitle ? (
        <p className="mt-4 text-base leading-relaxed text-brand-green-dark/85 md:text-lg">
          {subtitle}
        </p>
      ) : null}
      <div
        className={cn(
          "mt-6 h-1 w-16 rounded-full goko-gradient-cta",
          align === "center" && "mx-auto"
        )}
        aria-hidden
      />
    </div>
  );
}
