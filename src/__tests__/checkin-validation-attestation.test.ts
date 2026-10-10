import { afterEach, describe, expect, it, vi } from "vitest";
import { issueCheckinValidationAttestation, verifyCheckinValidationAttestation } from "@/lib/checkinValidationAttestation";
import { issueCheckinReuseAttestation, verifyCheckinReuseAttestation } from "@/lib/checkinReuseAttestation";

const input = {
  category: "id" as const,
  fileDigests: ["first", "second"],
  idType: "aadhaar",
  guestName: "Ada Guest",
  nationality: "India",
};

afterEach(() => vi.unstubAllEnvs());

describe("check-in validation attestations", () => {
  it("accepts only the same normalized identity and complete file set", async () => {
    vi.stubEnv("CHECKIN_VALIDATION_TOKEN_SECRET", "01234567890123456789012345678901");
    const token = await issueCheckinValidationAttestation(input);
    expect(token).toBeTruthy();
    await expect(verifyCheckinValidationAttestation(token!, { ...input, fileDigests: ["second", "first"], guestName: " ada   guest " })).resolves.toBe(true);
    await expect(verifyCheckinValidationAttestation(token!, { ...input, fileDigests: ["first"] })).resolves.toBe(false);
    await expect(verifyCheckinValidationAttestation(token!, { ...input, nationality: "France" })).resolves.toBe(false);
  });

  it("does not issue a proof without the configured secret", async () => {
    vi.stubEnv("CHECKIN_VALIDATION_TOKEN_SECRET", "");
    await expect(issueCheckinValidationAttestation(input)).resolves.toBeNull();
  });

  it("reuses only the exact verified document links for the same identity", async () => {
    vi.stubEnv("CHECKIN_VALIDATION_TOKEN_SECRET", "01234567890123456789012345678901");
    const reuse = {
      category: "id" as const,
      name: "Ada Guest",
      contact: "9876543210",
      nationality: "India",
      idType: "aadhaar",
      links: "https://drive.google.com/file/d/verified/view",
    };
    const token = await issueCheckinReuseAttestation({ ...reuse, verified: "yes" });
    expect(token).toBeTruthy();
    await expect(verifyCheckinReuseAttestation(token!, reuse)).resolves.toBe(true);
    await expect(verifyCheckinReuseAttestation(token!, { ...reuse, links: "https://drive.google.com/file/d/other/view" })).resolves.toBe(false);
    await expect(verifyCheckinReuseAttestation(token!, { ...reuse, name: "Other Guest" })).resolves.toBe(false);
    await expect(verifyCheckinReuseAttestation(token!, { ...reuse, contact: "9000000000" })).resolves.toBe(false);
    await expect(issueCheckinReuseAttestation({ ...reuse, verified: "pending" })).resolves.toBeNull();
  });
});
