import { NextRequest, NextResponse } from "next/server";
import { getMediaObject } from "@/lib/mediaR2";
import { isSafeMediaKey } from "@/lib/mediaKeys";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ key: string[] }> }) {
  const { key: parts } = await params;
  const key = parts.join("/");
  if (!isSafeMediaKey(key)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const object = await getMediaObject(key);
  if (!object?.body) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse(object.body as BodyInit, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType || "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
