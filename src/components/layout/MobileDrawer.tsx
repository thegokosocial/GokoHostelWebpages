"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
  const pathname = usePathname();

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
                const childActive = item.children.some((c) => pathname === c.href);
                return (
                  <li key={item.label} className={cn("rounded-xl py-2", childActive ? "bg-brand-green/[0.06]" : "bg-white/60")}>
                    <div className="px-3 pb-2 font-display text-xs font-bold uppercase tracking-widest text-brand-green/80">
                      {item.label}
                    </div>
                    <ul className="flex flex-col">
                      {item.children.map((c) => {
                        const active = pathname === c.href;
                        return (
                          <li key={c.href}>
                            <Link
                              href={c.href}
                              className={cn(
                                "block min-h-11 rounded-lg px-4 py-3 text-base transition-colors",
                                active
                                  ? "bg-brand-green/[0.08] font-semibold text-brand-green"
                                  : "text-brand-green-dark hover:bg-brand-mist"
                              )}
                              aria-current={active ? "page" : undefined}
                              onClick={onClose}
                            >
                              {c.label}
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                );
              }
              const active = pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      "block min-h-11 rounded-xl px-4 py-3 font-medium transition-colors",
                      active
                        ? "bg-brand-green/[0.08] text-brand-green"
                        : "text-brand-green-dark hover:bg-brand-mist"
                    )}
                    aria-current={active ? "page" : undefined}
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
