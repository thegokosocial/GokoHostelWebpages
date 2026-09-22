import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("security hardening", () => {
  it("uses cookie sessions instead of remembered browser passwords", () => {
    const admin = read("src/app/admin/page.tsx");
    const kitchen = read("src/app/kitchen/page.tsx");
    expect(admin).toContain("/api/auth/login");
    expect(admin).toContain("/api/auth/session");
    expect(admin).not.toContain("gokoAdminSession");
    expect(kitchen).toContain("/api/auth/login");
    expect(kitchen).toContain("/api/auth/session?scope=kitchen");
    expect(kitchen).not.toContain("kitchen_pw");
  });

  it("keeps admin and kitchen sessions independent and refreshes DB permissions", () => {
    const sessions = read("src/lib/authSession.ts");
    expect(sessions).toContain("`${AUTH_COOKIE}_${scope}`");
    expect(sessions).toContain("getUserByUsername(row.username)");
    expect(sessions).toContain(".catch(() => {})");
  });

  it("does not put the admin password in the OAuth URL", () => {
    const start = read("src/app/api/auth/google/start/route.ts");
    const health = read("src/components/admin/ManagementHealth.tsx");
    expect(start).toContain("getAuthSession(\"admin\")");
    expect(start).not.toContain("searchParams.get(\"password\")");
    expect(health).toContain('window.location.href = "/api/auth/google/start"');
    expect(health).not.toContain("encodeURIComponent(password)");
  });

  it("keeps upload/import on shared authorization and includes the session migration", () => {
    expect(read("src/app/api/admin/upload/route.ts")).toContain("authenticateUser");
    expect(read("src/app/api/admin/import/route.ts")).toContain("authenticateUser");
    expect(read("src/app/api/admin/upload/route.ts")).not.toContain("process.env.ADMIN_PASSWORD");
    expect(read("src/app/api/admin/import/route.ts")).not.toContain("process.env.ADMIN_PASSWORD");
    expect(read("migrations/0070_auth_sessions.sql")).toContain("CREATE TABLE auth_sessions");
  });

  it("enforces security headers for Next responses and static assets", () => {
    expect(read("next.config.ts")).toContain("Strict-Transport-Security");
    expect(read("public/_headers")).toContain("/*");
    expect(read("public/_headers")).toContain("X-Content-Type-Options: nosniff");
  });
});
