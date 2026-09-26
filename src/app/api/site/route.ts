import { NextRequest, NextResponse } from "next/server";
import { loadCommunityPageData, loadEventsPageData } from "@/lib/siteContent";
import { loadAccommodationContent, publicAccommodationContent } from "@/lib/accommodationContent";
import { loadPublicHeroVideos } from "@/lib/loadHeroVideos";

/** Shared-cache hint only. Do not enable Worker-wide `cache.enabled` — it would cache other GET 200s. */
const CACHE = "public, s-maxage=60, stale-while-revalidate=300";

export async function GET(req: NextRequest) {
  const page = req.nextUrl.searchParams.get("page");
  const data =
    page === "events"
      ? await loadEventsPageData()
      : page === "community"
        ? await loadCommunityPageData()
        : page === "stay"
          ? await loadAccommodationContent().then(publicAccommodationContent).catch(() => null)
          : page === "heroes"
            ? await loadPublicHeroVideos()
            : null;
  if (!data) {
    return NextResponse.json({ error: "Unknown page" }, { status: 404 });
  }
  return NextResponse.json(data, { headers: { "Cache-Control": CACHE } });
}
