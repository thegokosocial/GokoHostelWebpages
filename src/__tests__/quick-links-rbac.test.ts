import { describe, expect, it } from "vitest";
import { actionAllowed } from "@/lib/actionPermissions";
import { ALL_PERMISSION_KEYS } from "@/lib/permissionCatalog";

describe("quick links RBAC", () => {
  it("is part of the active permission catalog", () => {
    expect(ALL_PERMISSION_KEYS).toContain("canViewQuickLinks");
  });

  it("allows viewers to read but keeps mutations admin-only", () => {
    expect(actionAllowed("staff", { canViewQuickLinks: true }, "canViewQuickLinks")).toBe("allowed");
    expect(actionAllowed("staff", { canViewQuickLinks: true }, "admin_only")).toBe("admin_required");
    expect(actionAllowed("admin", {}, "admin_only")).toBe("allowed");
  });
});
