import { describe, expect, it } from "vitest";
import {
  latestWalkinOrder,
  normalizeWalkinGuestName,
  walkinIdentityKey,
  walkinOrderGroupKey,
} from "@/lib/foodWalkinIdentity";

describe("walk-in food identity", () => {
  it("combines case, spacing, punctuation, Unicode, and phone-format variants", () => {
    expect(normalizeWalkinGuestName("  Shailendra  ")).toBe("shailendra");
    expect(normalizeWalkinGuestName("Shailen-dra")).toBe("shailendra");
    expect(normalizeWalkinGuestName("ಪವನ್ ಕುಮಾರ್")).toBe("ಪವನ್ಕುಮಾರ್");
    expect(walkinIdentityKey("+91 98765 43210", " Shailendra ")).toBe("9876543210|shailendra");
  });

  it("separates different names that reuse the same dummy phone", () => {
    expect(walkinIdentityKey("1234567890", "Kavin"))
      .not.toBe(walkinIdentityKey("1234567890", "Shailendra"));
  });

  it("does not combine orders with a missing phone or name", () => {
    expect(walkinOrderGroupKey({ id: 1, guestName: "", guestPhone: "1234567890" })).toBe("_no_identity_1");
    expect(walkinOrderGroupKey({ id: 2, guestName: "Ada", guestPhone: "" })).toBe("_no_identity_2");
  });

  it("keeps cafe table sessions on their existing table key", () => {
    expect(walkinOrderGroupKey({ id: 3, guestName: "Table 2", guestPhone: "123", roomInfo: "Table 2" })).toBe("table_Table 2");
  });

  it("uses the latest order's display spelling without changing identity", () => {
    const latest = latestWalkinOrder([
      { id: 1, guestName: "shailendra", guestPhone: "1234567890", createdAt: "2026-09-20T00:00:00Z" },
      { id: 2, guestName: "Shailendra", guestPhone: "1234567890", createdAt: "2026-09-25T00:00:00Z" },
    ]);
    expect(latest.id).toBe(2);
    expect(latest.guestName).toBe("Shailendra");
  });
});
