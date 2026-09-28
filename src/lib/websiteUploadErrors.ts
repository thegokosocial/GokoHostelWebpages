/** Map unknown throws to a short client-safe upload error string. Never returns empty. */
export function clientUploadError(error: unknown): string {
  let raw = "";
  if (error instanceof Error) raw = error.message;
  else if (typeof error === "string") raw = error;
  else if (error && typeof error === "object" && "message" in error) {
    raw = String((error as { message: unknown }).message ?? "");
  } else if (error != null) {
    raw = String(error);
  }
  const line = raw.trim().split(/\r?\n/)[0]?.trim() || "";
  if (!line || line === "[object Object]") return "UPLOAD_ERROR: unexpected upload failure";
  return line.length > 160 ? `${line.slice(0, 157)}...` : line;
}

export function uploadThrowResponse(error: unknown): { error: string; code: "UPLOAD_THROW" } {
  return { error: clientUploadError(error), code: "UPLOAD_THROW" };
}
