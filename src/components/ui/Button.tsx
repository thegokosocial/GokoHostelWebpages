import Link from "next/link";
import { cn } from "@/lib/utils";
import type { ButtonHTMLAttributes, AnchorHTMLAttributes } from "react";

const base =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-full px-6 py-2.5 text-center font-display text-sm font-semibold uppercase tracking-wide transition-transform duration-200 focus-visible:goko-focus active:scale-[0.98] md:text-base";

const variants = {
  primary: "goko-gradient-cta text-white shadow-md hover:shadow-lg hover:-translate-y-0.5",
  secondary:
    "border-2 border-brand-green bg-white/80 text-brand-green hover:bg-brand-green hover:text-white",
  ghost: "text-brand-green underline-offset-4 hover:underline",
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof variants;
  className?: string;
};

type LinkButtonProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: keyof typeof variants;
  href: string;
  className?: string;
  external?: boolean;
};

export function Button({
  variant = "primary",
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      className={cn(base, variants[variant], className)}
      {...props}
    />
  );
}

export function ButtonLink({
  variant = "primary",
  className,
  href,
  external,
  ...props
}: LinkButtonProps) {
  const cls = cn(base, variants[variant], className);
  if (external) {
    return (
      <a
        href={href}
        className={cls}
        target="_blank"
        rel="noopener noreferrer"
        {...props}
      />
    );
  }
  return (
    <Link href={href} className={cls} {...props} />
  );
}
