"use client";

import * as React from "react";
import Link from "next/link";
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:goko-focus focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "rounded-lg bg-primary text-primary-foreground hover:bg-primary/90",
        outline:
          "rounded-lg border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/80 aria-expanded:bg-secondary",
        ghost:
          "rounded-lg hover:bg-muted hover:text-foreground aria-expanded:bg-muted dark:hover:bg-muted/50",
        destructive:
          "rounded-lg bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 dark:bg-destructive/20 dark:hover:bg-destructive/30",
        link: "rounded-lg text-primary underline-offset-4 hover:underline",
        /** Goko marketing CTAs */
        cta: "goko-gradient-cta min-h-11 rounded-full px-6 py-2.5 font-display text-sm font-semibold uppercase tracking-wide text-white shadow-md hover:shadow-lg hover:-translate-y-0.5 md:text-base",
        ctaOutline:
          "min-h-11 rounded-full border-2 border-brand-green bg-white/80 px-6 py-2.5 font-display text-sm font-semibold uppercase tracking-wide text-brand-green hover:bg-brand-green hover:text-white md:text-base",
        ctaGhost:
          "font-display text-sm font-semibold uppercase tracking-wide text-brand-green underline-offset-4 hover:underline md:text-base",
      },
      size: {
        default:
          "h-8 gap-1.5 rounded-lg px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-md px-2.5 text-[0.8rem] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8 rounded-lg",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7 rounded-md",
        "icon-lg": "size-9 rounded-lg",
        /** Skip layout size (use variant padding only) — e.g. ButtonLink */
        none: "",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export type ButtonLinkProps = Omit<React.ComponentProps<typeof Link>, "href"> &
  VariantProps<typeof buttonVariants> & {
    href: string;
    external?: boolean;
    className?: string;
  };

function ButtonLink({
  variant = "cta",
  size = "none",
  className,
  href,
  external,
  ...props
}: ButtonLinkProps) {
  const cls = cn(buttonVariants({ variant, size }), className);
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
  return <Link href={href} className={cls} {...props} />;
}

export { Button, ButtonLink, buttonVariants };
