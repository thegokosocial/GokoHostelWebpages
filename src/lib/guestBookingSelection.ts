import type { GuestRoom } from "./guestBookingSearch";

/** Display-only selection: never reserves inventory or authorizes payment. */
export function canAddGuestRoom(rooms: GuestRoom[], selection: Record<string, number>, room: GuestRoom, guests: number) {
  const count = rooms.reduce((sum, item) => sum + (selection[item.id] || 0), 0);
  const capacity = rooms.reduce((sum, item) => sum + (selection[item.id] || 0) * item.capacity, 0);
  return Number.isInteger(guests) && guests >= 1 && guests <= 4 && !!room.rates?.length
    && (selection[room.id] || 0) < room.availableUnits && count < guests && capacity < guests;
}
