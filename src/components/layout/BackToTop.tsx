"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 600);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <button
      type="button"
      aria-label="Back to top"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      className={cn(
        "fixed bottom-6 left-6 z-40 flex h-11 w-11 items-center justify-center rounded-full border border-brand-mist bg-white/90 text-brand-green shadow-card backdrop-blur-sm transition-all duration-300 hover:bg-brand-green hover:text-white hover:shadow-lift active:scale-95 md:bottom-8 md:left-8",
        visible
          ? "translate-y-0 opacity-100"
          : "pointer-events-none translate-y-4 opacity-0"
      )}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5"
      >
        <path d="m18 15-6-6-6 6" />
      </svg>
    </button>
  );
}
