/** Guest self-check-in file helpers (MIME/extension + both-sides copy). */

const IMAGE_EXT = /\.(jpe?g|png|webp|heic|heif)$/i;
const PDF_EXT = /\.pdf$/i;

export function isAcceptedIdFile(file: File): { ok: true; kind: "image" | "pdf" } | { ok: false; reason: string } {
  if (file.size > 10 * 1024 * 1024) {
    return { ok: false, reason: `File "${file.name}" exceeds 10 MB limit. Please use a smaller file.` };
  }
  const mime = (file.type || "").toLowerCase();
  if (mime === "application/pdf" || (!mime && PDF_EXT.test(file.name))) {
    return { ok: true, kind: "pdf" };
  }
  if (mime.startsWith("image/") || (!mime && IMAGE_EXT.test(file.name)) || mime === "application/octet-stream" && IMAGE_EXT.test(file.name)) {
    return { ok: true, kind: "image" };
  }
  if (mime === "application/octet-stream" && PDF_EXT.test(file.name)) {
    return { ok: true, kind: "pdf" };
  }
  return { ok: false, reason: `Unsupported file "${file.name}". Use JPEG, PNG, WebP, HEIC, or PDF.` };
}

export function isHeicFile(file: File): boolean {
  const mime = (file.type || "").toLowerCase();
  return mime.includes("heic") || mime.includes("heif") || /\.heic$/i.test(file.name) || /\.heif$/i.test(file.name);
}

export function bothSidesHelpText(idType: string | undefined, nationality: string | undefined): string {
  if (idType === "aadhaar") {
    return "One clear photo or DigiLocker PDF with name and address is enough. If address is on the other side, we will ask for it after Verify. JPEG, PNG, WebP, PDF. Max 10 MB.";
  }
  if (idType === "passport" && nationality && nationality.toLowerCase() !== "india") {
    return "Upload the passport bio page. JPEG, PNG, WebP, PDF. Max 10 MB.";
  }
  if (idType === "passport") {
    return "One photo or PDF with the bio page (and address if shown) is enough. If address is missing, we will ask for the address page after Verify. JPEG, PNG, WebP, PDF. Max 10 MB.";
  }
  if (idType === "driving_licence") {
    return "Upload a clear photo of your driving licence. JPEG, PNG, WebP, PDF. Max 10 MB.";
  }
  return "JPEG, PNG, WebP, PDF. Max 10 MB per file.";
}

/** Rewrite `url | url` Drive join after removing one preview. Empty string = cleared. */
export function removeLinkFromJoined(joined: string, index: number): string {
  const parts = joined.split(" | ").map((s) => s.trim()).filter(Boolean);
  if (index < 0 || index >= parts.length) return joined;
  parts.splice(index, 1);
  return parts.join(" | ");
}
