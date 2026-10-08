import { afterEach, describe, expect, it, vi } from "vitest";
import { issueCheckinValidationAttestation, verifyCheckinValidationAttestation } from "@/lib/checkinValidationAttestation";

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
});
