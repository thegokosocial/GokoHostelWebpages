import { isForeignNationality } from "@/lib/checkinSchema";

/** Client-safe: Aadhaar and Indian passport need front + address/back images. */
export function requiresBothIdSides(documentType: string, nationality?: string | null): boolean {
  if (documentType === "aadhaar") return true;
  if (documentType === "passport" && !isForeignNationality(nationality || "India")) return true;
  return false;
}
