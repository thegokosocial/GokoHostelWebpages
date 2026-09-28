import { getCloudflareContext } from "@opennextjs/cloudflare";
import { isPiRuntime } from "./runtime";
import { isSafeMediaKey } from "./mediaKeys";

type R2Bucket = {
  put: (key: string, value: ArrayBuffer | Uint8Array, options?: { httpMetadata?: { contentType?: string } }) => Promise<unknown>;
  get: (
    key: string,
  ) => Promise<{
    body: ReadableStream | null;
    httpMetadata?: { contentType?: string };
    size?: number;
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

export async function putMediaObject(key: string, bytes: ArrayBuffer | Uint8Array, contentType: string) {
  if (!isSafeMediaKey(key)) throw new Error("Invalid media key");
  const bucket = getMediaBucket();
  if (!bucket) throw new Error("R2 bucket not bound");
  await bucket.put(key, bytes, { httpMetadata: { contentType } });
}

/** Full-object get only. Range/206 is synthesized in the media route (R2 ranged get 404s here). */
export async function getMediaObject(key: string) {
  if (!isSafeMediaKey(key)) return null;
  const bucket = getMediaBucket();
  if (!bucket) return null;
  return bucket.get(key);
}

export async function deleteMediaKeys(keys: string[]) {
  const bucket = getMediaBucket();
  if (!bucket) return;
  const safe = keys.filter(isSafeMediaKey);
  if (safe.length === 0) return;
  await bucket.delete(safe.length === 1 ? safe[0] : safe);
}
