import { NextRequest, NextResponse } from "next/server";
import { getMediaObject } from "@/lib/mediaR2";
import { isSafeMediaKey } from "@/lib/mediaKeys";

function parseRange(header: string | null, size: number): { start: number; end: number } | null {
  if (!header || !header.startsWith("bytes=") || size <= 0) return null;
  const spec = header.slice(6).split(",")[0]?.trim();
  if (!spec) return null;
  const [startRaw, endRaw] = spec.split("-");
  let start = startRaw === "" ? NaN : Number(startRaw);
  let end = endRaw === "" || endRaw === undefined ? NaN : Number(endRaw);
  if (Number.isNaN(start) && !Number.isNaN(end)) {
    // suffix: bytes=-500
    start = Math.max(0, size - end);
    end = size - 1;
  } else if (!Number.isNaN(start) && Number.isNaN(end)) {
    end = size - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= size) {
    return null;
  }
  end = Math.min(end, size - 1);
  return { start, end };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ key: string[] }> }) {
  const { key: parts } = await params;
  const key = parts.join("/");
  if (!isSafeMediaKey(key)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const rangeHeader = req.headers.get("range");
  const wantRange = Boolean(rangeHeader);
  const object = await getMediaObject(key, wantRange ? rangeHeader : null);
  if (!object?.body) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const contentType = object.httpMetadata?.contentType || "application/octet-stream";
  const size = typeof object.size === "number" ? object.size : undefined;
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": "bytes",
  };

  if (wantRange && size != null && object.range) {
    const { offset, length } = object.range;
    const end = offset + length - 1;
    headers["Content-Range"] = `bytes ${offset}-${end}/${size}`;
    headers["Content-Length"] = String(length);
    return new NextResponse(object.body as BodyInit, { status: 206, headers });
  }

  // Fallback: if R2 returned full body but client asked for Range, synthesize 206 when possible
  if (wantRange && size != null) {
    const parsed = parseRange(rangeHeader, size);
    if (parsed && object.body) {
      // Without native range from R2, stream full body with 200 (avoid buffering large files)
      if (size) headers["Content-Length"] = String(size);
      return new NextResponse(object.body as BodyInit, { status: 200, headers });
    }
  }

  if (size != null) headers["Content-Length"] = String(size);
  return new NextResponse(object.body as BodyInit, { status: 200, headers });
}
