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

type CheckinCapture = {
  raw: string;
  hasIdempotencyKey: boolean;
  idValidationAttestation: string | null;
  prevIdReuseAttestation: string | null;
};

async function stubSelfCheckinApis(
  page: Page,
  opts: {
    lookup?: Record<string, unknown> | null;
    validateSequence?: Array<Record<string, unknown>>;
    onCheckin?: (capture: CheckinCapture) => void;
    checkinResponse?: { status: number; json: Record<string, unknown> };
  } = {},
) {
  let validateCall = 0;
  const validateSequence = opts.validateSequence ?? [
    {
      valid: true,
      attestation: "test-signed-attestation",
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
      const raw = route.request().postData() || "";
      const keyMatch = raw.match(/name="idempotencyKey"\r?\n\r?\n([0-9a-f-]{36})/i);
      const attestationMatch = raw.match(/name="idValidationAttestation"\r?\n\r?\n([^\r\n]+)/i);
      const reuseMatch = raw.match(/name="prevIdReuseAttestation"\r?\n\r?\n([^\r\n]+)/i);
      opts.onCheckin?.({
        raw,
        hasIdempotencyKey: Boolean(keyMatch?.[1]),
        idValidationAttestation: attestationMatch?.[1] ?? null,
        prevIdReuseAttestation: reuseMatch?.[1] ?? null,
      });
      await route.fulfill(opts.checkinResponse ?? { json: { success: true } });
      return;
    }

    await route.fulfill({ status: 404, json: { error: "unmocked" } });
  });
}

async function fillRequiredGuestFields(page: Page, over: {
  firstName?: string;
  lastName?: string;
  contact?: string;
  emergencyPhone?: string;
} = {}) {
  await page.locator("#bookingPlatform").selectOption("Walk-in");
  await page.locator("#firstName").fill(over.firstName ?? "Ada");
  await page.locator("#lastName").fill(over.lastName ?? "Guest");
  await page.locator("#numberOfPersons").fill("1");
  await page.locator("#stayingDays").fill("2");
  await page.locator("#comingFrom").fill("Bangalore");
  await page.locator("#contactNumber").fill(over.contact ?? "9876543210");
  await page.locator("#emergencyName").fill("Bob Friend");
  await page.locator("#emergencyPhone").fill(over.emergencyPhone ?? "9000000001");
}

