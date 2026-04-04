import { homeRooms } from "@/content/home";

/** Image sets aligned with `stayRoomSummaries` order in `content/stay.ts` */
export const stayGalleryById: Record<string, readonly string[]> = {
  "mixed-dorm-12bed": homeRooms[0]?.images ?? [],
  "female-dorm-6bed": homeRooms[1]?.images ?? [],
  "luxury-dorm-8bed": homeRooms[2]?.images ?? [],
};
