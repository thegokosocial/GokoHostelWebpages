/** Build the raw-body hero upload fetch init (not multipart FormData). */
export function buildHeroUploadRequest(
  blob: Blob,
  filename: string,
  auth: { password: string; username?: string },
): { url: string; init: RequestInit } {
  const type = blob.type || (filename.endsWith(".mp4") ? "video/mp4" : "image/jpeg");
  const headers: Record<string, string> = {
    "Content-Type": type,
    "X-Goko-Password": auth.password,
  };
  if (auth.username) headers["X-Goko-Username"] = auth.username;
  return {
    url: "/api/admin/website/upload?folder=hero-videos",
    init: { method: "POST", headers, body: blob },
  };
}

export function formatHeroUploadPhaseError(
  phase: "encode" | "upload-video" | "upload-poster" | "save",
  err: unknown,
  status?: number,
): string {
  const msg = err instanceof Error ? err.message : String(err || "Upload failed");
  const statusBit = status != null && !msg.includes(`(${status})`) ? ` (${status})` : "";
  return `${phase}: ${msg}${statusBit}`;
}