async function pickCountry(page: Page, inputId: string, country: string) {
  const input = page.locator(`#${inputId}`);
  await input.click();
  await input.fill(country);
  await page.locator("li", { hasText: country }).first().click();
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

  test("QR or other unrecognized upload blocks completion and asks for a valid ID", async ({ page }) => {
    await stubSelfCheckinApis(page, {
      lookup: null,
      validateSequence: [{
        valid: false,
        documentType: "unknown",
        confidence: "high",
        layers: ["invalid_id"],
        message: "This does not appear to be a valid ID. Please upload Aadhaar, Driving Licence, or Passport.",
      }],
    });
    await skipToForm(page);
    await fillRequiredGuestFields(page);
    await page.locator("#idType").selectOption("aadhaar");
    await galleryInputs(page).first().setInputFiles({ ...tinyJpeg, name: "qr-photo.jpg" });
    await page.getByRole("button", { name: "Verify document" }).click();
    await expect(page.getByText(/does not appear to be a valid ID/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: "Complete Check-in" })).toBeDisabled();
  });

  test("complete name mismatch clears the ID and requires the guest's own document", async ({ page }) => {
    let checkinCalls = 0;
    await stubSelfCheckinApis(page, {
      lookup: null,
      onCheckin: () => { checkinCalls += 1; },
      validateSequence: [{
        valid: false,
        documentType: "driving_licence",
        confidence: "high",
        nameMatch: false,
        nameMatchQuality: "none",
        layers: ["type_match", "name_mismatch"],
        message: "This ID does not show your name. Please upload your own valid driving licence, or approach our staff for assisted check-in.",
      }],
    });
    await skipToForm(page);
    await fillRequiredGuestFields(page, { firstName: "Sai", lastName: "Nikhil" });
    await page.locator("#idType").selectOption("driving_licence");
    await galleryInputs(page).first().setInputFiles({ ...tinyJpeg, name: "someone-else-id.jpg" });
    await page.getByRole("button", { name: "Verify document" }).click();

    await expect(page.getByText(/does not show your name.*assisted check-in/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("someone-else-id.jpg")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Complete Check-in" })).toBeDisabled();
    expect(checkinCalls).toBe(0);
  });

  test("partial name match remains submit-able and visibly flagged for staff review", async ({ page }) => {
    await stubSelfCheckinApis(page, {
      lookup: null,
      validateSequence: [{
        valid: true,
        attestation: "test-partial-name-attestation",
        documentType: "driving_licence",
        confidence: "high",
        nameMatch: false,
        nameMatchQuality: "partial",
        layers: ["type_match", "name_partial"],
        needsDocReview: true,
        message: "Driving licence detected. Name partially matches — staff will confirm.",
      }],
    });
    await skipToForm(page);
    await fillRequiredGuestFields(page, { firstName: "Sai", lastName: "Nikhil" });
    await page.locator("#idType").selectOption("driving_licence");
    await galleryInputs(page).first().setInputFiles(tinyJpeg);
    await page.getByRole("button", { name: "Verify document" }).click();

    await expect(page.getByText(/name partially matches.*staff will confirm/i)).toBeVisible({ timeout: 10_000 });
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

  test("returning guest sends the server-issued reuse proof", async ({ page }) => {
    let capture: CheckinCapture | null = null;
    await stubSelfCheckinApis(page, {
      lookup: {
        name: "Ada Guest", contactNumber: "9876543210", comingFrom: "Bangalore", nationality: "India",
        emergencyName: "Friend", emergencyPhone: "9876543210", idType: "aadhaar",
        idCardLink: "https://drive.google.com/file/d/prevId1/view", visaLink: "", formCData: "",
        idReuseAttestation: "server-signed-reuse-proof",
      },
      onCheckin: (value) => { capture = value; },
    });
    await page.goto("/self-checkin");
    await page.locator("#phoneLookup").fill("9876543210");
    await page.getByRole("button", { name: "Continue" }).click();
    await fillRequiredGuestFields(page, { firstName: "Ada", lastName: "Guest" });
    await page.getByRole("button", { name: "Complete Check-in" }).click();
    await expect(page.getByText(/saved successfully/i)).toBeVisible({ timeout: 10_000 });
    expect((capture as CheckinCapture | null)?.prevIdReuseAttestation).toBe("server-signed-reuse-proof");
  });

  test("skip new guest reaches form without lookup", async ({ page }) => {
    await stubSelfCheckinApis(page, { lookup: null });
    await skipToForm(page);
    await expect(page.getByLabel(/First name/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Complete Check-in" })).toBeVisible();
  });

  test("new guest Complete sends idempotency key and shows success", async ({ page }) => {
    let capture: CheckinCapture | null = null;
    await stubSelfCheckinApis(page, {
      lookup: null,
      onCheckin: (c) => { capture = c; },
    });
    await skipToForm(page);
    await fillRequiredGuestFields(page);
    await page.locator("#idType").selectOption("aadhaar");
    await galleryInputs(page).first().setInputFiles(tinyJpeg);
    await page.getByRole("button", { name: "Verify document" }).click();
    await expect(page.getByText(/Aadhaar verified/i)).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: "Complete Check-in" }).click();
    await expect(page.getByText("Check-in complete!")).toBeVisible({ timeout: 10_000 });
    expect(capture).not.toBeNull();
    expect(capture!.hasIdempotencyKey).toBe(true);
    expect(capture!.idValidationAttestation).toBe("test-signed-attestation");
  });

  test("in-progress submission keeps the form retryable", async ({ page }) => {
    await stubSelfCheckinApis(page, {
      lookup: null,
      checkinResponse: {
        status: 409,
        json: { code: "checkin_submission_in_progress", error: "This check-in is already being submitted." },
      },
    });
    await skipToForm(page);
    await fillRequiredGuestFields(page);
    await page.locator("#idType").selectOption("aadhaar");
    await galleryInputs(page).first().setInputFiles(tinyJpeg);
    await page.getByRole("button", { name: "Verify document" }).click();
    await expect(page.getByText(/Aadhaar verified/i)).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Complete Check-in" }).click();
    await expect(page.getByText(/already being submitted/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Complete Check-in" })).toBeEnabled();
  });

  test("new guest can select Goko Hostel Website without a booking ID", async ({ page }) => {
    let capture: CheckinCapture | null = null;
    await stubSelfCheckinApis(page, {
      lookup: null,
      onCheckin: (c) => { capture = c; },
    });
    await skipToForm(page);
    await fillRequiredGuestFields(page);
    await page.locator("#bookingPlatform").selectOption("Goko Hostel Website");
    await page.locator("#idType").selectOption("aadhaar");
    await galleryInputs(page).first().setInputFiles(tinyJpeg);
    await page.getByRole("button", { name: "Verify document" }).click();
    await expect(page.getByText(/Aadhaar verified/i)).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: "Complete Check-in" }).click();
    await expect(page.getByText("Check-in complete!")).toBeVisible({ timeout: 10_000 });
    expect(capture).not.toBeNull();
    expect(capture!.raw).toMatch(/name="bookingPlatform"[\s\S]*Goko Hostel Website/);
    expect(capture!.raw).not.toMatch(/name="bookingId"/);
  });

  test("foreign guest: visa required UI then Complete with mocked APIs", async ({ page }) => {
    let capture: CheckinCapture | null = null;
    await stubSelfCheckinApis(page, {
      lookup: null,
      validateSequence: [
        {
          valid: true,
          documentType: "passport",
          confidence: "high",
          layers: ["both_sides_ok", "name_verified"],
          message: "Passport verified.",
        },
        {
          valid: true,
          documentType: "visa",
          confidence: "high",
          layers: ["visa_ok"],
          message: "Visa verified.",
        },
      ],
      onCheckin: (c) => { capture = c; },
    });
    await skipToForm(page);
    await fillRequiredGuestFields(page, {
      firstName: "Jean",
      lastName: "Dupont",
      contact: "9123456789",
      emergencyPhone: "9000000099",
    });
    await pickCountry(page, "nationality", "France");
    await expect(page.locator("#idType")).toHaveValue("passport");
    await expect(page.getByText(/Visa document \(required for non-Indian nationals\)/i)).toBeVisible();

    await galleryInputs(page).first().setInputFiles({ ...tinyJpeg, name: "passport.jpg" });
    // Visa MultiDocUpload is the last gallery file input when foreign
    await galleryInputs(page).last().setInputFiles({ ...tinyJpeg, name: "visa.jpg" });

    await page.getByRole("button", { name: "Verify document" }).first().click();
    await expect(page.getByText(/Passport verified/i)).toBeVisible({ timeout: 10_000 });

    await pickCountry(page, "arrivedFromCountry", "France");
    await page.locator('select[name="purposeOfVisit"]').selectOption("Tourism");

    await page.getByRole("button", { name: "Complete Check-in" }).click();
    await expect(page.getByText("Check-in complete!")).toBeVisible({ timeout: 10_000 });
    expect(capture).not.toBeNull();
    expect(capture!.hasIdempotencyKey).toBe(true);
    expect(capture!.raw).toMatch(/name="nationality"[\s\S]*France/);
    expect(capture!.raw).toMatch(/name="visaImages"/);
  });
});
