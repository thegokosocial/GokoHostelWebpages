"use client";

import Image from "next/image";
import { useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import type { HeroLoopVideo } from "@/lib/site";
import type { HeroPageKey } from "@/lib/heroVideos";
import { fetchPublicHeroVideos, peekHeroForPage } from "@/lib/fetchHeroVideos";

type HeroBackdropProps = {
  /** Shown when video is off (`prefers-reduced-motion`) or as Next/Image optimization target for static export. Omit for solid gradient fallback. */
  image?: string;
  imageAlt?: string;
  /** Seed / fallback until CMS hydrate (or final if no pageKey). */
  video?: HeroLoopVideo | null;
  /** When set, hydrates live assignment from `/api/site?page=heroes` (keeps pages static). */
  pageKey?: HeroPageKey;
  priority?: boolean;
};

export function HeroBackdrop({
  image,
  imageAlt,
  video: seedVideo,
  pageKey,
  priority = true,
}: HeroBackdropProps) {
  const reduceMotion = useReducedMotion();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [liveVideo, setLiveVideo] = useState<HeroLoopVideo | null>(null);

  useEffect(() => {
    const mq = window.matchMedia(
      "(max-width: 768px) and (orientation: portrait)",
    );
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    if (!pageKey) return;
    let active = true;
    fetchPublicHeroVideos().then((data) => {
      if (!active) return;
      setLiveVideo(peekHeroForPage(data, pageKey));
    });
    return () => {
      active = false;
    };
  }, [pageKey]);

  const video = liveVideo ?? seedVideo ?? null;
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
  }, [showVideo, video, isMobile]);

  const desktopWebm = video?.webm?.trim();
  const mobileWebm = video?.mobileWebm?.trim();
  const webmSrc = isMobile ? mobileWebm : desktopWebm;
  const mp4Src = isMobile ? video?.mobileMp4 : video?.mp4;

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
          key={isMobile ? "mobile" : "desktop"}
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
          {webmSrc ? <source src={webmSrc} type="video/webm" /> : null}
          {mp4Src ? <source src={mp4Src} type="video/mp4" /> : null}
        </video>
      )}
    </div>
  );
}
