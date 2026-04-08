"use client";

import Image from "next/image";
import { useReducedMotion } from "framer-motion";
import { useEffect, useRef } from "react";
import type { HeroLoopVideo } from "@/lib/site";

type HeroBackdropProps = {
  /** Shown when video is off (`prefers-reduced-motion`) or as Next/Image optimization target for static export. Omit for solid gradient fallback. */
  image?: string;
  imageAlt?: string;
  video?: HeroLoopVideo | null;
  priority?: boolean;
};

export function HeroBackdrop({
  image,
  imageAlt,
  video,
  priority = true,
}: HeroBackdropProps) {
  const reduceMotion = useReducedMotion();
  const videoRef = useRef<HTMLVideoElement>(null);

  const showVideo = Boolean(video) && !reduceMotion;

  useEffect(() => {
    if (!showVideo || !videoRef.current) return;
    const v = videoRef.current;
    v.muted = true;
    const play = () => {
      v.play().catch(() => {});
    };
    if (v.readyState >= 2) play();
    else v.addEventListener("canplay", play, { once: true });
    return () => v.removeEventListener("canplay", play);
  }, [showVideo, video]);

  return (
    <div className="relative h-full min-h-full w-full">
      {!showVideo && image ? (
        <Image
          src={image}
          alt={imageAlt ?? ""}
          fill
          className="object-cover"
          sizes="100vw"
          priority={priority}
        />
      ) : !showVideo ? (
        <div
          className="absolute inset-0 bg-gradient-to-br from-brand-green-dark via-brand-green to-brand-green-dark"
          aria-hidden
        />
      ) : (
        <video
          ref={videoRef}
          className="absolute inset-0 z-0 h-full w-full object-cover"
          poster={video!.poster}
          muted
          playsInline
          loop
          autoPlay
          preload="metadata"
          aria-hidden
        >
          <source src={video!.webm} type="video/webm" />
          <source src={video!.mp4} type="video/mp4" />
        </video>
      )}
    </div>
  );
}
