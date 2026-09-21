import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("Splits wiring", () => {
  it("UI fetches /api/admin/splits and never useAdminApi", () => {
    const ui = readFileSync("src/components/admin/AdminSplits.tsx", "utf8");
    expect(ui).toContain('fetch("/api/admin/splits"');
    expect(ui).not.toContain("useAdminApi");
  });

  it("admin page hides Splits via NEXT_PUBLIC_GOKO_RUNTIME, not isOfflineMode", () => {
    const page = readFileSync("src/app/admin/page.tsx", "utf8");
    expect(page).toContain("isSplitsSectionEnabled");
    expect(page).not.toContain("isOfflineMode");
    expect(page).toContain("AdminSplits");
  });

  it("ADMIN_NAV omits splits on Pi and API 403s on Pi", () => {
    const nav = readFileSync("src/lib/adminNav.ts", "utf8");
    const route = readFileSync("src/app/api/admin/splits/route.ts", "utf8");
    expect(nav).toContain("NEXT_PUBLIC_GOKO_RUNTIME");
    expect(nav).toContain("canViewSplits");
    expect(route).toContain("isPiRuntime()");
    expect(route).toContain("apply migration 0041");
  });

  it("does not sync split tables", () => {
    const sync = readFileSync("src/lib/syncEngine.ts", "utf8");
    expect(sync).not.toMatch(/split_/);
  });

  it("edit infers equal-with-Goko and restore shares on replace", () => {
    const ui = readFileSync("src/components/admin/AdminSplits.tsx", "utf8");
    const queries = readFileSync("src/db/splitQueries.ts", "utf8");
    const route = readFileSync("src/app/api/admin/splits/route.ts", "utf8");
    expect(ui).toContain("inferGokoIncludeMode");
    expect(ui).toContain("owedIdsWithGoko");
    expect(ui).toContain("sharesMoneyEqual");
    expect(ui).toContain("deleteSettlement");
    expect(queries).toContain("insertShares(expenseId, previous)");
    expect(queries).toContain("hostelExpenseIsLinked");
    expect(route).toContain("isHouse(to)");
    expect(route).toContain("countLiveHumanSettlements");
    expect(route).toContain("countLiveSettlements");
    expect(route).toContain("createdBy !== actorName");
    expect(route).toContain("assertGokoPayerRules");
    expect(route).toContain("Undo settlements in this group before changing money");
    expect(route).toContain("split expense cleanup failed");
    expect(route).toContain("if (!settlementId)");
    const expenses = readFileSync("src/app/api/admin/expenses/route.ts", "utf8");
    expect(expenses).toContain("rejectIfSplitLinked");
    expect(expenses).toContain("!isPiRuntime()");
    expect(ui).toContain("settleLocked");
    expect(ui).toContain("onDeleted");
    expect(route).toContain("split expense post-save bookkeeping failed");
    expect(ui).toContain("Who paid how much");
    expect(ui).toContain("Link your login");
  });
});
