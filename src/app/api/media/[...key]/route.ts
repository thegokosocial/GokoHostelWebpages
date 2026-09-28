import { NextRequest, NextResponse } from "next/server";
import { getMediaObject } from "@/lib/mediaR2";
import { isSafeMediaKey } from "@/lib/mediaKeys";

/** Hero encodes and CMS stills stay under this; buffer + synthesize 206 (R2 native range 404s in prod). */
const SYNTH_RANGE_MAX = 15 * 1024 * 1024;

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

  // Always full get — R2 ranged get after a probe get returns empty body → 404 in production.
  const object = await getMediaObject(key);
  if (!object?.body) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const contentType = object.httpMetadata?.contentType || "application/octet-stream";
  const knownSize = typeof object.size === "number" ? object.size : undefined;
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": "bytes",
  };

  const rangeHeader = req.headers.get("range");
  if (rangeHeader) {
    const shouldBuffer = knownSize == null || knownSize <= SYNTH_RANGE_MAX;
    if (shouldBuffer) {
      const buf = await new Response(object.body as BodyInit).arrayBuffer();
      const size = buf.byteLength;
      const parsed = parseRange(rangeHeader, size);
      if (parsed) {
        const slice = buf.slice(parsed.start, parsed.end + 1);
        headers["Content-Range"] = `bytes ${parsed.start}-${parsed.end}/${size}`;
        headers["Content-Length"] = String(slice.byteLength);
        return new NextResponse(slice, { status: 206, headers });
      }
      headers["Content-Length"] = String(size);
      return new NextResponse(buf, { status: 200, headers });
    }
    // Large object: ignore Range, stream full body (browsers accept 200)
    headers["Content-Length"] = String(knownSize);
    return new NextResponse(object.body as BodyInit, { status: 200, headers });
  }

  if (knownSize != null) headers["Content-Length"] = String(knownSize);
  return new NextResponse(object.body as BodyInit, { status: 200, headers });
}
