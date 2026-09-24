import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { ADMIN_NAV, ADMIN_NAV_PERMS, firstVisibleAdminSection } from "@/lib/adminNav";

const root = process.cwd();
const adminPage = readFileSync(join(root, "src/app/admin/page.tsx"), "utf8");
const management = readFileSync(join(root, "src/components/admin/AdminManagement.tsx"), "utf8");
const apiMap = readFileSync(join(root, "docs/api-map.md"), "utf8");

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(path);
    return entry.name === "route.ts" ? [path] : [];
  });
}

describe("Admin regression surface contract", () => {
  it("keeps every navigation section permission-mapped and rendered", () => {
    for (const section of ADMIN_NAV) {
      expect(ADMIN_NAV_PERMS[section], `${section} has no page permission`).toBeTruthy();
      expect(adminPage, `${section} is not rendered by AdminPage`).toContain(`section === "${section}"`);
    }
  });

  it("keeps every Management tab permission- or admin-gated and rendered", () => {
    const tabRows = [...management.matchAll(/\{ id: "([^"]+)"[\s\S]*?\},/g)].map((match) => match[1]);
    expect(tabRows.length).toBeGreaterThan(10);
    for (const tab of tabRows) {
      const row = management.slice(management.indexOf(`{ id: "${tab}"`), management.indexOf(`{ id: "${tab}"`) + 300);
      expect(row, `${tab} has no access gate`).toMatch(/adminOnly: true|permission:|selfService: true/);
      expect(management, `${tab} has no render branch`).toContain(`tab === "${tab}"`);
    }
  });

  it("exposes only the self-service preference surface without Management permission", () => {
    expect(firstVisibleAdminSection("staff", {}, "dashboard")).toBe("management");
    expect(adminPage).toContain('if (item.id === "management") return true');
    expect(management).toContain('if (t.selfService) return true');
    expect(management).toContain('if (!hasManagementAccess) return false');
    expect(management).toContain('id: "preferences"');
  });

  it("requires authentication in every Admin API route and documents every route", () => {
    const routes = routeFiles(join(root, "src/app/api/admin"));
    expect(routes.length).toBeGreaterThan(20);
    for (const file of routes) {
      const source = readFileSync(file, "utf8");
      const apiPath = `/api/${relative(join(root, "src/app/api"), file).replace(/\\/g, "/").replace(/\/route\.ts$/, "")}`;
      expect(source, `${apiPath} has no authentication call`).toMatch(/authenticate(User|Simple|Kitchen)\s*\(/);
      expect(apiMap, `${apiPath} is missing from docs/api-map.md`).toContain(`\`${apiPath}\``);
    }
  });
});
