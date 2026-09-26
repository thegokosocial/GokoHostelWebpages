import { describe, expect, it } from "vitest";
import {
  evaluateIdSides,
  hasAadhaarFrontEvidence,
  hasPassportBioEvidence,
  requiresBothIdSides,
  validateIdFromText,
} from "@/lib/validateIdDocument";
import { isAcceptedIdFile, isHeicFile, bothSidesHelpText, removeLinkFromJoined } from "@/lib/checkinIdUpload";
import { isStaffReviewValidation } from "@/lib/checkinSubmitError";
import {
  AADHAAR_BACK_ADDRESS_ONLY,
  DARSHAN_AADHAAR_BACK_ONLY,
  DIGILOCKER_AADHAAR_WITH_ADDRESS,
  INDIAN_PASSPORT_BIO,
  INDIAN_PASSPORT_WITH_ADDRESS,
  LIKITHA_AADHAAR_FRONT,
  SUGUMAR_AADHAAR_BOTH,
} from "./fixtures/id-ocr";

describe("requiresBothIdSides", () => {
  it("requires both sides for Aadhaar and Indian passport only", () => {
    expect(requiresBothIdSides("aadhaar", "India")).toBe(true);
    expect(requiresBothIdSides("passport", "India")).toBe(true);
    expect(requiresBothIdSides("passport", "United States")).toBe(false);
    expect(requiresBothIdSides("driving_licence", "India")).toBe(false);
    expect(requiresBothIdSides("aadhaar", "France")).toBe(true); // type wins
  });
});

describe("side evidence helpers", () => {
  it("detects Aadhaar front DOB/sex and ignores guardian-only DOB", () => {
    expect(hasAadhaarFrontEvidence(LIKITHA_AADHAAR_FRONT)).toBe(true);
    expect(hasAadhaarFrontEvidence(SUGUMAR_AADHAAR_BOTH)).toBe(true);
    expect(hasAadhaarFrontEvidence(DARSHAN_AADHAAR_BACK_ONLY)).toBe(false);
    expect(hasAadhaarFrontEvidence(AADHAAR_BACK_ADDRESS_ONLY)).toBe(false);
  });

  it("detects passport bio vs address-only", () => {
    expect(hasPassportBioEvidence(INDIAN_PASSPORT_BIO)).toBe(true);
    expect(hasPassportBioEvidence("Address of Parents\nH No 12 MG Road")).toBe(false);
  });

  it("evaluateIdSides reports missing front / address / ok", () => {
    expect(evaluateIdSides(LIKITHA_AADHAAR_FRONT, "aadhaar", "India").missing).toBe("address");
    expect(evaluateIdSides(DARSHAN_AADHAAR_BACK_ONLY, "aadhaar", "India").missing).toBe("front");
    expect(evaluateIdSides(SUGUMAR_AADHAAR_BOTH, "aadhaar", "India").missing).toBeNull();
    expect(evaluateIdSides(INDIAN_PASSPORT_BIO, "passport", "India").missing).toBe("address");
    expect(evaluateIdSides(INDIAN_PASSPORT_WITH_ADDRESS, "passport", "India").missing).toBeNull();
    expect(evaluateIdSides(INDIAN_PASSPORT_BIO, "passport", "Germany").missing).toBeNull();
    expect(evaluateIdSides("anything", "driving_licence", "India").requiresBothSides).toBe(false);
  });
});

describe("hard both-sides reject matrix", () => {
  it("hard-rejects Darshan-style back-only Aadhaar even if surname appears in address", () => {
    const result = validateIdFromText(DARSHAN_AADHAAR_BACK_ONLY, "id", "aadhaar", "Darshan Chauhan", "India");
    expect(result.valid).toBe(false);
    expect(result.needsFrontSide).toBe(true);
    expect(result.layers).toContain("front_missing");
    expect(isStaffReviewValidation(result)).toBe(false);
  });

  it("hard-rejects address-only Aadhaar without DOB/sex on holder side", () => {
    const result = validateIdFromText(AADHAAR_BACK_ADDRESS_ONLY, "id", "aadhaar", "Foo Bar", "India");
    expect(result.valid).toBe(false);
    expect(result.layers).toContain("front_missing");
  });

  it("hard-rejects Likitha front-only", () => {
    const result = validateIdFromText(LIKITHA_AADHAAR_FRONT, "id", "aadhaar", "Likitha P", "India");
    expect(result.valid).toBe(false);
    expect(result.needsBackSide).toBe(true);
    expect(result.layers).toContain("address_missing");
  });

  it("accepts DigiLocker / combined Aadhaar with both sides in one blob", () => {
    const result = validateIdFromText(DIGILOCKER_AADHAAR_WITH_ADDRESS, "id", "aadhaar", "Test User", "India");
    expect(result.valid).toBe(true);
    expect(result.layers).toContain("both_sides_ok");
  });

  it("accepts Sugumar combined front+address", () => {
    const result = validateIdFromText(SUGUMAR_AADHAAR_BOTH, "id", "aadhaar", "Sugumar G", "India");
    expect(result.valid).toBe(true);
    expect(result.layers).toContain("both_sides_ok");
  });

  it("still soft-allows name mismatch after both sides pass", () => {
    const result = validateIdFromText(SUGUMAR_AADHAAR_BOTH, "id", "aadhaar", "Wrong Name", "India");
    expect(result.valid).toBe(true);
    expect(result.nameMatchQuality).toBe("none");
    expect(result.layers).toContain("both_sides_ok");
    expect(result.layers).toContain("name_mismatch");
    expect(isStaffReviewValidation(result)).toBe(true);
  });
});

