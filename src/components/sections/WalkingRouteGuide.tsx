"use client";

import Image from "next/image";
import {
  motion,
  useAnimationControls,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "framer-motion";
import { MapPin, ImageIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Reveal } from "@/components/motion/Reveal";
import { cn } from "@/lib/utils";
import type { WalkingRouteStep, WalkingRouteVideo } from "@/types/walking-route";

/** Walker hit-box (matches outer `size-*`); keep in sync with Tailwind class below. */
const WALKER_BOX_PX = 80;
/** Matches timeline line `top-6` / `bottom-6` (1.5rem). */
const LINE_EDGE_REM_PX = 24;
/** Upper band: align figure with Step 1 when route progress starts. */
const WALK_EDGE_TOP_INSET_PX = 28;
/** Lower band: keep the figure above Step 6 / line end. */
const WALK_EDGE_BOTTOM_INSET_PX = 52;
/**
 * Remap section scroll → route progress (0 = parking / Step 1 zone, 1 = Step 6).
 * Raw ["start end","end start"] hits ~0 while the block is still entering; without this
 * the figure was already mid-route while Step 1 was still on screen.
 */
const ROUTE_SCROLL_START = 0.17;
const ROUTE_SCROLL_END = 0.93;
/**
 * Fence+hop between earlier steps triggers at k/n; the **last** hop must not fire at
 * (n-1)/n (start of final step) — it felt like “step 6” before finishing step 5.
 * Instead it fires this far **into** the final segment (0–1).
 */
const FINAL_STEP_FENCE_FRACTION = 0.72;

function scrollRawToRouteProgress(latest: number): number {
  const span = ROUTE_SCROLL_END - ROUTE_SCROLL_START;
  if (span <= 0) return 0;
  return Math.min(1, Math.max(0, (latest - ROUTE_SCROLL_START) / span));
}

/** Side-profile rider on a small motorbike (step 1 — parking segment). */
function RouteMotorbikeRiderIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn("drop-shadow-sm", className)}
      viewBox="0 0 72 56"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <ellipse cx="17" cy="45" rx="9" ry="9" className="fill-brand-green-dark" />
      <ellipse cx="56" cy="45" rx="9" ry="9" className="fill-brand-green-dark" />
      <circle cx="17" cy="45" r="3" className="fill-white/30" />
      <circle cx="56" cy="45" r="3" className="fill-white/30" />
      <path
        d="M 14 45 L 22 26 L 48 22 L 62 28 L 65 45"
        className="stroke-brand-green-dark"
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M 26 26 L 34 18 L 44 16"
        className="stroke-brand-green-dark"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M 44 16 L 52 14 M 42 20 L 50 17"
        className="stroke-brand-green-dark/80"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <ellipse
        cx="38"
        cy="19"
        rx="7"
        ry="6.5"
        className="fill-brand-green-dark/92"
        transform="rotate(-8 38 19)"
      />
      <path
        d="M 28 24 Q 36 14 46 18"
        className="stroke-brand-green-dark"
        strokeWidth="2.6"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M 32 30 L 38 24 L 46 26"
        className="stroke-brand-green-dark"
        strokeWidth="2.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M 40 34 L 46 42"
        className="stroke-brand-green-dark"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Yellow diamond warning-style sign — left bend (road aesthetic). */
function RouteLeftTurnRoadSign({ className }: { className?: string }) {
  return (
    <svg
      className={cn("drop-shadow-md", className)}
      viewBox="0 0 72 96"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <rect x="31" y="56" width="10" height="40" rx="1.5" className="fill-brand-green-dark/78" />
      <path
        d="M 36 8 L 58 32 L 36 56 L 14 32 Z"
        fill="#EAB308"
        stroke="#141414"
        strokeWidth="2.8"
        strokeLinejoin="round"
      />
      <path
        d="M 44 34 Q 30 34 26 26 L 22 20"
        stroke="#141414"
        strokeWidth="3.2"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M 22 20 L 17 25 M 22 20 L 24 27"
        stroke="#141414"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
      <text
        x="36"
        y="46"
        textAnchor="middle"
        fill="#141414"
        fontFamily="system-ui, -apple-system, sans-serif"
        fontSize="10"
        fontWeight="800"
        letterSpacing="0.04em"
      >
        LEFT
      </text>
    </svg>
  );
}

