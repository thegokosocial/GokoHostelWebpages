import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  DIGILOCKER_AADHAAR_WITH_ADDRESS,
  DL_WITH_TRANSPORT,
  LIKITHA_AADHAAR_FRONT,
  PRAVALLIKA_PAN,
  SUGUMAR_AADHAAR_BOTH,
  VOTER_ID,
} from "./fixtures/id-ocr";
import { isStaffReviewValidation, messageFromCheckinFailure } from "@/lib/checkinSubmitError";
import { verifiedFromIdValidation } from "@/lib/validateIdDocument";

const q = vi.hoisted(() => ({
  getActiveCheckins: vi.fn(),
  getSetting: vi.fn(),
  addCheckin: vi.fn(),
  incrementStat: vi.fn(),
  getMonthKey: vi.fn(() => "2026-09"),
  addAuditEntry: vi.fn(),
  addSystemLog: vi.fn(),
  dispatchPush: vi.fn(),
  isOfflineMode: vi.fn(() => false),
  visionAnalyze: vi.fn(),
  driveUploadFile: vi.fn(),
  driveGetOrCreateFolder: vi.fn(),
}));

vi.mock("@/db/queries", () => ({
  getActiveCheckins: q.getActiveCheckins,
  getSetting: q.getSetting,
  addCheckin: q.addCheckin,
  incrementStat: q.incrementStat,
  getMonthKey: q.getMonthKey,
  addAuditEntry: q.addAuditEntry,
  addSystemLog: q.addSystemLog,
}));

vi.mock("@/lib/googleApiFetch", () => ({
  visionAnalyze: q.visionAnalyze,
  driveUploadFile: q.driveUploadFile,
  driveGetOrCreateFolder: q.driveGetOrCreateFolder,
}));

vi.mock("@/lib/pushNotify", () => ({
  dispatchPush: q.dispatchPush,
  notificationFirstName: (name: string) => name.split(/\s+/)[0] || name,
}));

vi.mock("@/lib/runtime", () => ({ isOfflineMode: q.isOfflineMode }));

vi.mock("@/lib/guestBookingRateLimit", () => ({
  guestBookingRateLimit: () => true,
  assertGuestOrigin: () => undefined,
}));

import { POST as checkinPOST } from "@/app/api/checkin/route";
import { POST as validateIdPOST } from "@/app/api/validate-id/route";

function visionOk(text: string) {
  return {
    text,
    labels: ["document", "identity document", "text"],
    objects: ["card"],
    safeSearch: { adult: "VERY_UNLIKELY", spoof: "VERY_UNLIKELY", violence: "VERY_UNLIKELY", medical: "VERY_UNLIKELY", racy: "VERY_UNLIKELY" },
    isPdf: false,
  };
}

function baseFields(over: Record<string, string> = {}) {
  return {
    name: "Sugumar G",
    contactNumber: "9741707135",
    nationality: "India",
    idType: "aadhaar",
    arrivalDate: "2026-09-26",
    arrivalTime: "18:01",
    stayingDays: "2",
    comingFrom: "Bangalore",
    numberOfPersons: "1",
    emergencyName: "friend",
    emergencyPhone: "9741707135",
    bookingPlatform: "Walk-in",
    ...over,
  };
}

function idFile(name = "id.jpg") {
  return new File(["fake-id-bytes"], name, { type: "image/jpeg" });
}

function checkinRequest(fields: Record<string, string>, files: File[] = [idFile()]) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  for (const f of files) fd.append("idImages", f);
  return new NextRequest("http://localhost/api/checkin", {
    method: "POST",
    body: fd,
    headers: { origin: "http://localhost" },
  });
}

function validateRequest(fields: {
  idType?: string;
  guestName?: string;
  nationality?: string;
  category?: string;
  file?: File;
}) {
  const fd = new FormData();
  fd.append("file", fields.file || idFile());
  fd.append("category", fields.category || "id");
  if (fields.idType) fd.append("idType", fields.idType);
  if (fields.guestName) fd.append("guestName", fields.guestName);
  if (fields.nationality) fd.append("nationality", fields.nationality);
  return new NextRequest("http://localhost/api/validate-id", { method: "POST", body: fd });
}

