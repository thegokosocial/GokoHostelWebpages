import { dobsMatch, getAgeFromDob, resolveDobForChecks } from "@/lib/parseDob";

export type CheckinReviewReason = "underage" | "overage" | "dob_mismatch" | "name_check" | "document_check";

export type CheckinReviewInput = {
  dob?: string | null;
  dobFromId?: string | null;
  verified?: string | null;
  vibeMatched?: number | boolean | null;
  minAge?: number | null;
  maxAge?: number | null;
};

export type CheckinReviewLabel = { id: CheckinReviewReason; label: string };

function reviewReasons(input: CheckinReviewInput): CheckinReviewLabel[] {
  const age = getAgeFromDob(resolveDobForChecks(input.dob, input.dobFromId) || "");
  const minAge = Number(input.minAge) || 18;
  const maxAge = Number(input.maxAge) || 40;
  const reasons: CheckinReviewLabel[] = [];
  if (age !== null && age < minAge) reasons.push({ id: "underage", label: `Underage (${age})` });
  if (age !== null && age > maxAge) reasons.push({ id: "overage", label: `Overage (${age})` });
  if (getAgeFromDob(input.dob || "") !== null && getAgeFromDob(input.dobFromId || "") !== null && !dobsMatch(input.dob || "", input.dobFromId || "")) reasons.push({ id: "dob_mismatch", label: "DOB mismatch" });
  if (input.verified === "name_review") reasons.push({ id: "name_check", label: "Name check" });
  if (input.verified === "doc_review") reasons.push({ id: "document_check", label: "Document check" });
  return reasons;
}

const acceptedLabels: Record<CheckinReviewReason, string> = {
  underage: "Underage check OK",
  overage: "Overage check OK",
  dob_mismatch: "DOB check OK",
  name_check: "Name check OK",
  document_check: "Document check OK",
};

export function getCheckinReviewState(input: CheckinReviewInput) {
  const reasons = reviewReasons(input);
  return input.vibeMatched
    ? { unresolved: [] as CheckinReviewLabel[], accepted: reasons.map((reason) => ({ ...reason, label: acceptedLabels[reason.id] })) }
    : { unresolved: reasons, accepted: [] as CheckinReviewLabel[] };
}

export function checkinReviewReasons(input: CheckinReviewInput) {
  return getCheckinReviewState(input).unresolved;
}