/** Small arch bridge over water — step 4 (“at the bridge”). */
function RouteBridgeMini({ className }: { className?: string }) {
  return (
    <svg
      className={cn("drop-shadow-sm", className)}
      viewBox="0 0 88 56"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M 6 47 Q 24 43 44 47 T 82 47"
        className="stroke-brand-green-dark/40"
        strokeWidth="1.6"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M 6 47 Q 24 44 44 48 T 82 47"
        className="stroke-brand-mist/90"
        strokeWidth="1.2"
        strokeLinecap="round"
        fill="none"
        opacity="0.6"
      />
      <path
        d="M 24 46 L 24 34 Q 44 14 64 34 L 64 46"
        className="stroke-brand-green-dark"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M 22 32 L 66 32"
        className="stroke-brand-green-dark"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M 22 28 L 66 28"
        className="stroke-brand-green-dark/55"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      {[26, 34, 42, 50, 58].map((x) => (
        <path
          key={x}
          d={`M ${x} 28 L ${x} 32`}
          className="stroke-brand-green-dark/70"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}

/** Hanging-sign hostel mark — end of route / step 6. */
function RouteHostelMarkIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn("drop-shadow-md", className)}
      viewBox="0 0 88 84"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M 12 52 L 44 26 L 76 52"
        className="fill-brand-green-dark/25 stroke-brand-green-dark"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <rect
        x="16"
        y="52"
        width="56"
        height="24"
        rx="2"
        className="fill-white stroke-brand-green-dark/80"
        strokeWidth="2"
      />
      <rect x="38" y="60" width="12" height="16" rx="1" className="fill-brand-green-dark/75" />
      <rect x="22" y="56" width="8" height="8" rx="1" className="fill-brand-mist/90" />
      <rect x="58" y="56" width="8" height="8" rx="1" className="fill-brand-mist/90" />
      <path
        d="M 30 14 L 58 14 L 56 22 L 32 22 Z"
        className="fill-brand-red/92 stroke-brand-green-dark"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M 44 22 L 44 32" className="stroke-brand-green-dark/70" strokeWidth="2" strokeLinecap="round" />
      <text
        x="44"
        y="19"
        textAnchor="middle"
        fill="white"
        fontFamily="system-ui, -apple-system, sans-serif"
        fontSize="8"
        fontWeight="800"
        letterSpacing="0.06em"
      >
        GOKO
      </text>
      <text
        x="44"
        y="40"
        textAnchor="middle"
        fill="#1a4d2e"
        fontFamily="system-ui, -apple-system, sans-serif"
        fontSize="9"
        fontWeight="800"
        letterSpacing="0.12em"
      >
        HOSTEL
      </text>
    </svg>
  );
}

/** Motorbike only — left behind at end of step 1. */
function RouteParkedMotorbikeIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn("drop-shadow-sm", className)}
      viewBox="0 0 72 56"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <ellipse cx="17" cy="45" rx="9" ry="9" className="fill-brand-green-dark" />
      <ellipse cx="56" cy="45" rx="9" ry="9" className="fill-brand-green-dark" />
      <circle cx="17" cy="45" r="3" className="fill-white/30" />
      <circle cx="56" cy="45" r="3" className="fill-white/30" />
      <path
        d="M 14 45 L 22 26 L 48 22 L 62 28 L 65 45"
        className="stroke-brand-green-dark"
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M 26 26 L 34 18 L 44 16"
        className="stroke-brand-green-dark"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M 44 16 L 52 14 M 42 20 L 50 17"
        className="stroke-brand-green-dark/80"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Low picket fence that appears under each hop (aligned on the path). */
