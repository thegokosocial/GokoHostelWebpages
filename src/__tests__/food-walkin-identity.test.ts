import { describe, expect, it } from "vitest";
import {
  latestWalkinOrder,
  normalizeWalkinGuestName,
  normalizeWalkinPhoneKey,
  walkinIdentityKey,
  walkinOrderGroupKey,
} from "@/lib/foodWalkinIdentity";

describe("walk-in food identity", () => {
  it("combines case, spacing, Unicode compatibility, and real-phone format variants", () => {
    expect(normalizeWalkinGuestName("  Shailendra  ")).toBe("shailendra");
    expect(normalizeWalkinGuestName("Shailendra   Kumar")).toBe("shailendra kumar");
    expect(normalizeWalkinGuestName("Ｓｈａｉｌｅｎｄｒａ")).toBe("shailendra");
    expect(normalizeWalkinGuestName("ಪವನ್ ಕುಮಾರ್")).toBe("ಪವನ್ ಕುಮಾರ್");
    expect(walkinIdentityKey("+91 98765 43210", " Shailendra ")).toBe("9876543210|shailendra");
  });

  it("keeps punctuation significant so similar-looking names are not merged", () => {
    expect(normalizeWalkinGuestName("Shailen-dra")).toBe("shailen-dra");
    expect(walkinIdentityKey("1", "A-B")).not.toBe(walkinIdentityKey("1", "AB"));
  });

  it("retains the short numeric placeholders used by walk-in staff", () => {
    for (let digit = 1; digit <= 9; digit += 1) {
      expect(normalizeWalkinPhoneKey(String(digit))).toBe(String(digit));
    }
    expect(walkinIdentityKey("1", "Kavin")).toBe("1|kavin");
    expect(walkinIdentityKey("1", " KAVIN ")).toBe("1|kavin");
  });

  it("normalizes formatting without letting non-digits create an identity", () => {
    expect(normalizeWalkinPhoneKey("+91 98765-43210")).toBe("9876543210");
    expect(normalizeWalkinPhoneKey("table one")).toBe("");
    expect(normalizeWalkinPhoneKey(null)).toBe("");
  });

  it("separates different names that reuse the same dummy phone", () => {
    expect(walkinIdentityKey("1", "Kavin"))
      .not.toBe(walkinIdentityKey("1", "Shailendra"));
    expect(walkinIdentityKey("1234567890", "Kavin"))
      .not.toBe(walkinIdentityKey("1234567890", "Shailendra"));
  });

  it("does not combine orders with a missing phone or name", () => {
    expect(walkinOrderGroupKey({ id: 1, guestName: "", guestPhone: "1234567890" })).toBe("_no_identity_1");
    expect(walkinOrderGroupKey({ id: 2, guestName: "Ada", guestPhone: "" })).toBe("_no_identity_2");
  });

  it("combines repeated short-number orders only when their normalized names match", () => {
    const kavinA = walkinOrderGroupKey({ id: 1, guestName: "Kavin", guestPhone: "1" });
    const kavinB = walkinOrderGroupKey({ id: 2, guestName: " kAvIn ", guestPhone: "1" });
    const shailendra = walkinOrderGroupKey({ id: 3, guestName: "Shailendra", guestPhone: "1" });
    expect(kavinA).toBe(kavinB);
    expect(kavinA).not.toBe(shailendra);
  });

  it("keeps cafe table sessions on their existing table key", () => {
    expect(walkinOrderGroupKey({ id: 3, guestName: "Table 2", guestPhone: "123", roomInfo: "Table 2" })).toBe("table_Table 2");
    expect(walkinOrderGroupKey({ id: 4, guestName: "Someone", guestPhone: "1", roomInfo: "table 2" })).toBe("table_table 2");
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
