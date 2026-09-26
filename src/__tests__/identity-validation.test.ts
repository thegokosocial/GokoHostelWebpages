import { describe, expect, it } from "vitest";
import { dobEqualsArrivalDate, getAgeFromDob, parseDobFromOcr, resolveDobForChecks } from "@/lib/parseDob";
import { validateIdFromText, verifiedFromIdValidation } from "@/lib/validateIdDocument";
import {
  DIGILOCKER_AADHAAR_WITH_ADDRESS,
  DL_WITH_TRANSPORT,
  FOREIGN_PASSPORT_BIO,
  INDIAN_PASSPORT_BIO,
  INDIAN_PASSPORT_WITH_ADDRESS,
  LIKITHA_AADHAAR_FRONT,
  MARKSHEET,
  PRAVALLIKA_PAN,
  SUGUMAR_AADHAAR_BOTH,
  VEHICLE_RC,
  VOTER_ID,
} from "./fixtures/id-ocr";

describe("DOB validation and resolution", () => {
  it("prefers a real DL DOB over an issue date returned first by OCR layout", () => {
    const text = "Indian Union Driving Licence\nDoB: 04/09/2014\nIssued on: 04/09/2014\nDoB: 07/06/1996\nName: SHUVAM MOHAPATRA";
    expect(parseDobFromOcr(text, "driving_licence")).toBe("07/06/1996");
  });

  it("uses OCR DOB when the manual DOB is blank", () => {
    expect(resolveDobForChecks("", "13/03/1993")).toBe("13/03/1993");
  });

  it("rejects invalid and future DOBs", () => {
    const today = new Date();
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    expect(getAgeFromDob(todayIso)).toBe(0);
    expect(getAgeFromDob(`${today.getFullYear() + 1}-01-01`)).toBeNull();
    expect(getAgeFromDob("31/04/2000")).toBeNull();
  });

  it("does not treat blank form+OCR as a DOB and discards OCR equal to arrival", () => {
    expect(resolveDobForChecks("", "")).toBeNull();
    expect(dobEqualsArrivalDate("26/09/2026", "2026-09-26")).toBe(true);
    expect(dobEqualsArrivalDate("02/06/1996", "2026-09-26")).toBe(false);
  });

  it("matches Likitha-style ISO form DOB against OCR DMY", () => {
    expect(resolveDobForChecks("2002-08-01", "01/08/2002")).toBe("01/08/2002");
  });
});

describe("prod-scenario ID validation", () => {
  it("accepts Sugumar-style Aadhaar with name and address in one OCR blob", () => {
    const result = validateIdFromText(SUGUMAR_AADHAAR_BOTH, "id", "aadhaar", "Sugumar G", "India");
    expect(result.valid).toBe(true);
    expect(result.documentType).toBe("aadhaar");
    expect(result.needsBackSide).toBeFalsy();
    expect(result.nameMatchQuality).toBe("full");
    expect(parseDobFromOcr(SUGUMAR_AADHAAR_BOTH, "aadhaar")).toBe("02/06/1996");
  });

  it("hard-rejects Likitha-style Aadhaar front without address (needs back)", () => {
    const result = validateIdFromText(LIKITHA_AADHAAR_FRONT, "id", "aadhaar", "Likitha P", "India");
    expect(result.valid).toBe(false);
    expect(result.needsBackSide).toBe(true);
    expect(result.layers).toContain("address_missing");
    expect(result.layers).not.toContain("doc_review");
    expect(result.message).toMatch(/address/i);
  });

  it("rejects Pravallika-style DigiLocker PAN as PAN, not Aadhaar", () => {
    const result = validateIdFromText(PRAVALLIKA_PAN, "id", "aadhaar", "Pravallika H", "India");
    expect(result.valid).toBe(false);
    expect(result.documentType).toBe("unknown");
    expect(result.layers).toContain("unsupported_pan");
    expect(result.message).toMatch(/PAN card detected/i);
  });
});

describe("unsupported document rejects", () => {
  it("rejects voter / EPIC cards", () => {
    const result = validateIdFromText(VOTER_ID, "id", "aadhaar", "Test User", "India");
    expect(result.valid).toBe(false);
    expect(result.layers).toContain("unsupported_voter");
    expect(result.message).toMatch(/Voter ID detected/i);
  });

  it("rejects mark sheets", () => {
    const result = validateIdFromText(MARKSHEET, "id", "aadhaar", "Test Student", "India");
    expect(result.valid).toBe(false);
    expect(result.layers).toContain("unsupported_marksheet");
    expect(result.message).toMatch(/Mark sheet detected/i);
  });

  it("rejects clear vehicle RC that is not a driving licence", () => {
    const result = validateIdFromText(VEHICLE_RC, "id", "driving_licence", "Test Owner", "India");
    expect(result.valid).toBe(false);
    expect(result.layers).toContain("unsupported_vehicle_rc");
    expect(result.message).toMatch(/Vehicle registration detected/i);
  });

  it("still accepts a real DL that mentions Transport Department", () => {
    const result = validateIdFromText(DL_WITH_TRANSPORT, "id", "driving_licence", "Pawan Dhiran", "India");
    expect(result.valid).toBe(true);
    expect(result.documentType).toBe("driving_licence");
    expect(result.layers).not.toContain("unsupported_vehicle_rc");
  });
});

