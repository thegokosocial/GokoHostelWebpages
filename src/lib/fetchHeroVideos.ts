import type { HeroPageKey } from "@/lib/heroVideos";
import type { HeroLoopVideo } from "@/lib/site";

type HeroesResponse = { pages: Partial<Record<HeroPageKey, HeroLoopVideo>> };

/** In-flight only — cleared when settled so each page mount can refetch after admin save. */
let inflight: Promise<HeroesResponse | null> | null = null;

/** Clear in-flight cache between Vitest cases (no-op in production). */
export function resetPublicHeroVideosCache() {
  inflight = null;
}

/** Shared client fetch for CMS hero assignments (dedupe concurrent mounts only). */
export function fetchPublicHeroVideos(): Promise<HeroesResponse | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (inflight) return inflight;
  inflight = fetch("/api/site?page=heroes", { cache: "no-store" })
    .then(async (res) => {
      if (!res.ok) return null;
      return (await res.json()) as HeroesResponse;
    })
    .catch(() => null)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function peekHeroForPage(
  data: HeroesResponse | null,
  pageKey: HeroPageKey,
): HeroLoopVideo | null {
  const v = data?.pages?.[pageKey];
  return v && v.mp4 && v.mobileMp4 ? v : null;
}
