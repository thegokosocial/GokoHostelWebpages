import { describe, expect, it } from "vitest";
import { parseDobFromOcr } from "@/lib/parseDob";
import { validateIdFromText } from "@/lib/validateIdDocument";

const drivingLicenceOcr = `
INDIAN UNION DRIVING LICENCE
ODISHA STATE FORM-7
Number : OD-0220140531375
Name : SHUVAM MOHAPATRA
S/D/W of : HARIHAR BARIK
Address : PLOT NO-208/833, KHANDAGIRI VIHAR NEAR
Issued on : 04-09-2014
DOB : 07-06-1996 BG: O+ve
Valid till (Non-Transport) 03-09-2034
Vehicle Class MCWG LMV
`;

describe("ID OCR matching", () => {
  it("matches the supplied driving licence name and DOB", () => {
    const result = validateIdFromText(drivingLicenceOcr, "id", "driving_licence", "Shuvam Mohapatra");
    expect(result).toMatchObject({ valid: true, documentType: "driving_licence", nameMatch: true });
    expect(parseDobFromOcr(drivingLicenceOcr, "driving_licence")).toBe("07/06/1996");
  });

  it("handles harmless name case, spacing, and one-character OCR noise", () => {
    const result = validateIdFromText("Driving Licence\nName: S H U V A M MOHAPATR\nDOB: 07.06.1996\nLMV", "id", "driving_licence", "Shuvam Mohapatra");
    expect(result.valid).toBe(true);
  });

  it("does not match a name found only in guardian text", () => {
    const result = validateIdFromText("Driving Licence\nName: RAHUL DAS\nS/D/W of: SHUVAM MOHAPATRA\nDOB: 07-06-1996\nLMV", "id", "driving_licence", "Shuvam Mohapatra");
    expect(result.valid).toBe(false);
    expect(result.nameMatch).toBe(false);
  });

  it("keeps Aadhaar and passport DOB parsing working", () => {
    expect(parseDobFromOcr("Unique Identification Authority of India\nName: A Person\nDOB: 12/08/1990\nAddress: Bengaluru 560001", "aadhaar")).toBe("12/08/1990");
    expect(parseDobFromOcr("P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\nL898902C36UTO7408122F1204159ZE184226B<<<<<<1", "passport")).toBe("12/08/1974");
  });

  it("rejects invalid or future extracted DOBs", () => {
    expect(parseDobFromOcr("Driving Licence\nDOB: 31-02-1996\nLMV", "driving_licence")).toBeNull();
    expect(parseDobFromOcr("Driving Licence\nDOB: 07-06-2099\nLMV", "driving_licence")).toBeNull();
  });
});
