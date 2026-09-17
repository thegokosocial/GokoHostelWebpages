import type { GuestRoom } from "./guestBookingSearch";
import { MAX_WEBSITE_BOOKING_BEDS } from "./websiteBookingSettings";

/** Display-only selection: never reserves inventory or authorizes payment. */
export function canAddGuestRoom(rooms: GuestRoom[], selection: Record<string, number>, room: GuestRoom, maxSelectedBeds: number) {
  const count = rooms.reduce((sum, item) => sum + (selection[item.id] || 0), 0);
  return Number.isInteger(maxSelectedBeds) && maxSelectedBeds >= 1 && maxSelectedBeds <= MAX_WEBSITE_BOOKING_BEDS && !!room.rates?.length
    && (selection[room.id] || 0) < room.availableUnits && count < maxSelectedBeds;
}
