/** Validate a client create-idempotency UUID. Returns the trimmed key or an error message. */
export function parseCreateIdempotencyKey(raw: unknown): { key: string } | { error: string } {
  if (typeof raw !== "string" || !raw.trim()) {
    return { error: "idempotencyKey required" };
  }
  const key = raw.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) {
    return { error: "idempotencyKey must be a UUID" };
  }
  return { key };
}

export function isUniqueConstraintError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /unique/i.test(msg);
}
