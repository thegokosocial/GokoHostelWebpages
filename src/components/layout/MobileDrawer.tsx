"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { mainNav, type NavItem } from "@/content/nav";
import { BookNowButton } from "@/components/booking/BookNowButton";
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
  const panelRef = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const root = panelRef.current;
    if (!root) return;
    const focusable = root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    const list = [...focusable].filter((el) => !el.hasAttribute("data-skip-focus"));
    const first = list[0];
    const last = list[list.length - 1];
    queueMicrotask(() => first?.focus());

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key !== "Tab" || list.length === 0) return;
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
      } else if (document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const drawer = (
    <AnimatePresence>
      {open ? (
        <>
          <motion.button
            type="button"
            key="mobile-drawer-backdrop"
            aria-label="Close menu"
            className="fixed inset-0 z-[200] bg-black/45 backdrop-blur-[2px] lg:hidden"
            initial={reduce ? { opacity: 1 } : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.22 }}
            onClick={onClose}
          />
          <motion.aside
            key="mobile-drawer-panel"
            ref={panelRef}
            id="mobile-navigation"
            role="dialog"
            aria-modal="true"
            aria-label="Site menu"
            className={cn(
              "fixed bottom-0 right-0 top-0 z-[210] flex w-[min(100vw,22rem)] flex-col bg-brand-sand shadow-lift lg:hidden"
            )}
            initial={reduce ? false : { x: "100%" }}
            animate={{ x: 0 }}
            exit={reduce ? { x: "100%" } : { x: "100%" }}
            transition={
              reduce
                ? { duration: 0 }
                : { type: "spring", stiffness: 320, damping: 34, mass: 0.8 }
            }
          >
            <div className="flex items-center justify-between border-b border-brand-mist px-4 py-3">
              <span className="font-display text-lg font-bold text-brand-green">
                Menu
              </span>
              <button
                type="button"
                className="flex h-11 min-w-11 items-center justify-center rounded-full text-2xl text-brand-green-dark hover:bg-brand-mist focus-visible:goko-focus"
                onClick={onClose}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Primary">
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
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );

  if (!mounted) return null;

  return createPortal(drawer, document.body);
}
