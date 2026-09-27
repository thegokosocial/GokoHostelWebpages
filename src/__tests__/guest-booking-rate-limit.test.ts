import { describe, expect, it, vi } from "vitest";
import { guestBookingRateLimit } from "@/lib/guestBookingRateLimit";

describe("guestBookingRateLimit", () => {
  it("allows up to the limit then blocks until the window resets", () => {
    const key = `test-${crypto.randomUUID()}`;
    const windowMs = 60_000;
    const limit = 3;
    expect(guestBookingRateLimit(key, limit, windowMs)).toBe(true);
    expect(guestBookingRateLimit(key, limit, windowMs)).toBe(true);
    expect(guestBookingRateLimit(key, limit, windowMs)).toBe(true);
    expect(guestBookingRateLimit(key, limit, windowMs)).toBe(false);
    expect(guestBookingRateLimit(key, limit, windowMs)).toBe(false);
  });

  it("resets after the window expires", () => {
    const key = `reset-${crypto.randomUUID()}`;
    const now = Date.now();
    const spy = vi.spyOn(Date, "now");
    spy.mockReturnValue(now);
    expect(guestBookingRateLimit(key, 1, 1000)).toBe(true);
    expect(guestBookingRateLimit(key, 1, 1000)).toBe(false);
    spy.mockReturnValue(now + 1001);
    expect(guestBookingRateLimit(key, 1, 1000)).toBe(true);
    spy.mockRestore();
  });
});
