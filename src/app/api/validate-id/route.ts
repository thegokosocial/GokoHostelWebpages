import { NextRequest, NextResponse } from "next/server";
import { validateIdDocument } from "@/lib/validateIdDocument";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const category = (formData.get("category") as string) || "id";

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "File must be less than 10 MB" }, { status: 400 });
    }

    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ error: "File must be an image" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await validateIdDocument(buffer, category as "id" | "visa");

    return NextResponse.json(result);
  } catch (error) {
    console.error("Validate ID error:", error);
    return NextResponse.json(
      { valid: true, documentType: "unknown", confidence: "low", message: "Validation service error, document accepted." },
      { status: 200 }
    );
  }
}