describe("passport address by nationality", () => {
  it("hard-rejects Indian passport bio-only without address page", () => {
    const result = validateIdFromText(INDIAN_PASSPORT_BIO, "id", "passport", "Rahul Sharma", "India");
    expect(result.valid).toBe(false);
    expect(result.needsBackSide).toBe(true);
    expect(result.message).toMatch(/address page/i);
  });

  it("accepts Indian passport with address evidence", () => {
    const result = validateIdFromText(INDIAN_PASSPORT_WITH_ADDRESS, "id", "passport", "Rahul Sharma", "India");
    expect(result.valid).toBe(true);
    expect(result.needsBackSide).toBeFalsy();
  });

  it("does not require address for foreign passport bio page", () => {
    const result = validateIdFromText(FOREIGN_PASSPORT_BIO, "id", "passport", "John Doe", "United States");
    expect(result.valid).toBe(true);
    expect(result.needsBackSide).toBeFalsy();
    expect(result.layers).not.toContain("address_missing");
  });
});

describe("name matching quality", () => {
  const idText = DL_WITH_TRANSPORT;

  it("accepts a surname initial as full match", () => {
    const result = validateIdFromText(idText, "id", "driving_licence", "Pawan D", "India");
    expect(result.valid).toBe(true);
    expect(result.nameMatchQuality).toBe("full");
  });

  it("soft-allows when no name tokens match for staff Vibe OK", () => {
    const result = validateIdFromText(idText, "id", "driving_licence", "Sameer Joshi", "India");
    expect(result.valid).toBe(true);
    expect(result.nameMatchQuality).toBe("none");
    expect(result.layers).toContain("name_mismatch");
    expect(verifiedFromIdValidation(result)).toBe("name_review");
  });

  it("accepts partial name match with name_partial for staff Vibe", () => {
    const result = validateIdFromText(SUGUMAR_AADHAAR_BOTH, "id", "aadhaar", "Sugumar Patel", "India");
    expect(result.valid).toBe(true);
    expect(result.nameMatchQuality).toBe("partial");
    expect(result.needsDocReview || result.layers?.includes("name_partial")).toBeTruthy();
    expect(verifiedFromIdValidation(result)).toBe("name_review");
  });
});

describe("DigiLocker Aadhaar and verified mapping", () => {
  it("accepts DigiLocker Aadhaar when name and address are present", () => {
    const result = validateIdFromText(DIGILOCKER_AADHAAR_WITH_ADDRESS, "id", "aadhaar", "Test User", "India");
    expect(result.valid).toBe(true);
    expect(result.documentType).toBe("aadhaar");
  });

  it("maps validation_unavailable to pending and name_mismatch to name_review", () => {
    expect(verifiedFromIdValidation({ layers: ["validation_unavailable"] })).toBe("pending");
    expect(verifiedFromIdValidation({ layers: ["doc_review"], needsDocReview: true })).toBe("doc_review");
    expect(verifiedFromIdValidation({ spoofWarning: true })).toBe("spoof_warning");
    expect(verifiedFromIdValidation({ layers: ["name_verified"] })).toBe("yes");
    expect(verifiedFromIdValidation({ nameMatchQuality: "none", layers: ["name_mismatch"] })).toBe("name_review");
    expect(verifiedFromIdValidation({ layers: ["unreadable", "doc_review"], needsDocReview: true })).toBe("doc_review");
  });

  it("soft-allows unreadable OCR and unidentified visa for staff review", () => {
    const blank = validateIdFromText("abc", "id", "aadhaar", "Test User", "India");
    expect(blank.valid).toBe(true);
    expect(blank.layers).toContain("unreadable");
    expect(verifiedFromIdValidation(blank)).toBe("doc_review");

    const visa = validateIdFromText("random boarding pass text only here", "visa");
    expect(visa.valid).toBe(true);
    expect(visa.layers).toContain("visa_unidentified");
    expect(verifiedFromIdValidation(visa)).toBe("doc_review");
  });

  it("still hard-rejects type mismatch so the guest can fix the dropdown", () => {
    const result = validateIdFromText(SUGUMAR_AADHAAR_BOTH, "id", "passport", "Sugumar G", "India");
    expect(result.valid).toBe(false);
    expect(result.layers).toContain("type_mismatch");
    expect(result.documentType).toBe("aadhaar");
  });
});
