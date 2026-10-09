import { dobsMatch, getAgeFromDob, resolveDobForChecks } from "@/lib/parseDob";

export type CheckinReviewReason = "underage" | "overage" | "dob_mismatch" | "name_check" | "document_check";

export function checkinReviewReasons(input: {
  dob?: string | null;
  dobFromId?: string | null;
  verified?: string | null;
  vibeMatched?: number | boolean | null;
  minAge?: number | null;
  maxAge?: number | null;
}): Array<{ id: CheckinReviewReason; label: string }> {
  if (input.vibeMatched) return [];
  const age = getAgeFromDob(resolveDobForChecks(input.dob, input.dobFromId) || "");
  const minAge = Number(input.minAge) || 18;
  const maxAge = Number(input.maxAge) || 40;
  const reasons: Array<{ id: CheckinReviewReason; label: string }> = [];
  if (age !== null && age < minAge) reasons.push({ id: "underage", label: `Underage (${age})` });
  if (age !== null && age > maxAge) reasons.push({ id: "overage", label: `Overage (${age})` });
  if (input.dob && input.dobFromId && !dobsMatch(input.dob, input.dobFromId)) reasons.push({ id: "dob_mismatch", label: "DOB mismatch" });
  if (input.verified === "name_review") reasons.push({ id: "name_check", label: "Name check" });
  if (input.verified === "doc_review") reasons.push({ id: "document_check", label: "Document check" });
  return reasons;
}
