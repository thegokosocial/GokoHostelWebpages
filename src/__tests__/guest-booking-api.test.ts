import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ZodError } from "zod";
const state = vi.hoisted(() => ({ pi: false, search: vi.fn(), lookup: vi.fn() }));
vi.mock("@/lib/runtime", () => ({ isPiRuntime: () => state.pi }));
vi.mock("@/lib/guestBookingSearch", () => ({ searchGuestRooms: state.search }));
vi.mock("@/lib/guestBookingLookup", () => ({ guestBookingLookup: state.lookup, LookupCodeError: class extends Error {} }));
import { GET } from "@/app/api/guest-booking/availability/route";
import { POST } from "@/app/api/guest-booking/lookup/route";
const post = (body: string, origin?: string) => new NextRequest("https://www.gokohostel.com/api/guest-booking/lookup", { method: "POST", body, headers: origin ? { origin } : {} });
beforeEach(() => { state.pi = false; state.search.mockReset(); state.lookup.mockReset(); });
describe("Public guest booking endpoints", () => {
  it("returns non-cacheable search data and rejects repeated keys", async () => {
    state.search.mockResolvedValue({ rooms: [], nativeCheckoutReady: false });
    const result = await GET(new NextRequest("https://www.gokohostel.com/api/guest-booking/availability?checkinDate=2026-10-01&checkoutDate=2026-10-03"));
    expect(result.status).toBe(200); expect(result.headers.get("cache-control")).toBe("no-store");
    expect((await GET(new NextRequest("https://www.gokohostel.com/api/guest-booking/availability?checkinDate=2026-10-01&checkinDate=2026-10-02"))).status).toBe(400);
    expect(state.search).toHaveBeenCalledTimes(1);
  });
  it("sanitizes infrastructure errors and distinguishes validation errors", async () => {
    state.search.mockRejectedValueOnce(new Error("PRIVATE_DATABASE_PASSWORD"));
    const result = await GET(new NextRequest("https://www.gokohostel.com/api/guest-booking/availability"));
    expect(result.status).toBe(503); expect(await result.text()).not.toContain("PRIVATE");
    state.search.mockRejectedValueOnce(new ZodError([]));
    expect((await GET(new NextRequest("https://www.gokohostel.com/api/guest-booking/availability"))).status).toBe(400);
  });
  it("blocks Pi without contacting storage", async () => {
    state.pi = true;
    expect((await GET(new NextRequest("https://www.gokohostel.com/api/guest-booking/availability"))).status).toBe(403);
    expect((await POST(post("{}"))).status).toBe(403);
    expect(state.lookup).not.toHaveBeenCalled(); expect(state.search).not.toHaveBeenCalled();
  });
  it("rejects cross-origin and oversized requests before lookup", async () => {
    expect((await POST(post("{}", "https://evil.example"))).status).toBe(403);
    expect((await POST(post("a".repeat(4097)))).status).toBe(413);
    expect((await POST(post("not-json"))).status).toBe(400);
    expect(state.lookup).not.toHaveBeenCalled();
  });
  it("never caches private details and hides infrastructure failures", async () => {
    state.lookup.mockResolvedValueOnce({ challengeId: crypto.randomUUID() });
    const result = await POST(post("{}", "https://www.gokohostel.com"));
    expect(result.status).toBe(200); expect(result.headers.get("cache-control")).toBe("no-store");
    state.lookup.mockRejectedValueOnce(new Error("PRIVATE"));
    const failed = await POST(post("{}")); expect(failed.status).toBe(503); expect(await failed.text()).not.toContain("PRIVATE");
  });
});
