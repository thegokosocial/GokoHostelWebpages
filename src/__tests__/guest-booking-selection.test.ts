import { describe, expect, it } from "vitest";
import { canAddGuestRoom } from "@/lib/guestBookingSelection";
import type { GuestRoom } from "@/lib/guestBookingSearch";

const single: GuestRoom = { id: "single", name: "Mixed", type: "Bed", capacity: 1, availableUnits: 3, rates: [{ id: 1, name: "Standard", nightlyRates: [], subtotalRupees: 1000 }] };
const double: GuestRoom = { ...single, id: "double", type: "Double", capacity: 2, availableUnits: 2 };
const rooms = [single, double];
describe("Date-only search and configurable bed limit", () => {
  it("limits the combined whole-bed count across categories", () => {
    expect(canAddGuestRoom(rooms, { single: 1 }, single, 2)).toBe(true);
    expect(canAddGuestRoom(rooms, { single: 2 }, double, 2)).toBe(false);
    expect(canAddGuestRoom(rooms, {}, double, 2)).toBe(true);
    expect(canAddGuestRoom(rooms, { double: 1 }, single, 2)).toBe(true);
    expect(canAddGuestRoom(rooms, { single: 2, double: 2 }, single, 4)).toBe(false);
    expect(canAddGuestRoom(rooms, { single: 2, double: 2 }, double, 4)).toBe(false);
    expect(canAddGuestRoom(rooms, { single: 1 }, double, 1)).toBe(false);
  });
  it("does not stop selection when sleeping capacity exceeds bed count", () => {
    expect(canAddGuestRoom(rooms, { double: 1 }, double, 3)).toBe(true);
    expect(canAddGuestRoom(rooms, { double: 2 }, single, 3)).toBe(true);
  });
  it("rechecks the current selection on repeated taps and respects stock", () => {
    let selection: Record<string, number> = {};
    for (let tap = 0; tap < 20; tap++) if (canAddGuestRoom(rooms, selection, single, 4)) selection = { ...selection, single: (selection.single || 0) + 1 };
    expect(selection.single).toBe(3);
    expect(canAddGuestRoom(rooms, selection, double, 4)).toBe(true);
  });
  it("blocks missing tariffs and invalid saved limits", () => {
    expect(canAddGuestRoom(rooms, {}, { ...single, rates: [] }, 2)).toBe(false);
    for (const limit of [0, 101, 1.5, NaN]) expect(canAddGuestRoom(rooms, {}, single, limit)).toBe(false);
    expect(canAddGuestRoom(rooms, {}, single, 100)).toBe(true);
  });
});
