import { gokoStayRooms } from "@/content/rooms";

export { resolveRoomGallery } from "@/content/rooms";

/** Image sets keyed by `stayRoomSummaries` / `gokoStayRooms` ids. */
export const stayGalleryById: Record<string, readonly string[]> = Object.fromEntries(
  gokoStayRooms.map((room) => [room.id, room.images]),
);
