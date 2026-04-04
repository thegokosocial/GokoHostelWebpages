"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { mainNav, type NavItem } from "@/content/nav";
import { site } from "@/lib/site";
import { BookNowButton } from "@/components/booking/BookNowButton";
import { ButtonLink } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { MobileDrawer } from "./MobileDrawer";

function isNavGroup(
  item: NavItem
): item is Extract<
  NavItem,
  { children: { label: string; href: string }[] }
> {
  return "children" in item;
}

export function Header() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const aboutWrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!aboutWrap.current?.contains(e.target as Node)) setAboutOpen(false);
    };
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, []);

  return (
    <header className="sticky top-0 z-50 border-b border-brand-mist/80 bg-brand-sand/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 md:px-6">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 rounded-lg focus-visible:goko-focus"
        >
          <Image
            src="/logo.png"
            alt={site.shortName}
            width={44}
            height={44}
            className="h-10 w-10 object-contain"
            priority
          />
          <span className="font-display text-lg font-bold text-brand-green md:text-xl">
            Goko
          </span>
        </Link>

        <nav
          className="hidden items-center gap-1 lg:flex"
          aria-label="Primary"
        >
          {mainNav.map((item) => {
            if (isNavGroup(item)) {
              return (
                <div key={item.label} className="relative" ref={aboutWrap}>
                  <button
                    type="button"
                    className={cn(
                      "flex min-h-11 items-center rounded-full px-3 py-2 font-display text-sm font-semibold uppercase tracking-wide text-brand-green-dark hover:bg-brand-mist focus-visible:goko-focus",
                      aboutOpen && "bg-brand-mist"
                    )}
                    aria-expanded={aboutOpen}
                    aria-haspopup="true"
                    onClick={() => setAboutOpen((o) => !o)}
                  >
                    {item.label}
                    <span className="ml-1 text-xs" aria-hidden>
                      ▾
                    </span>
                  </button>
                  {aboutOpen ? (
                    <ul
                      role="menu"
                      className="absolute right-0 mt-1 min-w-[12rem] rounded-2xl border border-brand-mist bg-white py-2 shadow-lift"
                    >
                      {item.children.map((c) => (
                        <li key={c.href} role="none">
                          <Link
                            role="menuitem"
                            href={c.href}
                            className="block px-4 py-2.5 text-sm text-brand-green-dark hover:bg-brand-sand"
                            onClick={() => setAboutOpen(false)}
                          >
                            {c.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              );
            }
            return (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-full px-3 py-2 font-display text-sm font-semibold uppercase tracking-wide text-brand-green-dark hover:bg-brand-mist focus-visible:goko-focus min-h-11 flex items-center"
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          <BookNowButton variant="primary">Book now</BookNowButton>
        </div>

        <div className="flex items-center gap-2 lg:hidden">
          <BookNowButton variant="primary" className="!px-4 !py-2 text-xs md:text-sm">
            Book
          </BookNowButton>
          <button
            type="button"
            className="flex h-11 min-w-11 flex-col items-center justify-center gap-1 rounded-lg border border-brand-green/20 bg-white focus-visible:goko-focus"
            aria-expanded={mobileOpen}
            aria-controls="mobile-navigation"
            onClick={() => setMobileOpen((open) => !open)}
          >
            <span className="block h-0.5 w-5 bg-brand-green-dark" />
            <span className="block h-0.5 w-5 bg-brand-green-dark" />
            <span className="sr-only">Open menu</span>
          </button>
        </div>
      </div>

      <MobileDrawer open={mobileOpen} onClose={() => setMobileOpen(false)} />
    </header>
  );
}