describe("Vision-down allows single Aadhaar file (no 2-file gate)", () => {
  it("documents that OCR hard both-sides still applies when Vision works", () => {
    const frontOnly = validateIdFromText(LIKITHA_AADHAAR_FRONT, "id", "aadhaar", "Likitha P", "India");
    expect(frontOnly.valid).toBe(false);
    expect(frontOnly.layers).toContain("address_missing");
  });
});

describe("checkinIdUpload helpers", () => {
  it("accepts jpeg/png/webp/pdf and extension fallbacks", () => {
    expect(isAcceptedIdFile(new File([""], "a.jpg", { type: "image/jpeg" })).ok).toBe(true);
    expect(isAcceptedIdFile(new File([""], "a.png", { type: "image/png" })).ok).toBe(true);
    expect(isAcceptedIdFile(new File([""], "a.webp", { type: "image/webp" })).ok).toBe(true);
    expect(isAcceptedIdFile(new File([""], "a.pdf", { type: "application/pdf" })).ok).toBe(true);
    expect(isAcceptedIdFile(new File([""], "a.heic", { type: "image/heic" })).ok).toBe(true);
    expect(isAcceptedIdFile(new File([""], "scan.PDF", { type: "" })).ok).toBe(true);
    expect(isAcceptedIdFile(new File([""], "photo.JPG", { type: "application/octet-stream" })).ok).toBe(true);
  });

  it("rejects oversized and unsupported types", () => {
    const big = new File([new Uint8Array(11 * 1024 * 1024)], "big.jpg", { type: "image/jpeg" });
    expect(isAcceptedIdFile(big).ok).toBe(false);
    expect(isAcceptedIdFile(new File([""], "x.txt", { type: "text/plain" })).ok).toBe(false);
  });

  it("detects HEIC by mime or extension", () => {
    expect(isHeicFile(new File([""], "a.heic", { type: "" }))).toBe(true);
    expect(isHeicFile(new File([""], "a.jpg", { type: "image/heif" }))).toBe(true);
    expect(isHeicFile(new File([""], "a.jpg", { type: "image/jpeg" }))).toBe(false);
  });

  it("returns progressive both-sides help copy by id type", () => {
    expect(bothSidesHelpText("aadhaar", "India")).toMatch(/one clear photo|digilocker/i);
    expect(bothSidesHelpText("aadhaar", "India")).toMatch(/ask/i);
    expect(bothSidesHelpText("passport", "India")).toMatch(/ask/i);
    expect(bothSidesHelpText("passport", "France")).toMatch(/bio page/i);
    expect(bothSidesHelpText("driving_licence", "India")).toMatch(/licence/i);
  });

  it("removes one Drive link from a joined prevIdCardLink string", () => {
    const joined = "https://drive.google.com/a | https://drive.google.com/b | https://drive.google.com/c";
    expect(removeLinkFromJoined(joined, 1)).toBe("https://drive.google.com/a | https://drive.google.com/c");
    expect(removeLinkFromJoined(joined, 0)).toBe("https://drive.google.com/b | https://drive.google.com/c");
    expect(removeLinkFromJoined("https://drive.google.com/solo", 0)).toBe("");
    expect(removeLinkFromJoined(joined, 99)).toBe(joined);
  });
});

describe("staff-review unlock excludes hard side failures", () => {
  it("does not treat valid:false address_missing as soft unlock", () => {
    expect(isStaffReviewValidation({
      valid: false,
      layers: ["address_missing"],
    })).toBe(false);
    expect(isStaffReviewValidation({
      valid: false,
      layers: ["front_missing"],
    })).toBe(false);
  });
});
