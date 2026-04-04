"use client";

import Link from "next/link";
import { mainNav, type NavItem } from "@/content/nav";
import { BookNowButton } from "@/components/booking/BookNowButton";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

function isNavGroup(item: NavItem): item is Extract<
  NavItem,
  { children: { label: string; href: string }[] }
> {
  return "children" in item;
}

type MobileDrawerProps = {
  open: boolean;
  onClose: () => void;
};

export function MobileDrawer({ open, onClose }: MobileDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="right"
        className={cn(
          "w-[min(100vw,22rem)] gap-0 border-l border-brand-mist bg-brand-sand p-0 shadow-lift"
        )}
      >
        <SheetHeader className="border-b border-brand-mist px-4 py-3 text-left">
          <SheetTitle className="font-display text-lg font-bold text-brand-green">
            Menu
          </SheetTitle>
        </SheetHeader>
        <nav className="flex max-h-[calc(100dvh-5rem)] flex-1 flex-col overflow-y-auto px-3 py-4" aria-label="Primary">
          <ul className="flex flex-col gap-1">
            {mainNav.map((item) => {
              if (isNavGroup(item)) {
                return (
                  <li key={item.label} className="rounded-xl bg-white/60 py-2">
                    <div className="px-3 pb-2 font-display text-xs font-bold uppercase tracking-widest text-brand-green/80">
                      {item.label}
                    </div>
                    <ul className="flex flex-col">
                      {item.children.map((c) => (
                        <li key={c.href}>
                          <Link
                            href={c.href}
                            className="block min-h-11 rounded-lg px-4 py-3 text-base text-brand-green-dark hover:bg-brand-mist"
                            onClick={onClose}
                          >
                            {c.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              }
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="block min-h-11 rounded-xl px-4 py-3 font-medium text-brand-green-dark hover:bg-brand-mist"
                    onClick={onClose}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="mt-6 px-1">
            <BookNowButton className="w-full" onClick={onClose}>
              Book now
            </BookNowButton>
          </div>
        </nav>
      </SheetContent>
    </Sheet>
  );
}
