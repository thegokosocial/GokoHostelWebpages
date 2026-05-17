import { NextRequest, NextResponse } from "next/server";
import { validateIdDocument, validateIdFromText } from "@/lib/validateIdDocument";

async function extractPdfText(pdfBuffer: Buffer): Promise<string> {
  const pdfParse = (await import("pdf-parse") as any).default || (await import("pdf-parse"));
  const data = await pdfParse(pdfBuffer);
  return data.text || "";
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const category = (formData.get("category") as string) || "id";
    const idType = formData.get("idType") as string | null;
    const guestName = formData.get("guestName") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "File must be less than 10 MB" }, { status: 400 });
    }

    if (!file.type.startsWith("image/") && file.type !== "application/pdf") {
      return NextResponse.json({ error: "File must be an image or PDF" }, { status: 400 });
    }

    if (file.type === "application/pdf") {
      try {
        const pdfBuffer = Buffer.from(await file.arrayBuffer());
        const text = await extractPdfText(pdfBuffer);
        const result = validateIdFromText(
          text,
          category as "id" | "visa",
          idType as "aadhaar" | "driving_licence" | "passport" | undefined,
          guestName || undefined
        );
        return NextResponse.json(result);
      } catch (pdfErr: any) {
        console.error("PDF parse failed:", pdfErr?.message);
        return NextResponse.json({
          valid: true,
          documentType: "unknown",
          confidence: "low",
          message: "PDF accepted. Could not extract text — staff will verify manually.",
        });
      }
    }

    const imageBuffer = Buffer.from(await file.arrayBuffer());
    const result = await validateIdDocument(
      imageBuffer,
      category as "id" | "visa",
      idType as "aadhaar" | "driving_licence" | "passport" | undefined,
      guestName || undefined
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error("Validate ID error:", error);
    return NextResponse.json(
      { valid: true, documentType: "unknown", confidence: "low", message: "Validation service error, document accepted." },
      { status: 200 }
    );
  }
}
