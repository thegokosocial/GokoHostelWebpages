import { expect, test } from "@playwright/test";

test("Server Sync shows the deploy error returned by the API", async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const body = JSON.parse(route.request().postData() || "{}") as { action?: string };
    if (url.pathname === "/api/auth/login") return route.fulfill({ json: { role: "admin", username: "e2e-admin", permissions: {} } });
    if (url.pathname === "/api/auth/session") return route.fulfill({ status: 401, json: {} });
    if (url.pathname !== "/api/sync") return route.fulfill({ json: body.action === "auth" ? { role: "admin", permissions: {} } : {} });
    if (body.action === "deployUpdate") return route.fulfill({ status: 502, json: { error: "Failed to reach Pi: timeout" } });
    if (body.action === "status") return route.fulfill({ json: { status: { cloudflare: { online: true, build: "main", records: 1, lastSeen: new Date().toISOString() }, pi: { online: true, build: "old", records: 1, lastSeen: new Date().toISOString() }, internetConnected: true, primaryServer: "cloudflare", lastSync: null, recordsPulled: 0, recordsPushed: 0, conflicts: 0, pendingChanges: 0, autoSync: false } } });
    if (body.action === "getConflicts") return route.fulfill({ json: { conflicts: [] } });
    if (body.action === "getSyncLog") return route.fulfill({ json: { logs: [] } });
    return route.fulfill({ json: {} });
  });

  await page.goto("/admin?section=management&tab=server-sync");
  await page.locator("#admin-user").fill("e2e-admin");
  await page.locator("#admin-pw").fill("e2e-only-password");
  await page.getByRole("button", { name: "Login" }).click();
  await page.getByRole("button", { name: "Server Sync" }).click();
  await page.getByRole("button", { name: "Deploy Now" }).click();
  await expect(page.getByText("Failed to reach Pi: timeout")).toBeVisible();
});
