import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const adminPage = readFileSync("src/app/admin/page.tsx", "utf8");

describe("admin login UI", () => {
  it("opens directly to username/password login without role selection", () => {
    expect(adminPage).toContain('id="admin-user"');
    expect(adminPage).toContain('id="admin-pw"');
    expect(adminPage).toContain('const body: any = { password, username, action: "auth" };');
    expect(adminPage).not.toContain("Select your access level");
    expect(adminPage).not.toContain("Back to role selection");
    expect(adminPage).not.toContain("selectedRole");
  });

  it("keeps password visibility and remember-me controls", () => {
    expect(adminPage).toContain("showPassword");
    expect(adminPage).toContain('aria-label={showPassword ? "Hide password" : "Show password"}');
    expect(adminPage).toContain("Keep me signed in");
    expect(adminPage).toContain('localStorage.setItem("gokoAdminSession"');
  });
});
