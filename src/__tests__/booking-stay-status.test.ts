import { describe, expect, it } from "vitest";
import { manualCreateStatus } from "@/lib/bookingStayStatus";

const NOW = "2026-09-18T10:00:00.000Z";
const TODAY = "2026-09-18";

describe("manualCreateStatus", () => {
  it("keeps same-day and future stays as received", () => {
    expect(manualCreateStatus("2026-09-18", "2026-09-19", TODAY, NOW)).toEqual({ status: "received" });
    expect(manualCreateStatus("2026-09-20", "2026-09-22", TODAY, NOW)).toEqual({ status: "received" });
  });

  it("marks fully past stays checked_out with both stamps", () => {
    expect(manualCreateStatus("2026-09-12", "2026-09-14", TODAY, NOW)).toEqual({
      status: "checked_out",
      checkedInAt: NOW,
      checkedOutAt: NOW,
    });
    expect(manualCreateStatus("2026-09-17", "2026-09-18", TODAY, NOW)).toEqual({
      status: "checked_out",
      checkedInAt: NOW,
      checkedOutAt: NOW,
    });
  });

  it("marks straddling stays checked_in with check-in stamp only", () => {
    expect(manualCreateStatus("2026-09-12", "2026-09-20", TODAY, NOW)).toEqual({
      status: "checked_in",
      checkedInAt: NOW,
    });
    expect(manualCreateStatus("2026-09-16", "2026-09-19", TODAY, NOW)).toEqual({
      status: "checked_in",
      checkedInAt: NOW,
    });
  });
});
