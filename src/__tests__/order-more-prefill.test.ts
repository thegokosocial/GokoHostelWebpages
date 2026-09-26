import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  hostelStubFromPrefill,
  loadActiveGuestsWithMatch,
  prefillDetailText,
  prefillTypeLabel,
  tableNumberFromPrefill,
  type OrderMorePrefillGuest,
} from "@/lib/orderMorePrefill";

describe("orderMorePrefill helpers", () => {
  const hostel: OrderMorePrefillGuest = {
    guestType: "hostel",
    checkinId: 42,
    guestName: "Suryansh Sharma",
    guestPhone: "9315566594",
    roomInfo: "Dorm A · Bed 3",
  };

  it("builds a hostel stub for place payload before getActiveGuests returns", () => {
    expect(hostelStubFromPrefill(hostel)).toMatchObject({
      id: 42,
      name: "Suryansh Sharma",
      contact: "9315566594",
      bedInfo: "Dorm A · Bed 3",
    });
    expect(hostelStubFromPrefill({ ...hostel, guestType: "walkin" })).toBeNull();
    expect(hostelStubFromPrefill({ ...hostel, checkinId: undefined })).toBeNull();
  });

  it("parses cafe table number and labels", () => {
    const table: OrderMorePrefillGuest = {
      guestType: "table",
      guestName: "Table 4",
      guestPhone: "session-1",
      roomInfo: "Table 4",
    };
    expect(tableNumberFromPrefill(table)).toBe(4);
    expect(tableNumberFromPrefill(hostel)).toBeNull();
    expect(prefillTypeLabel(hostel)).toBe("Hostel guest");
    expect(prefillTypeLabel(table)).toBe("Cafe table");
    expect(prefillDetailText(hostel)).toBe("Dorm A · Bed 3");
    expect(prefillDetailText({ guestType: "walkin", guestName: "Ada", guestPhone: "99" })).toBe("99");
  });

  it("retries getActiveGuests until the prefilled checkin appears", async () => {
    const sleep = vi.fn(async () => {});
    const fetchGuests = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce([{ id: 42, name: "Suryansh" }]);

    const result = await loadActiveGuestsWithMatch(fetchGuests, 42, {
      retries: 2,
      delayMs: 10,
      sleep,
    });

    expect(fetchGuests).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(result.match).toMatchObject({ id: 42, name: "Suryansh" });
    expect(result.guests).toHaveLength(1);
  });

  it("stops early when match is present on first fetch", async () => {
    const sleep = vi.fn(async () => {});
    const fetchGuests = vi.fn().mockResolvedValue([{ id: 42 }, { id: 7 }]);
    const result = await loadActiveGuestsWithMatch(fetchGuests, 42, { retries: 2, sleep });
    expect(fetchGuests).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(result.match?.id).toBe(42);
  });

  it("returns empty match after retries without clearing caller stub responsibility", async () => {
    const sleep = vi.fn(async () => {});
    const fetchGuests = vi.fn().mockResolvedValue([{ id: 99 }]);
    const result = await loadActiveGuestsWithMatch(fetchGuests, 42, { retries: 1, delayMs: 1, sleep });
    expect(fetchGuests).toHaveBeenCalledTimes(2);
    expect(result.match).toBeNull();
    expect(result.guests).toEqual([{ id: 99 }]);
  });
});

describe("Order More PlaceOrder contracts", () => {
  const ui = readFileSync("src/components/admin/AdminFoodOrders.tsx", "utf8");

  it("locks prefill from prop and does not clear parent on mount", () => {
    expect(ui).toContain("lockedPrefill");
    expect(ui).toContain("applyLockedPrefill");
    expect(ui).toContain("loadActiveGuestsWithMatch");
    expect(ui).toContain("abandonPrefill");
    expect(ui).not.toMatch(/useEffect\(\(\) => \{\s*if \(initialPrefillGuest\) onPrefillConsumed\(\)/);
    expect(ui).not.toContain("const [initialPrefillGuest] = useState(prefillGuest)");
  });

  it("clears prefill on place success, Add New, Change guest, and leaving Place tab", () => {
    expect(ui).toMatch(/onOrderPlaced=\{\(\) => \{\s*clearPrefillGuest\(\);\s*setTab\("summary"\);/);
    expect(ui).toMatch(/onAddNewOrder=\{\(\) => \{\s*clearPrefillGuest\(\);\s*setTab\("place"\);/);
    expect(ui).toContain('if (t.id !== "place") clearPrefillGuest()');
    expect(ui).toContain("onClick={abandonPrefill}");
    expect(ui).toContain("Ordering for");
  });
});