/** Guest UI gate: submit unlocked after verify success or soft service error (with both-sides file gate). */
function guestCanSubmit(state: {
  validationEnabled: boolean;
  idValidated: boolean;
  idServerError: boolean;
  hasPrevId: boolean;
  hasIdFiles: boolean;
  bothSidesRequired?: boolean;
  idFileCount?: number;
}) {
  if (!state.validationEnabled) return true;
  if (state.hasPrevId) return true;
  if (state.idServerError && state.bothSidesRequired && (state.idFileCount ?? 0) < 2) return false;
  if (state.idValidated || state.idServerError) return true;
  return !state.hasIdFiles;
}

describe("self-check-in mock E2E workflows", () => {
  beforeEach(() => {
    for (const fn of Object.values(q)) fn.mockReset();
    q.getMonthKey.mockReturnValue("2026-09");
    q.isOfflineMode.mockReturnValue(false);
    q.getActiveCheckins.mockResolvedValue([]);
    q.getSetting.mockResolvedValue("on");
    q.addCheckin.mockResolvedValue(undefined);
    q.incrementStat.mockResolvedValue(undefined);
    q.addAuditEntry.mockResolvedValue(undefined);
    q.addSystemLog.mockResolvedValue(undefined);
    q.dispatchPush.mockResolvedValue(undefined);
    q.driveUploadFile.mockResolvedValue("https://drive.google.com/file/d/mockId/view");
    q.driveGetOrCreateFolder.mockResolvedValue("month-folder");
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_KEY", JSON.stringify({
      client_email: "vision@test.iam.gserviceaccount.com",
      private_key: "-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----\n",
    }));
    vi.stubEnv("GOOGLE_DRIVE_FOLDER_ID", "root-folder");
  });

  describe("happy path: verify then complete", () => {
    it("accepts full Aadhaar OCR on validate-id and persists verified=yes on check-in", async () => {
      q.visionAnalyze.mockResolvedValue(visionOk(SUGUMAR_AADHAAR_BOTH));

      const validateRes = await validateIdPOST(validateRequest({
        idType: "aadhaar",
        guestName: "Sugumar G",
        nationality: "India",
      }));
      expect(validateRes.status).toBe(200);
      const validated = await validateRes.json();
      expect(validated.valid).toBe(true);
      expect(validated.nameMatchQuality).toBe("full");
      expect(isStaffReviewValidation(validated)).toBe(false);
      expect(verifiedFromIdValidation(validated)).toBe("yes");
      expect(guestCanSubmit({
        validationEnabled: true,
        idValidated: true,
        idServerError: false,
        hasPrevId: false,
        hasIdFiles: true,
      })).toBe(true);

      const checkinRes = await checkinPOST(checkinRequest(baseFields()));
      expect(checkinRes.status).toBe(200);
      expect(await checkinRes.json()).toEqual({ success: true });
      expect(q.addCheckin).toHaveBeenCalledTimes(1);
      const saved = q.addCheckin.mock.calls[0][0];
      expect(saved.verified).toBe("yes");
      expect(saved.name).toBe("Sugumar G");
      expect(saved.idCardLink).toContain("drive.google.com");
      expect(saved.bookingPlatform).toBe("Walk-in");
      expect(saved.bookingId).toMatch(/^GOKO/);
    });
  });

  describe("both-sides hard reject (Aadhaar / Indian passport)", () => {
    it("rejects Aadhaar front-only (missing address) on validate and check-in", async () => {
      q.visionAnalyze.mockResolvedValue(visionOk(LIKITHA_AADHAAR_FRONT));

      const validateRes = await validateIdPOST(validateRequest({
        idType: "aadhaar",
        guestName: "Likitha P",
        nationality: "India",
      }));
      const validated = await validateRes.json();
      expect(validated.valid).toBe(false);
      expect(validated.needsBackSide).toBe(true);
      expect(validated.layers).toContain("address_missing");
      expect(isStaffReviewValidation(validated)).toBe(false);

      const checkinRes = await checkinPOST(checkinRequest(baseFields({
        name: "Likitha P",
        contactNumber: "9000000001",
      })));
      expect(checkinRes.status).toBe(422);
      expect(q.addCheckin).not.toHaveBeenCalled();
    });

    it("name mismatch soft-allows as name_review for staff Vibe OK", async () => {
      q.visionAnalyze.mockResolvedValue(visionOk(DL_WITH_TRANSPORT));

      const validateRes = await validateIdPOST(validateRequest({
        idType: "driving_licence",
        guestName: "Sameer Joshi",
        nationality: "India",
      }));
      const validated = await validateRes.json();
      expect(validated.valid).toBe(true);
      expect(validated.nameMatchQuality).toBe("none");
      expect(verifiedFromIdValidation(validated)).toBe("name_review");

      const checkinRes = await checkinPOST(checkinRequest(baseFields({
        name: "Sameer Joshi",
        idType: "driving_licence",
        contactNumber: "9000000002",
      })));
      expect(checkinRes.status).toBe(200);
      expect(q.addCheckin.mock.calls[0][0].verified).toBe("name_review");
    });

    it("Vision throw with 1 Aadhaar file hard-gates check-in (need both sides)", async () => {
      q.visionAnalyze.mockRejectedValue(new Error("Vision annotate 403"));

      const validateRes = await validateIdPOST(validateRequest({
        idType: "aadhaar",
        guestName: "Pawan Dhiran",
        nationality: "India",
      }));
      const validated = await validateRes.json();
      expect(validated.valid).toBe(true);
      expect(validated.layers).toContain("validation_unavailable");

      q.visionAnalyze.mockRejectedValue(new Error("Vision annotate 403"));
      const checkinRes = await checkinPOST(checkinRequest(baseFields({
        name: "Pawan Dhiran",
        contactNumber: "9000000003",
      }), [idFile("front.jpg")]));
      expect(checkinRes.status).toBe(422);
      const body = await checkinRes.json();
      expect(body.error).toMatch(/front and back|DigiLocker/i);
      expect(q.addCheckin).not.toHaveBeenCalled();
    });

    it("Vision throw with 2 Aadhaar files soft-allows check-in as pending", async () => {
      q.visionAnalyze.mockRejectedValue(new Error("Vision annotate 403"));
      const checkinRes = await checkinPOST(checkinRequest(baseFields({
        name: "Pawan Dhiran",
        contactNumber: "9000000033",
      }), [idFile("front.jpg"), idFile("back.jpg")]));
      expect(checkinRes.status).toBe(200);
      expect(q.addCheckin.mock.calls[0][0].verified).toBe("pending");
    });

    it("Vision throw with 1 DL file soft-allows check-in as pending", async () => {
      q.visionAnalyze.mockRejectedValue(new Error("Vision annotate 403"));
      const checkinRes = await checkinPOST(checkinRequest(baseFields({
        name: "Pawan Dhiran",
        idType: "driving_licence",
        contactNumber: "9000000034",
      }), [idFile("dl.jpg")]));
      expect(checkinRes.status).toBe(200);
      expect(q.addCheckin.mock.calls[0][0].verified).toBe("pending");
    });

    it("unreadable OCR soft-allows with doc_review", async () => {
      q.visionAnalyze.mockResolvedValue(visionOk("tiny"));

      const validateRes = await validateIdPOST(validateRequest({
        idType: "aadhaar",
        guestName: "Guest",
        nationality: "India",
      }));
      const validated = await validateRes.json();
      expect(validated.valid).toBe(true);
      expect(validated.layers).toContain("unreadable");
      expect(verifiedFromIdValidation(validated)).toBe("doc_review");

      const checkinRes = await checkinPOST(checkinRequest(baseFields({
        name: "Guest",
        contactNumber: "9000000004",
      })));
      expect(checkinRes.status).toBe(200);
      expect(q.addCheckin.mock.calls[0][0].verified).toBe("doc_review");
    });
  });

  describe("hard rejects still stop the guest", () => {
    it("PAN card soft-fails validate and 422s check-in without insert", async () => {
      q.visionAnalyze.mockResolvedValue(visionOk(PRAVALLIKA_PAN));

      const validateRes = await validateIdPOST(validateRequest({
        idType: "aadhaar",
        guestName: "Pravallika H",
        nationality: "India",
      }));
      const validated = await validateRes.json();
      expect(validated.valid).toBe(false);
      expect(validated.layers).toContain("unsupported_pan");
      expect(guestCanSubmit({
        validationEnabled: true,
        idValidated: false,
        idServerError: false,
        hasPrevId: false,
        hasIdFiles: true,
      })).toBe(false);

      const checkinRes = await checkinPOST(checkinRequest(baseFields({
        name: "Pravallika H",
        contactNumber: "9000000005",
      })));
      expect(checkinRes.status).toBe(422);
      const body = await checkinRes.json();
      expect(body.error).toMatch(/PAN/i);
      expect(q.addCheckin).not.toHaveBeenCalled();
    });

    it("voter ID hard-rejects on check-in", async () => {
      q.visionAnalyze.mockResolvedValue(visionOk(VOTER_ID));
      const checkinRes = await checkinPOST(checkinRequest(baseFields({
        name: "Test User",
        contactNumber: "9000000006",
      })));
      expect(checkinRes.status).toBe(422);
      expect(await checkinRes.json()).toMatchObject({ field: "idImages" });
      expect(q.addCheckin).not.toHaveBeenCalled();
    });

    it("type mismatch hard-rejects with fix message", async () => {
      q.visionAnalyze.mockResolvedValue(visionOk(SUGUMAR_AADHAAR_BOTH));
      const checkinRes = await checkinPOST(checkinRequest(baseFields({
        idType: "passport",
        contactNumber: "9000000007",
      })));
      expect(checkinRes.status).toBe(422);
      const body = await checkinRes.json();
      expect(body.error).toMatch(/aadhaar/i);
      expect(q.addCheckin).not.toHaveBeenCalled();
    });

    it("SafeSearch adult content hard-rejects", async () => {
      q.visionAnalyze.mockResolvedValue({
        ...visionOk(SUGUMAR_AADHAAR_BOTH),
        safeSearch: { adult: "VERY_LIKELY", spoof: "VERY_UNLIKELY", violence: "VERY_UNLIKELY", medical: "VERY_UNLIKELY", racy: "VERY_UNLIKELY" },
      });
      const checkinRes = await checkinPOST(checkinRequest(baseFields({
        contactNumber: "9000000008",
      })));
      expect(checkinRes.status).toBe(422);
      expect(q.addCheckin).not.toHaveBeenCalled();
    });
  });

  describe("guest UI submit gate + error surfacing", () => {
    it("unlocks submit on soft service failure without idValidated", () => {
      expect(guestCanSubmit({
        validationEnabled: true,
        idValidated: false,
        idServerError: true,
        hasPrevId: false,
        hasIdFiles: true,
      })).toBe(true);
    });

    it("blocks Vision-down Aadhaar submit until both sides are uploaded", () => {
      expect(guestCanSubmit({
        validationEnabled: true,
        idValidated: false,
        idServerError: true,
        hasPrevId: false,
        hasIdFiles: true,
        bothSidesRequired: true,
        idFileCount: 1,
      })).toBe(false);
      expect(guestCanSubmit({
        validationEnabled: true,
        idValidated: false,
        idServerError: true,
        hasPrevId: false,
        hasIdFiles: true,
        bothSidesRequired: true,
        idFileCount: 2,
      })).toBe(true);
    });

    it("maps API failure bodies the way Complete Check-in should show them", () => {
      expect(messageFromCheckinFailure(500, { error: "Database temporarily unavailable. Please try again." }))
        .toBe("Database temporarily unavailable. Please try again.");
      expect(messageFromCheckinFailure(429, { error: "Too many submissions. Please try again later." }))
        .toMatch(/too many/i);
      expect(messageFromCheckinFailure(400, { error: "Missing required fields" })).toBe("Missing required fields");
      expect(messageFromCheckinFailure(422, { error: "PAN card detected. Please upload Aadhaar, Driving Licence, or Passport." }))
        .toMatch(/PAN/i);
    });

    it("surfaces missing-fields 400 as guest-readable error (not generic front desk)", async () => {
      const fd = new FormData();
      fd.set("contactNumber", "9000000009");
      const bare = await checkinPOST(new NextRequest("http://localhost/api/checkin", {
        method: "POST",
        body: fd,
        headers: { origin: "http://localhost" },
      }));
      expect(bare.status).toBe(400);
      const body = await bare.json();
      expect(messageFromCheckinFailure(bare.status, body)).toBe("Missing required fields");
    });
  });

  describe("edge workflows", () => {
    it("reuses prevIdCardLink without Vision and marks verified yes", async () => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(baseFields({ contactNumber: "9000000010" }))) fd.set(k, v);
      fd.set("prevIdCardLink", "https://drive.google.com/file/d/prev/view");
      const res = await checkinPOST(new NextRequest("http://localhost/api/checkin", {
        method: "POST",
        body: fd,
        headers: { origin: "http://localhost" },
      }));
      expect(res.status).toBe(200);
      expect(q.visionAnalyze).not.toHaveBeenCalled();
      expect(q.addCheckin.mock.calls[0][0].verified).toBe("yes");
      expect(q.addCheckin.mock.calls[0][0].idCardLink).toContain("prev");
    });

    it("skips Vision when image_validation is off and still inserts", async () => {
      q.getSetting.mockResolvedValue("off");
      q.visionAnalyze.mockResolvedValue(visionOk(PRAVALLIKA_PAN));
      const res = await checkinPOST(checkinRequest(baseFields({ contactNumber: "9000000011" })));
      expect(res.status).toBe(200);
      expect(q.visionAnalyze).not.toHaveBeenCalled();
      expect(q.addCheckin.mock.calls[0][0].verified).toBe("pending");
    });

    it("idempotent duplicate active visit returns success without second insert", async () => {
      q.getActiveCheckins.mockResolvedValue([{
        id: 77,
        status: "active",
        name: "Sugumar G",
        contact: "9741707135",
        arrivalDate: "2026-09-26",
      }]);
      const res = await checkinPOST(checkinRequest(baseFields()));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true, duplicate: true, checkinId: 77 });
      expect(q.addCheckin).not.toHaveBeenCalled();
    });

    it("Drive upload failure does not block check-in insert", async () => {
      q.visionAnalyze.mockResolvedValue(visionOk(DIGILOCKER_AADHAAR_WITH_ADDRESS));
      q.driveUploadFile.mockRejectedValue(new Error("Drive OAuth expired"));
      const res = await checkinPOST(checkinRequest(baseFields({
        name: "Test User",
        contactNumber: "9000000012",
      })));
      expect(res.status).toBe(200);
      expect(q.addCheckin.mock.calls[0][0].idCardLink).toBe("Upload failed");
    });

    it("rejects foreigner without visa before Vision", async () => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(baseFields({
        name: "Jean Dupont",
        nationality: "France",
        idType: "passport",
        contactNumber: "9000000013",
      }))) fd.set(k, v);
      fd.append("idImages", idFile("passport.jpg"));
      const res = await checkinPOST(new NextRequest("http://localhost/api/checkin", {
        method: "POST",
        body: fd,
        headers: { origin: "http://localhost" },
      }));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ field: "visaImages" });
      expect(q.visionAnalyze).not.toHaveBeenCalled();
    });

    it("never auto-sets vibeMatched on name soft-allow insert", async () => {
      q.visionAnalyze.mockResolvedValue(visionOk(DL_WITH_TRANSPORT));
      await checkinPOST(checkinRequest(baseFields({
        name: "Sameer Joshi",
        idType: "driving_licence",
        contactNumber: "9000000014",
      })));
      const saved = q.addCheckin.mock.calls[0][0];
      expect(saved.verified).toBe("name_review");
      expect(saved.vibeMatched).toBeUndefined();
    });

    it("skips second Vision pass when clientIdValidation=verified", async () => {
      q.visionAnalyze.mockResolvedValue(visionOk(SUGUMAR_AADHAAR_BOTH));
      const res = await checkinPOST(checkinRequest({
        ...baseFields({ contactNumber: "9000000015" }),
        clientIdValidation: "verified",
      }));
      expect(res.status).toBe(200);
      expect(q.visionAnalyze).not.toHaveBeenCalled();
      expect(q.addCheckin.mock.calls[0][0].verified).toBe("yes");
    });
  });
});
