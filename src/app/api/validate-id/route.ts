import { NextRequest, NextResponse } from "next/server";
import { validateIdDocument } from "@/lib/validateIdDocument";

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

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const result = await validateIdDocument(
      fileBuffer,
      category as "id" | "visa",
      idType as any,
      guestName || undefined,
      file.type
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