function RouteFenceMini({ className }: { className?: string }) {
  return (
    <svg
      className={cn("drop-shadow-sm", className)}
      viewBox="0 0 56 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M6 14.5h44M6 23.5h44"
        className="stroke-brand-green-dark/90"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path
        d="M11 35V11M28 35V8.5M45 35V11"
        className="stroke-brand-green-dark"
        strokeWidth="2.35"
        strokeLinecap="round"
      />
      <path
        d="M11 14.5c5.5 2.8 11 5.6 17 2.8s11-2.8 17-2.8M11 23.5c5.5-2.6 11-5.2 17-2.6s11 2.6 17 2.6"
        className="stroke-brand-green-dark/45"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
      <path
        d="M8 32.5h40"
        className="stroke-brand-green-dark/55"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Side-profile backpacker (faces right; parent mirrors with scaleX when scrolling up).
 */
function RouteWalkerIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn("drop-shadow-sm", className)}
      viewBox="0 0 56 60"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      {/* Rear leg + boot */}
      <path
        className="fill-brand-green-dark"
        d="M 25.4 37.5 L 24 53.6 h 6.6 l 1.2 -15.8 z"
      />
      {/* Rucksack body */}
      <path
        className="fill-brand-green-dark/82"
        d="M 10.2 24.8
           C 5.6 26.2 3.2 32.8 4.4 40.8
           C 5.6 47.8 11.8 50.2 18 49
           l 2 -0.6
           C 16 45.4 14.8 40 16.8 34.8
           l 7.2 -8
           C 19.4 23.4 14 23.2 10.2 24.8 Z"
      />
      {/* Pack pocket + highlights */}
      <path
        className="fill-brand-green-dark/40"
        d="M 11.4 33.6
           c -0.4 3.4 1 6.6 3.6 8.2
           l 3.8 -1.4
           c -1.2 -2.8 -1.2 -5.8 -0.2 -8.2
           l -7.2 1.4 Z"
      />
      {/* Bedroll on top */}
      <ellipse
        cx="15"
        cy="22.5"
        className="fill-brand-green-dark/58"
        rx="8.5"
        ry="3.8"
        transform="rotate(-16 15 22.5)"
      />
      {/* Strap into shoulder */}
      <path
        d="M 21.8 26.4 Q 25.8 23.6 30 21.8"
        className="stroke-brand-green-dark/70"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
      {/* Torso / jacket */}
      <path
        className="fill-brand-green-dark"
        d="M 28 19.2
           c 3.8 -0.8 7.6 0.6 9 4.2
           l -1.6 15
           c -2.4 0.8 -5 0.8 -7.2 -0.2
           l -3.6 -15.4
           c 0 -2 1.6 -3.6 3.4 -3.6 Z"
      />
      {/* Leading leg + boot */}
      <path
        className="fill-brand-green-dark"
        d="M 32 36.6 l 7.8 16.2 l 5.6 -1.2 L 39.4 36.4 Z"
      />
      {/* Arm (forward swing) */}
      <path
        d="M 34 23.8 Q 40.5 19.8 46.6 16.8"
        className="stroke-brand-green-dark"
        strokeWidth="3.8"
        strokeLinecap="round"
        fill="none"
      />
      {/* Head */}
      <circle cx="41.2" cy="16.8" r="6.8" className="fill-brand-green-dark" />
      {/* Cap crown + brim */}
      <path
        className="fill-brand-green-dark/90"
        d="M 33.4 14.2
           c 2 -3.8 7.4 -5.8 12.4 -3.6
           l 1.2 2.2
           c -4.8 -2.2 -9.6 -0.8 -11.8 2.8
           l -1.8 -1.4 Z"
      />
      <path
        d="M 33 16.4 c 4 -2 9 -2 14 0.6"
        className="stroke-brand-green-dark/72"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

type WalkingRouteGuideProps = {
  title: string;
  intro: string;
  steps: WalkingRouteStep[];
  tips: string[];
  video?: WalkingRouteVideo;
};

export function WalkingRouteGuide({
  title,
  intro,
  steps,
  tips,
  video,
}: WalkingRouteGuideProps) {
  const timelineRef = useRef<HTMLDivElement>(null);
  const [timelineH, setTimelineH] = useState(0);
  const reduceMotion = useReducedMotion();
  // Map 0→1 across the full scroll while this block travels through the viewport.
  // ["start start","start end"] only spans ~one viewport, so progress hit 1 long before
  // the user finished the steps and the walker looked broken/stuck.
  const { scrollYProgress } = useScroll({
    target: timelineRef,
    offset: ["start end", "end start"],
  });

  const routeProgress = useTransform(scrollYProgress, (v) => scrollRawToRouteProgress(v));
  /** Eased progress for trail + hiker (tight spring when motion OK, near-instant when reduced). */
  const smoothRouteProgress = useSpring(routeProgress, {
    stiffness: reduceMotion ? 380 : 72,
    damping: reduceMotion ? 36 : 18,
    mass: reduceMotion ? 0.2 : 0.62,
    restDelta: 0.0004,
  });

  const walkerGlowOpacity = useTransform(smoothRouteProgress, [0, 0.12, 0.88, 1], [0.5, 1, 1, 0.55]);

  const stepCount = steps.length;
  const step1EndP = stepCount > 0 ? 1 / stepCount : 1;
  /** Dismount only in the last part of step 1 so the bike stays visible for most of that segment. */
  const rideBlendStart = step1EndP * 0.72;
  const rideBlendEnd = step1EndP;

  const rideOpacity = useTransform(smoothRouteProgress, (p) => {
    if (stepCount === 0) return 0;
    if (p <= rideBlendStart) return 1;
    if (p >= rideBlendEnd) return 0;
    return 1 - (p - rideBlendStart) / (rideBlendEnd - rideBlendStart);
  });

  const walkFootOpacity = useTransform(smoothRouteProgress, (p) => {
    if (stepCount === 0) return 1;
    if (p <= rideBlendStart) return 0;
    if (p >= rideBlendEnd) return 1;
    return (p - rideBlendStart) / (rideBlendEnd - rideBlendStart);
  });

  const parkedBikeOpacity = useTransform(smoothRouteProgress, (p) => {
    if (stepCount === 0) return 0;
    if (p <= rideBlendStart) return 0;
    if (p >= rideBlendEnd) return 1;
    return (p - rideBlendStart) / (rideBlendEnd - rideBlendStart);
  });

  const bikeParkTopPx = useMemo(() => {
    const h = timelineH;
    const n = steps.length;
    if (h <= 0 || n <= 0) return 0;
    const p = 1 / n;
    const topPad = LINE_EDGE_REM_PX + WALK_EDGE_TOP_INSET_PX;
    const botPad = LINE_EDGE_REM_PX + WALK_EDGE_BOTTOM_INSET_PX + WALKER_BOX_PX;
    const usable = Math.max(0, h - topPad - botPad);
    const y = topPad + p * usable;
    const maxY = h - botPad;
    return Math.min(maxY, Math.max(topPad, y));
  }, [timelineH, steps.length]);

  /** Step 3 — road-style left turn sign, ~upper third of that segment along the path. */
  const leftSignTopPx = useMemo(() => {
    const h = timelineH;
    const n = steps.length;
    if (h <= 0 || n < 3) return 0;
    const p = (2 + 0.36) / n;
    const topPad = LINE_EDGE_REM_PX + WALK_EDGE_TOP_INSET_PX;
    const botPad = LINE_EDGE_REM_PX + WALK_EDGE_BOTTOM_INSET_PX + WALKER_BOX_PX;
    const usable = Math.max(0, h - topPad - botPad);
    const y = topPad + p * usable;
    const maxY = h - botPad;
    return Math.min(maxY, Math.max(topPad, y));
  }, [timelineH, steps.length]);

  const leftSignOpacity = useTransform(smoothRouteProgress, (p) => {
    if (stepCount < 3) return 0;
    const n = stepCount;
    const segStart = 2 / n;
    const segEnd = 3 / n;
    const rampIn = 0.05 / n;
    const rampOut = 0.07 / n;
    if (p < segStart - rampIn) return 0;
    if (p < segStart) return (p - (segStart - rampIn)) / rampIn;
    if (p < segEnd) return 1;
    if (p < segEnd + rampOut) return 1 - (p - segEnd) / rampOut;
    return 0;
  });

  /** Step 4 — second “LEFT” sign on the line (bridge / turn copy). */
  const step4LeftSignTopPx = useMemo(() => {
    const h = timelineH;
    const n = steps.length;
    if (h <= 0 || n < 4) return 0;
    const p = (3 + 0.3) / n;
    const topPad = LINE_EDGE_REM_PX + WALK_EDGE_TOP_INSET_PX;
    const botPad = LINE_EDGE_REM_PX + WALK_EDGE_BOTTOM_INSET_PX + WALKER_BOX_PX;
    const usable = Math.max(0, h - topPad - botPad);
    const y = topPad + p * usable;
    const maxY = h - botPad;
    return Math.min(maxY, Math.max(topPad, y));
  }, [timelineH, steps.length]);

  const step4LeftSignOpacity = useTransform(smoothRouteProgress, (p) => {
    if (stepCount < 4) return 0;
    const n = stepCount;
    const segStart = 3 / n;
    const segEnd = 4 / n;
    const rampIn = 0.05 / n;
    const rampOut = 0.07 / n;
    if (p < segStart - rampIn) return 0;
    if (p < segStart) return (p - (segStart - rampIn)) / rampIn;
    if (p < segEnd) return 1;
    if (p < segEnd + rampOut) return 1 - (p - segEnd) / rampOut;
    return 0;
  });

  /** Step 4 — bridge graphic lower in the same segment. */
  const step4BridgeTopPx = useMemo(() => {
    const h = timelineH;
    const n = steps.length;
    if (h <= 0 || n < 4) return 0;
    const p = (3 + 0.62) / n;
    const topPad = LINE_EDGE_REM_PX + WALK_EDGE_TOP_INSET_PX;
    const botPad = LINE_EDGE_REM_PX + WALK_EDGE_BOTTOM_INSET_PX + WALKER_BOX_PX;
    const usable = Math.max(0, h - topPad - botPad);
    const y = topPad + p * usable;
    const maxY = h - botPad;
    return Math.min(maxY, Math.max(topPad, y));
  }, [timelineH, steps.length]);

  const step4BridgeOpacity = useTransform(smoothRouteProgress, (p) => {
    if (stepCount < 4) return 0;
    const n = stepCount;
    const segStart = 3 / n;
    const segEnd = 4 / n;
    const rampIn = 0.055 / n;
    const rampOut = 0.08 / n;
    const bridgeIn = segStart + 0.035 / n;
    if (p < bridgeIn - rampIn) return 0;
    if (p < bridgeIn) return (p - (bridgeIn - rampIn)) / rampIn;
    if (p < segEnd) return 1;
    if (p < segEnd + rampOut) return 1 - (p - segEnd) / rampOut;
    return 0;
  });

  /** Finisher — hostel sign near end of last step (on the path). */
  const hostelMarkTopPx = useMemo(() => {
    const h = timelineH;
    const n = steps.length;
    if (h <= 0 || n < 2) return 0;
    const p = (n - 1 + 0.82) / n;
    const topPad = LINE_EDGE_REM_PX + WALK_EDGE_TOP_INSET_PX;
    const botPad = LINE_EDGE_REM_PX + WALK_EDGE_BOTTOM_INSET_PX + WALKER_BOX_PX;
    const usable = Math.max(0, h - topPad - botPad);
    const y = topPad + p * usable;
    const maxY = h - botPad;
    return Math.min(maxY, Math.max(topPad, y));
  }, [timelineH, steps.length]);

  const hostelMarkOpacity = useTransform(smoothRouteProgress, (p) => {
    if (stepCount < 2) return 0;
    const n = stepCount;
    const start = (n - 1 + 0.4) / n;
    const peak = 0.998;
    if (p < start) return 0;
    if (p >= peak) return 1;
    return (p - start) / (peak - start);
  });

  const walkerTop = useTransform(smoothRouteProgress, (p) => {
    const h = timelineH;
    if (h <= 0) return "0px";
    const topPad = LINE_EDGE_REM_PX + WALK_EDGE_TOP_INSET_PX;
    const botPad = LINE_EDGE_REM_PX + WALK_EDGE_BOTTOM_INSET_PX + WALKER_BOX_PX;
    const usable = Math.max(0, h - topPad - botPad);
    const y = topPad + p * usable;
    const maxY = h - botPad;
    return `${Math.min(maxY, Math.max(topPad, y))}px`;
  });

  /** Step badge “you are here” (uses raw progress so labels stay aligned with scroll). */
  const [activeStepIndex, setActiveStepIndex] = useState(0);

  useLayoutEffect(() => {
    const el = timelineRef.current;
    if (!el) return;
    const measure = () => setTimelineH(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [steps.length]);

  /** Scroll down the page → figure faces “down” the path; scroll up → mirrored. */
  const [facingScrollDown, setFacingScrollDown] = useState(true);
  const lastScrollRaw = useRef(0);
  const prevRoutePRef = useRef<number | null>(null);
  const jumpChainRef = useRef(Promise.resolve());
  const jumpControls = useAnimationControls();
  const fenceControls = useAnimationControls();
  const hostelMarkControls = useAnimationControls();
  /** Allow repeat pulse after user scrolls back above the trigger band. */
  const hostelPulsePrimedRef = useRef(true);

  useEffect(() => {
    lastScrollRaw.current = scrollYProgress.get();
  }, [scrollYProgress]);

  useEffect(() => {
    prevRoutePRef.current = null;
    hostelPulsePrimedRef.current = true;
  }, [steps.length]);

  useEffect(() => {
    const n = steps.length;
    if (n <= 0) return;
    const p = scrollRawToRouteProgress(scrollYProgress.get());
    setActiveStepIndex(Math.min(n - 1, Math.max(0, Math.floor(p * n))));
  }, [scrollYProgress, steps.length]);

  const onRouteScroll = useCallback(
    (latest: number) => {
      const delta = latest - lastScrollRaw.current;
      if (Math.abs(delta) > 1e-4) {
        setFacingScrollDown(delta >= 0);
        lastScrollRaw.current = latest;
      }

      const p = scrollRawToRouteProgress(latest);
      const nSteps = steps.length;
      if (nSteps > 0) {
        setActiveStepIndex(
          Math.min(nSteps - 1, Math.max(0, Math.floor(p * nSteps)))
        );
      }
      const prev = prevRoutePRef.current;
      if (prev == null) {
        prevRoutePRef.current = p;
        return;
      }
      if (p > prev) {
        const n = steps.length;
        const crossedTs: number[] = [];
        if (n >= 2) {
          for (let k = 1; k <= n - 1; k++) {
            if (k <= n - 2) {
              const t = k / n;
              if (prev < t && p >= t) crossedTs.push(t);
            }
          }
          const lastFenceT = (n - 1 + FINAL_STEP_FENCE_FRACTION) / n;
          if (prev < lastFenceT && p >= lastFenceT) crossedTs.push(lastFenceT);
        }
        if (crossedTs.length > 0) {
          jumpChainRef.current = jumpChainRef.current.then(async () => {
            const hopMs = 0.52;
            const hopTimes = [0, 0.36, 0.7, 1] as const;
            for (let i = 0; i < crossedTs.length; i++) {
              await Promise.all([
                jumpControls.start({
                  y: [0, -40, -7, 0],
                  x: [0, 15, -14, 0],
                  transition: {
                    duration: hopMs,
                    times: [...hopTimes],
                    ease: ["easeOut", "easeInOut", "easeIn"],
                  },
                }),
                fenceControls.start({
                  opacity: [0, 1, 1, 0.95, 0],
                  scaleX: [0.78, 1.08, 1, 1.02, 0.96],
                  scaleY: [0.28, 1.1, 0.94, 1.06, 0.85],
                  rotate: [0, -6, 5, -4, 0],
                  y: [10, 0, 0, 2, 8],
                  transition: {
                    duration: hopMs,
                    times: [0, 0.14, 0.38, 0.68, 1],
                    ease: "easeInOut",
                  },
                }),
              ]);
            }
          });
        }

        if (!reduceMotion && n >= 2) {
          const hostelPulseT = (n - 1 + 0.62) / n;
          if (p < hostelPulseT - 0.04) {
            hostelPulsePrimedRef.current = true;
          }
          if (
            hostelPulsePrimedRef.current &&
            prev < hostelPulseT &&
            p >= hostelPulseT
          ) {
            hostelPulsePrimedRef.current = false;
            void hostelMarkControls.start({
              scale: [1, 1.14, 1.06, 1],
              transition: {
                duration: 0.7,
                times: [0, 0.32, 0.62, 1],
                ease: "easeOut",
              },
            });
          }
        }
      } else if (p < prev) {
        const n = steps.length;
        if (n >= 2) {
          const hostelPulseT = (n - 1 + 0.62) / n;
          if (p < hostelPulseT - 0.04) {
            hostelPulsePrimedRef.current = true;
          }
        }
      }
      prevRoutePRef.current = p;
    },
    [
      reduceMotion,
      steps.length,
      jumpControls,
      fenceControls,
      hostelMarkControls,
    ]
  );

  useMotionValueEvent(scrollYProgress, "change", onRouteScroll);

  return (
    <div>
      <h2 className="font-display text-display-md font-bold text-brand-green">
        {title}
      </h2>
      <p className="mt-4 max-w-3xl text-lg leading-relaxed text-brand-green-dark/90">
        {intro}
      </p>

      <div ref={timelineRef} className="relative mt-10 md:mt-12">
        <div
          className={cn(
            "pointer-events-none absolute left-[1.125rem] top-6 bottom-6 z-0 flex justify-center md:left-1/2 md:-translate-x-1/2",
            reduceMotion ? "w-px" : "w-[3px]"
          )}
          aria-hidden
        >
          <div className="absolute inset-0 w-px bg-gradient-to-b from-brand-green/22 via-brand-green/40 to-brand-red/30" />
          {!reduceMotion ? (
            <>
              <motion.div
                className="absolute inset-x-0 top-0 h-full w-full origin-top rounded-full bg-gradient-to-b from-brand-green via-brand-green-dark/95 to-brand-red opacity-[0.93] shadow-[0_0_18px_rgba(22,101,52,0.4),0_0_34px_rgba(220,38,38,0.15)]"
                style={{ scaleY: smoothRouteProgress }}
              />
              <motion.div
                className="absolute inset-x-0 top-0 h-full w-full origin-top rounded-full bg-gradient-to-b from-white/50 via-transparent to-transparent opacity-45"
                style={{ scaleY: smoothRouteProgress }}
              />
            </>
          ) : null}
        </div>

        {!reduceMotion && stepCount > 0 ? (
          <motion.div
            className={cn(
              "pointer-events-none absolute left-[1.125rem] z-[3] w-14 -translate-x-[188%] md:left-1/2 md:-translate-x-[210%]"
            )}
            style={{ top: bikeParkTopPx, opacity: parkedBikeOpacity }}
            aria-hidden
          >
            <RouteParkedMotorbikeIcon className="h-11 w-14" />
          </motion.div>
        ) : null}

        {!reduceMotion && stepCount >= 3 ? (
          <motion.div
            className={cn(
              "pointer-events-none absolute left-[1.125rem] z-[3] flex w-[4.25rem] -translate-x-1/2 justify-center md:left-1/2"
            )}
            style={{ top: leftSignTopPx, opacity: leftSignOpacity }}
            aria-hidden
          >
            <RouteLeftTurnRoadSign className="h-24 w-[4.25rem]" />
          </motion.div>
        ) : null}

        {!reduceMotion && stepCount >= 4 ? (
          <motion.div
            className={cn(
              "pointer-events-none absolute left-[1.125rem] z-[3] flex w-[4.25rem] -translate-x-1/2 justify-center md:left-1/2"
            )}
            style={{ top: step4LeftSignTopPx, opacity: step4LeftSignOpacity }}
            aria-hidden
          >
            <RouteLeftTurnRoadSign className="h-24 w-[4.25rem]" />
          </motion.div>
        ) : null}

        {!reduceMotion && stepCount >= 4 ? (
          <motion.div
            className={cn(
              "pointer-events-none absolute left-[1.125rem] z-[3] flex w-[5.75rem] -translate-x-1/2 justify-center md:left-1/2"
            )}
            style={{ top: step4BridgeTopPx, opacity: step4BridgeOpacity }}
            aria-hidden
          >
            <RouteBridgeMini className="h-14 w-[5.75rem]" />
          </motion.div>
        ) : null}

        {stepCount >= 2 ? (
          <motion.div
            className={cn(
              "pointer-events-none absolute left-[1.125rem] z-[3] flex w-[5.5rem] -translate-x-1/2 justify-center md:left-1/2"
            )}
            style={{ top: hostelMarkTopPx, opacity: hostelMarkOpacity }}
            initial={{ scale: 1 }}
            animate={reduceMotion ? false : hostelMarkControls}
            aria-hidden
          >
            <RouteHostelMarkIcon className="h-[5.25rem] w-[5.5rem]" />
          </motion.div>
        ) : null}

        {!reduceMotion ? (
          <motion.div
            className={cn(
              "pointer-events-none absolute z-[4] flex size-20 -translate-x-1/2 items-center justify-center will-change-transform",
              "left-[1.125rem] md:left-1/2"
            )}
            style={{ top: walkerTop }}
            aria-hidden
          >
            <motion.div
              className="pointer-events-none absolute left-1/2 top-1/2 z-0 size-[5.5rem] -translate-x-1/2 -translate-y-1/2 rounded-full blur-md"
              style={{
                opacity: walkerGlowOpacity,
                background:
                  "radial-gradient(circle at 50% 42%, rgba(34,197,94,0.5) 0%, rgba(5,150,105,0.22) 38%, rgba(220,38,38,0.12) 62%, transparent 74%)",
              }}
            />
            <div className="relative z-[1] size-full">
              <motion.div
                className="pointer-events-none absolute bottom-0 left-1/2 z-0 w-[3.5rem] -translate-x-1/2"
                initial={{ opacity: 0, scaleX: 0.85, scaleY: 0.35, rotate: 0, y: 8 }}
                animate={fenceControls}
              >
                <RouteFenceMini className="h-9 w-14" />
              </motion.div>
              <motion.div
                className="relative z-[1] flex size-full items-center justify-center will-change-transform"
                initial={{ x: 0, y: 0 }}
                animate={jumpControls}
              >
                <motion.div
                  className="relative flex size-full items-center justify-center"
                  animate={{ scaleX: facingScrollDown ? 1 : -1 }}
                  transition={{ type: "spring", stiffness: 520, damping: 32 }}
                >
                  {stepCount > 0 ? (
                    <>
                      <motion.div
                        className="absolute inset-0 flex items-center justify-center"
                        style={{ opacity: rideOpacity }}
                      >
                        <RouteMotorbikeRiderIcon className="h-[4.6rem] w-[5.6rem]" />
                      </motion.div>
                      <motion.div
                        className="absolute inset-0 flex items-center justify-center"
                        style={{ opacity: walkFootOpacity }}
                      >
                        <RouteWalkerIcon className="size-[4.5rem]" />
                      </motion.div>
                    </>
                  ) : (
                    <RouteWalkerIcon className="size-[4.5rem]" />
                  )}
                </motion.div>
              </motion.div>
            </div>
          </motion.div>
        ) : null}

        <ol className="relative z-[1] space-y-12 md:space-y-20">
          {steps.map((step, i) => {
            const n = i + 1;
            const isEven = i % 2 === 0;
            const hasImage = Boolean(step.image?.trim());
            const mediaSrc = step.image?.trim() ?? "";
            const isAnimatedGif = mediaSrc.toLowerCase().endsWith(".gif");

            return (
              <Reveal key={`${step.title}-${i}`} delay={i * 0.06}>
                <li
                  className={cn(
                    "relative grid gap-8 md:grid-cols-2 md:gap-12 md:gap-y-8",
                    !isEven && "md:[&>div:first-child]:order-2"
                  )}
                >
                  <div
                    className={cn(
                      "flex flex-col md:items-end md:text-right",
                      !isEven && "md:items-start md:text-left"
                    )}
                  >
                    <div
                      className={cn(
                        "flex items-start gap-4 md:max-w-md",
                        !isEven && "md:flex-row-reverse"
                      )}
                    >
                      <motion.span
                        className={cn(
                          "relative z-[1] flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-green text-sm font-bold text-white shadow-soft ring-4",
                          i === activeStepIndex
                            ? "ring-brand-red shadow-[0_0_22px_rgba(220,38,38,0.42)]"
                            : "ring-brand-sand"
                        )}
                        animate={{
                          scale:
                            reduceMotion || i !== activeStepIndex ? 1 : 1.14,
                        }}
                        transition={
                          reduceMotion
                            ? { duration: 0 }
                            : { type: "spring", stiffness: 420, damping: 24 }
                        }
                        aria-hidden
                      >
                        {n}
                      </motion.span>
                      <div className="min-w-0 pt-0.5">
                        {step.badge ? (
                          <p className="mb-1 inline-flex items-center gap-1.5 rounded-full bg-brand-mist px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-brand-green-dark/80">
                            <MapPin className="size-3" aria-hidden />
                            {step.badge}
                          </p>
                        ) : null}
                        <h3 className="font-display text-xl font-bold text-brand-green md:text-2xl">
                          {step.title}
                        </h3>
                        <p className="mt-3 text-sm leading-relaxed text-brand-green-dark/88 md:text-base">
                          {step.text}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div
                    className={cn(
                      "md:flex md:items-center",
                      isEven ? "md:justify-start" : "md:justify-end"
                    )}
                  >
                    <figure
                      className={cn(
                        "group relative w-full overflow-hidden rounded-2xl border border-brand-mist/80 bg-white shadow-card ring-1 ring-brand-green/5 transition-shadow duration-300 hover:shadow-lift md:max-w-2xl",
                        !hasImage && "border-dashed"
                      )}
                    >
                      <div className="relative aspect-[4/3] w-full bg-gradient-to-br from-brand-sand via-white to-brand-mist/30">
                        {hasImage ? (
                          isAnimatedGif ? (
                            // Native <img>: next/image wrappers often break aspect-ratio boxes for looping GIFs.
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={mediaSrc}
                              alt={step.imageAlt ?? step.title}
                              className="absolute inset-0 h-full w-full object-cover object-center transition duration-500 motion-safe:group-hover:scale-[1.02]"
                              loading={i === 0 ? "eager" : "lazy"}
                              decoding="async"
                            />
                          ) : (
                            <Image
                              src={mediaSrc}
                              alt={step.imageAlt ?? step.title}
                              fill
                              priority={i === 0}
                              className="object-cover object-center transition duration-500 motion-safe:group-hover:scale-[1.02]"
                              sizes="(max-width: 768px) 100vw, min(672px, 50vw)"
                            />
                          )
                        ) : (
                          <div className="flex size-full flex-col items-center justify-center gap-2 p-6 text-center text-brand-green-dark/45">
                            <ImageIcon className="size-10 stroke-[1.25]" aria-hidden />
                            <span className="text-xs font-medium uppercase tracking-wide">
                              Add your photo in content
                            </span>
                          </div>
                        )}
                      </div>
                    </figure>
                  </div>
                </li>
              </Reveal>
            );
          })}
        </ol>
      </div>

      {video ? (
        <Reveal delay={0.04}>
          <figure className="mt-14 overflow-hidden rounded-2xl border border-brand-mist/80 bg-brand-green-dark shadow-card ring-1 ring-brand-green/10 md:mt-16">
            <div className="border-b border-white/10 bg-brand-green-dark/95 px-4 py-3 md:px-5">
              <p className="font-display text-sm font-semibold text-white md:text-base">
                {video.title}
              </p>
              <p className="mt-1 text-xs text-white/75 md:text-sm">{video.description}</p>
            </div>
            <div className="relative aspect-video bg-black">
              <video
                className="size-full object-contain"
                controls
                playsInline
                preload="metadata"
                aria-label={video.title}
              >
                <source src={video.src} type="video/mp4" />
                Your browser does not support embedded video.{" "}
                <a href={video.src} className="underline">
                  Download the walkthrough
                </a>
                .
              </video>
            </div>
          </figure>
        </Reveal>
      ) : null}

      <ul className="mt-14 space-y-3 rounded-2xl border border-brand-green/15 bg-gradient-to-br from-brand-sand/90 to-white p-6 text-sm text-brand-green-dark shadow-soft md:mt-16 md:p-8 md:text-base">
        {tips.map((t) => (
          <li key={t} className="flex gap-3">
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand-red" aria-hidden />
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
