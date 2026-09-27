import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { buildBillWhatsAppDraft } from "@/lib/billShare";

describe("WhatsApp bill share (link-only; PNG attach deferred)", () => {
  it("keeps the live my-bills link in the message text", () => {
    const draft = buildBillWhatsAppDraft({
      guestPhone: "9876543210",
      guestName: "Vishakh",
      shareUrl: "https://gokohostel.com/my-bills?t=abc123",
    });
    expect(draft).not.toBeNull();
    expect(draft!.phone).toBe("919876543210");
    expect(draft!.message).toContain("https://gokohostel.com/my-bills?t=abc123");
    expect(draft!.message).toContain("Vishakh");
  });

  it("admin Food Orders does not ship a Share image CTA (wa.me cannot attach)", () => {
    const ui = readFileSync("src/components/admin/AdminFoodOrders.tsx", "utf8");
    expect(ui).not.toContain("Share image");
    expect(ui).not.toContain("shareBillImage");
  });
});
