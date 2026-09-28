import { describe, expect, it } from "vitest";
import {
  buildOpenCafeTableOccupancy,
  cafeTableDisplayLabel,
  cafeTableSessionKey,
  canonicalCafeTableRoomInfo,
  isCafeTableSessionReleased,
  latestWalkinOrder,
  normalizeWalkinGuestName,
  normalizeWalkinPhoneKey,
  releasedCafeTableSessionPhone,
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

  it("isolates cafe table visits by session id on the same table", () => {
    const paid = walkinOrderGroupKey({ id: 3, guestName: "Old Guest", guestPhone: "111", roomInfo: "Table 1" });
    const open = walkinOrderGroupKey({ id: 4, guestName: "Shashwat", guestPhone: "222", roomInfo: "Table 1" });
    expect(paid).toBe("table_Table 1|111");
    expect(open).toBe("table_Table 1|222");
    expect(paid).not.toBe(open);
    expect(walkinOrderGroupKey({ id: 5, guestName: "Someone", guestPhone: "1", roomInfo: "table 2" }))
      .toBe("table_Table 2|1");
  });

  it("keeps phone+name grouping for walk-ins and ignores hostel bed roomInfo as a cafe table", () => {
    expect(walkinOrderGroupKey({
      id: 10, guestName: "Kavin", guestPhone: "9876543210", roomInfo: "Dorm A - Bed 2",
    })).toBe("9876543210|kavin");
    expect(walkinOrderGroupKey({
      id: 11, guestName: "Kavin", guestPhone: "+91 98765 43210", roomInfo: "",
    })).toBe("9876543210|kavin");
    // Released marker is cafe-only; plain walk-in phones never get table session keys.
    expect(isCafeTableSessionReleased("9876543210")).toBe(false);
    expect(buildOpenCafeTableOccupancy([
      { id: 12, guestName: "Kavin", guestPhone: "9876543210", roomInfo: "", createdAt: "2026-09-28T10:00:00Z" },
    ]).size).toBe(0);
  });

  it("does not collapse legacy table orders with empty session onto table-only", () => {
    expect(walkinOrderGroupKey({ id: 9, guestName: "Ghost", guestPhone: "", roomInfo: "Table 3" }))
      .toBe("_no_identity_9");
  });

  it("canonicalizes table room labels and builds display names", () => {
    expect(canonicalCafeTableRoomInfo("table 2")).toBe("Table 2");
    expect(cafeTableSessionKey("  1729-abc  ")).toBe("1729");
    expect(cafeTableDisplayLabel("Table 2", "Aditya")).toBe("Table 2 · Aditya");
    expect(cafeTableDisplayLabel("Table 2", "Table 2")).toBe("Table 2");
  });

  it("maps newest unreleased session per table and skips released holds", () => {
    expect(isCafeTableSessionReleased("r:222")).toBe(true);
    expect(cafeTableSessionKey("r:1727001234567")).toBe("1727001234567");
    expect(releasedCafeTableSessionPhone("1727")).toBe("r:1727");
    const map = buildOpenCafeTableOccupancy([
      { id: 2, guestName: "Released", guestPhone: "r:222", roomInfo: "Table 1", createdAt: "2026-09-28T10:00:00Z" },
      { id: 1, guestName: "Old unpaid", guestPhone: "111", roomInfo: "Table 1", createdAt: "2026-09-26T10:00:00Z" },
      { id: 3, guestName: "Aditya", guestPhone: "333", roomInfo: "Table 2", createdAt: "2026-09-28T11:00:00Z" },
    ]);
    // Newest Table 1 is released → fall through to older unreleased session.
    expect(map.get(1)).toMatchObject({ guestName: "Old unpaid", sessionPhone: "111", roomInfo: "Table 1" });
    expect(map.get(2)).toMatchObject({ guestName: "Aditya", sessionPhone: "333" });
    expect(map.size).toBe(2);
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
