import type { HeroPageKey } from "@/lib/heroVideos";
import type { HeroLoopVideo } from "@/lib/site";

type HeroesResponse = { pages: Partial<Record<HeroPageKey, HeroLoopVideo>> };

let heroesPromise: Promise<HeroesResponse | null> | null = null;

/** Shared client fetch for CMS hero assignments (module-level, one request). */
export function fetchPublicHeroVideos(): Promise<HeroesResponse | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (!heroesPromise) {
    heroesPromise = fetch("/api/site?page=heroes", { cache: "default" })
      .then(async (res) => {
        if (!res.ok) return null;
        return (await res.json()) as HeroesResponse;
      })
      .catch(() => null);
  }
  return heroesPromise;
}

export function peekHeroForPage(
  data: HeroesResponse | null,
  pageKey: HeroPageKey,
): HeroLoopVideo | null {
  const v = data?.pages?.[pageKey];
  return v && v.mp4 && v.mobileMp4 ? v : null;
}
