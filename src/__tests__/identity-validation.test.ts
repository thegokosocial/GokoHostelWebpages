import { describe, expect, it } from "vitest";
import { getAgeFromDob, parseDobFromOcr, resolveDobForChecks } from "@/lib/parseDob";
import { validateIdFromText } from "@/lib/validateIdDocument";

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
});

describe("ID name matching", () => {
  const idText = "INDIAN UNION DRIVING LICENCE\nName: PAWAN DHIRAN\nD.O.B: 01/07/1994\nIssued on: 01/07/2014\nValid till: 01/07/2034";

  it("accepts a surname initial", () => {
    const result = validateIdFromText(idText, "id", "driving_licence", "Pawan D");
    expect(result.valid).toBe(true);
    expect(result.nameMatch).toBe(true);
  });

  it("rejects an unrelated name", () => {
    const result = validateIdFromText(idText, "id", "driving_licence", "Sameer Joshi");
    expect(result.valid).toBe(false);
    expect(result.nameMatch).toBe(false);
  });
});
