import { NextRequest, NextResponse } from "next/server";
import { validateIdDocument, validateMultipleFiles } from "@/lib/validateIdDocument";
import { incrementStat } from "@/db/queries";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const files = formData.getAll("file") as File[];
    const category = (formData.get("category") as string) || "id";
    const idType = formData.get("idType") as string | null;
    const guestName = formData.get("guestName") as string | null;

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
    }

    if (files.length === 1) {
      const fileBuffer = Buffer.from(await files[0].arrayBuffer());
      const result = await validateIdDocument(fileBuffer, category as "id" | "visa", idType as any, guestName || undefined, files[0].type);
      incrementStat("vision", 1).catch(() => {});
      return NextResponse.json(result);
    }

    const buffers = await Promise.all(files.map(async (f) => ({
      buffer: Buffer.from(await f.arrayBuffer()),
      mimeType: f.type,
    })));
    const result = await validateMultipleFiles(buffers, category as "id" | "visa", idType as any, guestName || undefined);
    incrementStat("vision", files.length).catch(() => {});
    return NextResponse.json(result);
  } catch (error) {
    console.error("Validate ID error:", error);
    return NextResponse.json(
      { valid: false, documentType: "unknown", confidence: "low", message: "Validation service temporarily unavailable. Please try again." },
      { status: 503 }
    );
  }
}
