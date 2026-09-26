/** Map a failed self-check-in HTTP response to guest-facing copy. */
export function messageFromCheckinFailure(
  status: number,
  body: { error?: unknown } | null | undefined,
  rawText?: string,
): string {
  const fromApi = typeof body?.error === "string" && body.error.trim() ? body.error.trim() : "";
  if (fromApi) return fromApi;
  if (status === 429) return "Too many submissions. Please try again later.";
  if (status === 413) return "Submission is too large. Please use smaller photos.";
  if (status === 403) return "Invalid request. Please refresh and try again.";
  if (status === 422) return "Document validation failed. Please upload a valid document.";
  if (rawText && rawText.trim() && !rawText.trim().startsWith("<")) {
    const snippet = rawText.trim().slice(0, 160);
    return `Check-in failed (${status}): ${snippet}`;
  }
  if (status >= 500) return `Server error (${status}). Please try again or contact the front desk.`;
  return "Something went wrong. Please try again or contact the front desk.";
}

export function messageFromCheckinCatch(err: unknown): string {
  if (err instanceof Error && err.message && !/submission failed/i.test(err.message)) {
    return err.message.slice(0, 200);
  }
  return "Something went wrong. Please try again or contact the front desk.";
}

/** Soft-accept ID results that should unlock submit but warn the guest. */
export function isStaffReviewValidation(result: {
  valid?: boolean;
  needsDocReview?: boolean;
  nameMatchQuality?: string;
  layers?: string[];
}): boolean {
  if (!result?.valid) return false;
  const layers = result.layers || [];
  // Hard side failures are never soft unlocks (valid:false). Soft path only.
  return !!(
    result.needsDocReview
    || result.nameMatchQuality === "partial"
    || result.nameMatchQuality === "none"
    || layers.includes("name_partial")
    || layers.includes("name_mismatch")
    || layers.includes("doc_review")
    || layers.includes("unreadable")
    || layers.includes("visa_unidentified")
    || layers.includes("validation_unavailable")
  );
}
