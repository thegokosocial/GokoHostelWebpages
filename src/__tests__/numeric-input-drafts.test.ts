import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { numericDraftValue } from "@/lib/numericInput";

describe("numeric input drafts", () => {
  it.each([
    ["", 0, undefined], ["   ", 0, undefined], ["0", 0, undefined], ["25", 25, undefined], ["2.5", 2.5, undefined], ["invalid", 0, undefined], ["", 7, 7],
  ])("normalizes %j only at a calculation boundary", (raw, expected, emptyValue) => {
    expect(numericDraftValue(raw, emptyValue)).toBe(expected);
  });

  it("keeps each affected number input as raw text while editing", () => {
    const cases = [
      ["src/components/admin/BookingSettings.tsx", "[key]: e.target.value", "[key]: Number(e.target.value)"],
      ["src/components/admin/ChannelManager.tsx", "setBookingTaxRate(e.target.value)", "e.target.value === \"\" ? 0"],
      ["src/components/admin/AdminFoodSettings.tsx", "if (rupees.trim() === \"\") return \"\"", "if (rupees.trim() === \"\") return \"0\""],
      ["src/components/admin/booking-dashboard/CreateBookingModal.tsx", "setStayTotal(e.target.value)", "setStayTotal(Number(e.target.value) || 0)"],
      ["src/components/booking/BookingHeroPanel.tsx", "setPersons(e.target.value)", "setPersons(Number(e.target.value))"],
      ["src/components/admin/ManagementAttendance.tsx", "monthlyCreditUnits: e.target.value", "monthlyCreditUnits: Math.round(Number(e.target.value) * 2)"],
    ] as const;
    for (const [path, rawHandler, eagerHandler] of cases) {
      const source = readFileSync(path, "utf8");
      expect(source, path).toContain(rawHandler);
      expect(source, path).not.toContain(eagerHandler);
    }
  });

  it("converts empty drafts at save or calculation boundaries", () => {
    expect(readFileSync("src/components/admin/BookingSettings.tsx", "utf8")).toContain("numericDraftValue(value)");
    expect(readFileSync("src/components/admin/ChannelManager.tsx", "utf8")).toContain("bookingTaxRate: numericDraftValue(bookingTaxRate)");
    expect(readFileSync("src/components/admin/AdminFoodSettings.tsx", "utf8")).toContain('food_tab_limit: settings.food_tab_limit || "0"');
    expect(readFileSync("src/components/admin/booking-dashboard/CreateBookingModal.tsx", "utf8")).toContain("const parsedStayTotal = numericDraftValue(stayTotal)");
    expect(readFileSync("src/components/booking/BookingHeroPanel.tsx", "utf8")).toContain("persons !== \"\"");
  });
});
