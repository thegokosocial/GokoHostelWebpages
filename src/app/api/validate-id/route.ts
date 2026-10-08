import { NextRequest, NextResponse } from "next/server";
import { validateIdDocument, validateMultipleFiles } from "@/lib/validateIdDocument";
import { incrementStat, addSystemLog } from "@/db/queries";
import { isOfflineMode } from "@/lib/runtime";
import { isPasswordProtectedPdf } from "@/lib/pdfSecurity";
import { digestFiles, issueCheckinValidationAttestation } from "@/lib/checkinValidationAttestation";
import { assertGuestOrigin, guestBookingRateLimit } from "@/lib/guestBookingRateLimit";

export async function POST(req: NextRequest) {
  try { assertGuestOrigin(req); } catch { return NextResponse.json({ error: "Invalid request origin" }, { status: 403 }); }
  const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "unknown";
  if (!guestBookingRateLimit(`validate-id:${ip}`, 12, 10 * 60_000)) {
    return NextResponse.json({ error: "Too many document checks. Please wait a few minutes and try again." }, { status: 429 });
  }
  if (isOfflineMode()) {
    return NextResponse.json({ valid: false, unavailable: true, offline: true, message: "ID validation unavailable offline" }, { status: 503 });
  }

  try {
    const formData = await req.formData();
    const files = formData.getAll("file") as File[];
    const category = (formData.get("category") as string) || "id";
    const idType = formData.get("idType") as string | null;
    const guestName = formData.get("guestName") as string | null;
    const nationality = formData.get("nationality") as string | null;

    if (files.length === 0) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    for (const file of files) {
      if (file.size > 10 * 1024 * 1024) {
        return NextResponse.json({ error: `File "${file.name}" exceeds 10 MB` }, { status: 400 });
      }
      if (!file.type.startsWith("image/") && file.type !== "application/pdf") {
        return NextResponse.json({ error: "File must be an image or PDF" }, { status: 400 });
      }
      if (file.type === "application/pdf" && isPasswordProtectedPdf(await file.arrayBuffer())) {
        return NextResponse.json({ error: `File "${file.name}" is password-protected. Upload an unlocked PDF or a photo instead.` }, { status: 422 });
      }
    }

    if (files.length === 1) {
      const fileBuffer = Buffer.from(await files[0].arrayBuffer());
      const result = await validateIdDocument(
        fileBuffer,
        category as "id" | "visa",
        idType as any,
        guestName || undefined,
        files[0].type,
        nationality,
      );
      incrementStat("vision", 1).catch(() => {});
      if (result.unavailable) return NextResponse.json(result, { status: 503 });
      if (result.valid) {
        const attestation = await issueCheckinValidationAttestation({
          category: category as "id" | "visa", fileDigests: await digestFiles(files), idType: idType || "", guestName: guestName || "", nationality: nationality || "",
        });
        return NextResponse.json({ ...result, attestation });
      }
      return NextResponse.json(result);
    }

    const buffers = await Promise.all(files.map(async (f) => ({
      buffer: Buffer.from(await f.arrayBuffer()),
      mimeType: f.type,
    })));
    const result = await validateMultipleFiles(
      buffers,
      category as "id" | "visa",
      idType as any,
      guestName || undefined,
      nationality,
    );
    incrementStat("vision", files.length).catch(() => {});
    if (result.unavailable) return NextResponse.json(result, { status: 503 });
    if (result.valid) {
      const attestation = await issueCheckinValidationAttestation({
        category: category as "id" | "visa", fileDigests: await digestFiles(files), idType: idType || "", guestName: guestName || "", nationality: nationality || "",
      });
      return NextResponse.json({ ...result, attestation });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error("Validate ID error:", error);
    addSystemLog({ level: "error", source: "validate-id", message: String(error) }).catch(() => {});
    return NextResponse.json(
      { valid: false, documentType: "unknown", confidence: "low", message: "Validation service temporarily unavailable. Please try again." },
      { status: 503 }
    );
  }
}
