import { getCloudflareContext } from "@opennextjs/cloudflare";
import { isPiRuntime } from "./runtime";
import { isSafeMediaKey } from "./mediaKeys";

type R2Range = { offset: number; length: number };

type R2Bucket = {
  put: (key: string, value: ArrayBuffer | Uint8Array, options?: { httpMetadata?: { contentType?: string } }) => Promise<unknown>;
  get: (
    key: string,
    options?: { range?: { offset: number; length: number } | { suffix: number } },
  ) => Promise<{
    body: ReadableStream | null;
    httpMetadata?: { contentType?: string };
    size?: number;
    range?: R2Range;
  } | null>;
  delete: (key: string | string[]) => Promise<unknown>;
};

export function getMediaBucket(): R2Bucket | null {
  if (isPiRuntime()) return null;
  try {
    const { env } = getCloudflareContext();
    return ((env as { MEDIA?: R2Bucket }).MEDIA) ?? null;
  } catch {
    return null;
  }
}

export async function putMediaObject(key: string, bytes: ArrayBuffer, contentType: string) {
  if (!isSafeMediaKey(key)) throw new Error("Invalid media key");
  const bucket = getMediaBucket();
  if (!bucket) throw new Error("R2 bucket not bound");
  await bucket.put(key, bytes, { httpMetadata: { contentType } });
}

function parseBytesRange(header: string, size: number): { offset: number; length: number } | { suffix: number } | null {
  if (!header.startsWith("bytes=") || size <= 0) return null;
  const spec = header.slice(6).split(",")[0]?.trim();
  if (!spec) return null;
  const [startRaw, endRaw] = spec.split("-");
  if (startRaw === "" && endRaw) {
    const suffix = Number(endRaw);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    return { suffix: Math.min(Math.floor(suffix), size) };
  }
  const start = Number(startRaw);
  if (!Number.isFinite(start) || start < 0 || start >= size) return null;
  const end = endRaw === "" || endRaw === undefined ? size - 1 : Number(endRaw);
  if (!Number.isFinite(end) || end < start) return null;
  const cappedEnd = Math.min(Math.floor(end), size - 1);
  return { offset: Math.floor(start), length: cappedEnd - Math.floor(start) + 1 };
}

export async function getMediaObject(key: string, rangeHeader?: string | null) {
  if (!isSafeMediaKey(key)) return null;
  const bucket = getMediaBucket();
  if (!bucket) return null;

  // First GET for size when ranging (R2 needs size for suffix/validation)
  if (rangeHeader) {
    const head = await bucket.get(key);
    if (!head) return null;
    const size = typeof head.size === "number" ? head.size : undefined;
    if (size == null) return head;
    const range = parseBytesRange(rangeHeader, size);
    if (!range) return head;
    const ranged = await bucket.get(key, { range });
    if (!ranged) return head;
    return { ...ranged, size };
  }

  return bucket.get(key);
}

export async function deleteMediaKeys(keys: string[]) {
  const bucket = getMediaBucket();
  if (!bucket) return;
  const safe = keys.filter(isSafeMediaKey);
  if (safe.length === 0) return;
  await bucket.delete(safe.length === 1 ? safe[0] : safe);
}
