import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ authenticateUser: vi.fn() }));
vi.mock("@/lib/mediaR2", () => ({ deleteMediaKeys: vi.fn(), getMediaBucket: vi.fn(), putMediaObject: vi.fn() }));
vi.mock("@/db/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/queries")>();
  return {
    ...actual,
    getSetting: vi.fn(),
    setSetting: vi.fn(),
    getAllMenuCategories: vi.fn(),
    addMenuCategory: vi.fn(),
    updateMenuCategory: vi.fn(),
    deleteMenuCategory: vi.fn(),
    getAllMenuItems: vi.fn(),
    addMenuItem: vi.fn(),
    updateMenuItem: vi.fn(),
    deleteMenuItem: vi.fn(),
    getMenuItemById: vi.fn(),
    toggleMenuItemAvailability: vi.fn(),
    getMenuItemsByCategory: vi.fn(),
    addStock: vi.fn(),
    getLowStockItems: vi.fn(),
  };
});

import { authenticateUser } from "@/lib/auth";
import { getSetting, setSetting } from "@/db/queries";
import { deleteMediaKeys } from "@/lib/mediaR2";
import { POST as foodPOST } from "@/app/api/admin/food/route";
import { splitGstPaise, brandingFromSettings } from "@/lib/foodBillFormat";

const admin = { role: "admin" as const, displayName: "Admin", permissions: {} };
const billStaff = {
  role: "staff" as const,
  displayName: "Staff",
  permissions: { canGenerateFoodBills: true },
};

async function post(body: Record<string, unknown>) {
  return foodPOST(
    new NextRequest("http://localhost/api/admin/food", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("Bill settings / branding API (real handler)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateUser).mockResolvedValue(admin);
    vi.mocked(getSetting).mockImplementation(async (key: string) => {
      const map: Record<string, string> = {
        food_bill_hostel_name: "Goko Hostel",
        food_bill_location: "Gokarna, Karnataka",
        food_bill_accent: "#E67E22",
        food_bill_upi_id: "9148973725@okbizaxis",
        food_bill_payment_qr_url: "/api/media/bills/2026-09-18-test.png",
        food_bill_footer: "Thanks for dining with us! Visit again",
        food_tax_rate: "5",
      };
      return map[key] ?? "";
    });
    vi.mocked(setSetting).mockResolvedValue(undefined as never);
  });

  it("getBillBranding returns settings for canGenerateFoodBills staff", async () => {
    vi.mocked(authenticateUser).mockResolvedValue(billStaff);
    const res = await post({ password: "x", action: "getBillBranding" });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.taxRate).toBe(5);
    expect(body.branding.hostelName).toBe("Goko Hostel");
    expect(body.branding.upiId).toContain("@");
    expect(body.settings.food_bill_payment_qr_url).toContain("/api/media/bills/");
  });

  it("rejects getBillBranding without permission", async () => {
    vi.mocked(authenticateUser).mockResolvedValue({
      role: "staff",
      displayName: "Staff",
      permissions: {},
    });
    const res = await post({ password: "x", action: "getBillBranding" });
    expect(res.status).toBe(403);
  });

  it("writes QR url before deleting previous R2 object", async () => {
    const order: string[] = [];
    vi.mocked(setSetting).mockImplementation(async (key: string) => {
      order.push(`set:${key}`);
    });
    vi.mocked(deleteMediaKeys).mockImplementation(async (keys: string[]) => {
      order.push(`del:${keys.join(",")}`);
    });
    vi.mocked(getSetting).mockImplementation(async (key: string) => {
      if (key === "food_bill_payment_qr_url") return "/api/media/bills/old.png";
      return "";
    });

    const res = await post({
      password: "x",
      action: "updateFoodSettings",
      settings: { food_bill_payment_qr_url: "/api/media/bills/new.png" },
    });
    expect(res.status).toBe(200);
    expect(order[0]).toBe("set:food_bill_payment_qr_url");
    expect(order[1]).toBe("del:bills/old.png");
  });

  it("mirrors live guest tab GST split math", () => {
    // Live sample: Pravallika tab ~121400 paise; use representative tax from 5%
    const tax = 6070; // odd
    expect(splitGstPaise(tax)).toEqual({ cgst: 3035, sgst: 3035 });
    expect(splitGstPaise(tax + 1)).toEqual({ cgst: 3036, sgst: 3035 });
    const b = brandingFromSettings({
      food_bill_hostel_name: "Goko Hostel",
      food_bill_upi_id: "9148973725@okbizaxis",
    });
    expect(b.upiId).toBe("9148973725@okbizaxis");
  });
});
