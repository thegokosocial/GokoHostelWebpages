import { expect, test, type Page, type Route } from "@playwright/test";

const MOBILE = { width: 390, height: 844 };

const tinyJpeg = {
  name: "id.jpg",
  mimeType: "image/jpeg",
  buffer: Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
  ]),
};

async function stubSelfCheckinApis(
  page: Page,
  opts: {
    lookup?: Record<string, unknown> | null;
    validateSequence?: Array<Record<string, unknown>>;
  } = {},
) {
  let validateCall = 0;
  const validateSequence = opts.validateSequence ?? [
    {
      valid: true,
      documentType: "aadhaar",
      confidence: "high",
      layers: ["both_sides_ok", "name_verified"],
      message: "Aadhaar verified.",
    },
  ];

  await page.route("**/api/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();

    if (url.pathname === "/api/settings") {
      await route.fulfill({ json: { image_validation: "on" } });
      return;
    }

    if (url.pathname === "/api/checkin/lookup" && method === "GET") {
      if (opts.lookup === null) {
        await route.fulfill({ json: { found: false } });
        return;
      }
      await route.fulfill({
        json: {
          found: true,
          data: opts.lookup ?? {
            name: "Return Guest",
            contactNumber: "9876543210",
            comingFrom: "Bangalore",
            nationality: "India",
            emergencyName: "Friend",
            emergencyPhone: "9876543210",
            idType: "aadhaar",
            idCardLink: "https://drive.google.com/file/d/prevId1/view",
            visaLink: "",
            formCData: "",
          },
        },
      });
      return;
    }

    if (url.pathname === "/api/validate-id" && method === "POST") {
      const body = validateSequence[Math.min(validateCall, validateSequence.length - 1)];
      validateCall += 1;
      await route.fulfill({ json: body });
      return;
    }

    if (url.pathname === "/api/checkin" && method === "POST") {
      await route.fulfill({ json: { success: true } });
      return;
    }

    await route.fulfill({ status: 404, json: { error: "unmocked" } });
  });
}

async function skipToForm(page: Page) {
  await page.goto("/self-checkin");
  await page.getByRole("button", { name: "Skip, I'm a new guest" }).click();
  await expect(page.getByRole("heading", { name: "Guest Self Check-in" })).toBeVisible();
}

/** Gallery upload inputs only (exclude camera capture). */
function galleryInputs(page: Page) {
  return page.locator('input[type="file"]:not([capture])');
}

test.describe("self check-in guest journeys", () => {
  test.use({ viewport: MOBILE });

  test("new guest: single upload verify unlocks Complete without second slot", async ({ page }) => {
    await stubSelfCheckinApis(page, { lookup: null });
    await skipToForm(page);

    await page.locator("#idType").selectOption("aadhaar");
    await expect(page.getByText("Aadhaar document *")).toBeVisible();
    await expect(page.getByText("Back (address) *")).toHaveCount(0);

    await galleryInputs(page).first().setInputFiles(tinyJpeg);

    await page.getByRole("button", { name: "Verify document" }).click();
    await expect(page.getByText(/Aadhaar verified/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: "Complete Check-in" })).toBeEnabled();
  });

  test("progressive: address_missing reveals Back slot then re-verify succeeds", async ({ page }) => {
    await stubSelfCheckinApis(page, {
      lookup: null,
      validateSequence: [
        {
          valid: false,
          documentType: "aadhaar",
          confidence: "high",
          needsBackSide: true,
          layers: ["address_missing"],
          message: "Aadhaar front found, but address was not. Please also upload the back side showing your address.",
        },
        {
          valid: true,
          documentType: "aadhaar",
          confidence: "high",
          layers: ["both_sides_ok", "name_verified"],
          message: "Aadhaar verified.",
        },
      ],
    });
    await skipToForm(page);
    await page.locator("#idType").selectOption("aadhaar");

    await galleryInputs(page).first().setInputFiles({ ...tinyJpeg, name: "front.jpg" });
    await page.getByRole("button", { name: "Verify document" }).click();
    await expect(page.getByText(/Address not found on your upload/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Back (address) *")).toBeVisible();

    await galleryInputs(page).last().setInputFiles({ ...tinyJpeg, name: "back.jpg" });
    await page.getByRole("button", { name: "Verify document" }).last().click();
    await expect(page.getByText(/Aadhaar verified/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: "Complete Check-in" })).toBeEnabled();
  });

  test("returning guest: Remove X clears previous ID preview", async ({ page }) => {
    await stubSelfCheckinApis(page);
    await page.goto("/self-checkin");
    await page.locator("#phoneLookup").fill("9876543210");
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page.getByText("ID document (from previous visit)")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: "Remove Previous ID 1" })).toBeVisible();

    await page.getByRole("button", { name: "Remove Previous ID 1" }).click();
    await expect(page.getByText("ID document (from previous visit)")).toHaveCount(0);
    await expect(page.getByText("Aadhaar document *")).toBeVisible();
  });

  test("skip new guest reaches form without lookup", async ({ page }) => {
    await stubSelfCheckinApis(page, { lookup: null });
    await skipToForm(page);
    await expect(page.getByLabel(/First name/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Complete Check-in" })).toBeVisible();
  });
});
