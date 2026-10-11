import { expect, test, type Page } from "@playwright/test";

async function mockReviews(page: Page, calls: Array<Record<string, unknown>>) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/auth/login") return route.fulfill({ json: { role: "admin", username: "e2e-admin", permissions: {} } });
    if (url.pathname === "/api/auth/session") return route.fulfill({ status: 401, json: { authenticated: false } });
    const body = JSON.parse(route.request().postData() || "{}") as Record<string, unknown>;
    if (url.pathname === "/api/admin/reviews") {
      calls.push(body);
      if (body.action === "listAskReview") return route.fulfill({ json: { guests: [{ checkinId: 7, guestName: "Ada", guestContact: "9876543210", checkedOutAt: "2026-10-10T10:00:00.000Z", bookingPlatform: "Walk-in", bookingId: "G-7", reviewRequest: null }] } });
      if (body.action === "getSettings") return route.fulfill({ json: { review_google_url: "https://g.page/r/goko", review_send_delay: "immediate", review_whatsapp_enabled: true } });
      if (body.action === "getReviewWhatsAppTemplates") return route.fulfill({ json: { templates: [{ id: "feedback", name: "Review feedback", message: "Rate {REVIEW_URL}" }, { id: "google", name: "Review us on Google", message: "Google: {GOOGLE_REVIEW_URL}" }] } });
      if (body.action === "sendWhatsApp") return route.fulfill({ json: { success: true, token: "review-token", sentCount: 1 } });
    }
    return route.fulfill({ json: {} });
  });
}

for (const [surface, viewport] of [["desktop", { width: 1280, height: 900 }], ["mobile", { width: 390, height: 844 }]] as const) test(`review templates defer preparation until a ${surface} selection`, async ({ page }) => {
  const calls: Array<Record<string, unknown>> = [];
  await mockReviews(page, calls);
  await page.setViewportSize(viewport);
  await page.goto("/admin?section=reviews");
  await page.locator("#admin-user").fill("e2e-admin");
  await page.locator("#admin-pw").fill("e2e-password");
  await page.getByRole("button", { name: "Login" }).click();
  const send = page.getByRole("button", { name: "Send WhatsApp" }).last();
  await expect(send).toBeVisible();
  await send.click();
  await expect(page.getByText("Message Ada")).toBeVisible();
  expect(calls.filter((body) => body.action === "sendWhatsApp")).toHaveLength(0);

  await page.getByRole("button", { name: "Review us on Google" }).click();
  expect(calls.filter((body) => body.action === "sendWhatsApp")).toHaveLength(1);
  await expect(page.locator("textarea").last()).toHaveValue("Google: https://g.page/r/goko");
  await expect(page.locator('textarea[value*="review-token"]')).toHaveCount(0);
});
