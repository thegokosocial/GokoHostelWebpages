import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const adminPage = readFileSync("src/app/admin/page.tsx", "utf8");
const kitchenPage = readFileSync("src/app/kitchen/page.tsx", "utf8");

describe("admin login UI", () => {
  it("opens directly to username/password login without role selection", () => {
    expect(adminPage).toContain('id="admin-user"');
    expect(adminPage).toContain('id="admin-pw"');
    expect(adminPage).toContain('body: JSON.stringify({ password, username, scope: "admin", rememberMe })');
    expect(adminPage).not.toContain("Select your access level");
    expect(adminPage).not.toContain("Back to role selection");
    expect(adminPage).not.toContain("selectedRole");
  });

  it("keeps password visibility without persisting credentials", () => {
    expect(adminPage).toContain("showPassword");
    expect(adminPage).toContain('aria-label={showPassword ? "Hide password" : "Show password"}');
    expect(adminPage).toContain("Remember me for 15 days");
    expect(adminPage).not.toContain("gokoAdminSession");
  });

  it("does not offer self-service password change to admin accounts", () => {
    expect(adminPage).toContain('username && role !== "admin"');
  });

  it("offers the same 15-day option on the standalone kitchen login", () => {
    expect(kitchenPage).toContain('scope: "kitchen", rememberMe');
    expect(kitchenPage).toContain("Remember me for 15 days");
  });
});
