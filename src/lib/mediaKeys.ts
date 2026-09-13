export const MEDIA_URL_PREFIX = "/api/media/";

const KEY_RE = /^[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)+$/;

export function isMediaUrl(url: string): boolean {
  return url.startsWith(MEDIA_URL_PREFIX);
}

export function mediaUrlToKey(url: string): string | null {
  if (!isMediaUrl(url)) return null;
  try {
    const key = decodeURIComponent(url.slice(MEDIA_URL_PREFIX.length));
    return isSafeMediaKey(key) ? key : null;
  } catch {
    return null;
  }
}

export function sanitizeSiteImageUrl(url: string): string {
  const s = String(url || "").trim();
  if (!s) return "";
  if (s.startsWith("/images/") || s.startsWith("/legacy-images/")) {
    let decoded = s;
    try {
      decoded = decodeURIComponent(s);
    } catch {
      return "";
    }
    if (
      decoded.includes("..") ||
      decoded.includes("\\") ||
      decoded.includes("%") ||
      !(decoded.startsWith("/images/") || decoded.startsWith("/legacy-images/"))
    ) {
      return "";
    }
    return s;
  }
  return mediaUrlToKey(s) ? s : "";
}

export function keyToMediaUrl(key: string): string {
  return `${MEDIA_URL_PREFIX}${key}`;
}

export function isSafeMediaKey(key: string): boolean {
  if (!key || key.length > 200) return false;
  if (key.includes("..") || key.startsWith("/") || key.includes("\\")) return false;
  return KEY_RE.test(key);
}

export function collectMediaKeys(urls: string[]): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const url of urls) {
    const key = mediaUrlToKey(url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

export function releasedMediaKeys(prev: string[], next: string[]): string[] {
  const keep = new Set(collectMediaKeys(next));
  return collectMediaKeys(prev).filter((key) => !keep.has(key));
}
