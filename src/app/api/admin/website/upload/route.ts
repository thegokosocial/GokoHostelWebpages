import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth";
import { actionAllowed } from "@/lib/actionPermissions";
import { isPiRuntime } from "@/lib/runtime";
import { getMediaBucket, putMediaObject } from "@/lib/mediaR2";
import { isSafeMediaKey, keyToMediaUrl } from "@/lib/mediaKeys";
import { uploadThrowResponse } from "@/lib/websiteUploadErrors";

const FOLDERS = new Set(["events", "community", "heroes", "rooms", "menu", "quick-links", "bills", "hero-videos"]);
const MULTI_IMAGE_FOLDERS = new Set(["quick-links", "bills"]);
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const VIDEO_MAX_BYTES = 15 * 1024 * 1024;

function folderPermission(folder: string) {
  if (folder === "menu") return "canManageMenuItems" as const;
  if (folder === "bills") return "canManageFoodSettings" as const;
  return "admin_only" as const;
}

/** Early buffer ceiling before magic-byte typing. Hero-videos allows MP4 up to 15MB; posters are re-checked at 5MB after JPEG magic. */
function maxBytesFor(folder: string) {
  return folder === "hero-videos" ? VIDEO_MAX_BYTES : IMAGE_MAX_BYTES;
}

function assertSameOrigin(req: NextRequest): NextResponse | null {
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }
  return null;
}

function isJpeg(head: Uint8Array) {
  return head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
}

function isPng(head: Uint8Array) {
  return head.length >= 8
    && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47
    && head[4] === 0x0d && head[5] === 0x0a && head[6] === 0x1a && head[7] === 0x0a;
}

function isWebp(head: Uint8Array) {
  return head.length >= 12
    && head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46
    && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50;
}

/** ISO BMFF / MP4: ftyp box near start */
function isMp4(head: Uint8Array) {
  if (head.length < 12) return false;
  return head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70;
}

type StoredKind = { contentType: string; ext: string };

function classifyHeroBytes(bytes: ArrayBuffer, declaredType: string): StoredKind | { error: string } {
  const head = new Uint8Array(bytes, 0, Math.min(12, bytes.byteLength));
  const jpeg = isJpeg(head);
  const mp4 = isMp4(head);
  if (mp4 || declaredType === "video/mp4") {
    if (!mp4) return { error: "Upload a valid MP4 video" };
    if (bytes.byteLength > VIDEO_MAX_BYTES) return { error: "Video is too large (max 15MB after encoding)" };
    return { contentType: "video/mp4", ext: "mp4" };
  }
  if (jpeg) {
    if (bytes.byteLength > IMAGE_MAX_BYTES) return { error: "Image is too large (max 5MB)" };
    return { contentType: "image/jpeg", ext: "jpg" };
  }
  return { error: "Upload a processed MP4 or JPEG poster" };
}

function classifyImageBytes(
  bytes: ArrayBuffer,
  declaredType: string,
  folder: string,
): StoredKind | { error: string } {
  const head = new Uint8Array(bytes, 0, Math.min(12, bytes.byteLength));
  const jpeg = isJpeg(head);
  const png = isPng(head);
  const webp = isWebp(head);
  const multi = MULTI_IMAGE_FOLDERS.has(folder);
  const allowedTypes = multi ? new Set(["image/jpeg", "image/png", "image/webp"]) : new Set(["image/jpeg"]);
  if (!allowedTypes.has(declaredType) && !(jpeg || (multi && (png || webp)))) {
    return { error: multi ? "Upload a JPEG, PNG, or WebP image" : "Upload a processed JPEG" };
  }
  if (!jpeg && !(multi && (png || webp))) {
    return { error: multi ? "Upload a valid JPEG, PNG, or WebP image" : "Upload a processed JPEG" };
  }
  const ext = jpeg ? "jpg" : png ? "png" : "webp";
  const contentType = jpeg ? "image/jpeg" : png ? "image/png" : "image/webp";
  return { contentType, ext };
}

async function authorizeUpload(password: string, username: string | undefined, folder: string) {
  const auth = await authenticateUser(password, username);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = actionAllowed(auth.role, auth.permissions, folderPermission(folder));
  if (access !== "allowed") {
    return NextResponse.json({
      error: access === "admin_required" ? "Admin access required" : "Insufficient permissions",
    }, { status: 403 });
  }
  if (!getMediaBucket()) {
    return NextResponse.json({ error: "R2 bucket not bound. Create goko-media and bind MEDIA." }, { status: 503 });
  }
  if (!FOLDERS.has(folder)) {
    return NextResponse.json({ error: "Invalid folder" }, { status: 400 });
  }
  return null;
}

async function storeBytes(folder: string, bytes: ArrayBuffer, kind: StoredKind) {
  const day = new Date().toISOString().slice(0, 10);
  const key = `${folder}/${day}-${crypto.randomUUID()}.${kind.ext}`;
  if (!isSafeMediaKey(key)) {
    return NextResponse.json({ error: "Invalid media key" }, { status: 400 });
  }
  // Uint8Array avoids rare R2 put issues with detached/exotic ArrayBuffers from FormData.
  await putMediaObject(key, new Uint8Array(bytes), kind.contentType);
  return NextResponse.json({ url: keyToMediaUrl(key) });
}

/**
 * Raw binary upload for hero videos (avoids multipart FormData buffering on Workers).
 * Headers: Content-Type, X-Goko-Password, optional X-Goko-Username
 * Query: folder=hero-videos
 */
async function handleRawUpload(req: NextRequest) {
  const folder = String(req.nextUrl.searchParams.get("folder") || "");
  if (folder !== "hero-videos") {
    return NextResponse.json({ error: "Raw upload is only supported for hero-videos" }, { status: 400 });
  }
  const password = String(req.headers.get("x-goko-password") || "");
  const username = String(req.headers.get("x-goko-username") || "") || undefined;
  const denied = await authorizeUpload(password, username, folder);
  if (denied) return denied;

  const declaredType = (req.headers.get("content-type") || "application/octet-stream").split(";")[0].trim();
  const cl = Number(req.headers.get("content-length") || "0");
  const maxBytes = maxBytesFor(folder);
  if (cl > maxBytes) {
    return NextResponse.json({ error: "Video is too large (max 15MB after encoding)" }, { status: 400 });
  }

  const bytes = await req.arrayBuffer();
  if (bytes.byteLength === 0) {
    return NextResponse.json({ error: "No file" }, { status: 400 });
  }
  if (bytes.byteLength > maxBytes) {
    return NextResponse.json({ error: "Video is too large (max 15MB after encoding)" }, { status: 400 });
  }

  const kind = classifyHeroBytes(bytes, declaredType);
  if ("error" in kind) return NextResponse.json({ error: kind.error }, { status: 400 });
  return storeBytes(folder, bytes, kind);
}

async function handleMultipartUpload(req: NextRequest) {
  const cl = Number(req.headers.get("content-length") || "0");
  if (cl > VIDEO_MAX_BYTES + 64_000) {
    return NextResponse.json({ error: "File is too large" }, { status: 400 });
  }

  const formData = await req.formData();
  const password = String(formData.get("password") || "");
  const username = String(formData.get("username") || "") || undefined;
  const folder = String(formData.get("folder") || "events");
  const file = formData.get("file");

  const denied = await authorizeUpload(password, username, folder);
  if (denied) return denied;

  if (!(file instanceof Blob) || file.size === 0) {
    return NextResponse.json({ error: "No file" }, { status: 400 });
  }

  const declaredType = file.type || "application/octet-stream";
  const maxBytes = maxBytesFor(folder);
  if (file.size > maxBytes) {
    return NextResponse.json({
      error: folder === "hero-videos"
        ? "Video is too large (max 15MB after encoding)"
        : "Image is too large (max 5MB)",
    }, { status: 400 });
  }

  const bytes = await file.arrayBuffer();
  if (bytes.byteLength > maxBytes) {
    return NextResponse.json({ error: "File is too large" }, { status: 400 });
  }

  const kind = folder === "hero-videos"
    ? classifyHeroBytes(bytes, declaredType)
    : classifyImageBytes(bytes, declaredType, folder);
  if ("error" in kind) return NextResponse.json({ error: kind.error }, { status: 400 });
  return storeBytes(folder, bytes, kind);
}

export async function POST(req: NextRequest) {
  if (isPiRuntime()) {
    return NextResponse.json({ error: "Website media uploads are only available on the live site" }, { status: 403 });
  }

  const originDenied = assertSameOrigin(req);
  if (originDenied) return originDenied;

  try {
    const ct = (req.headers.get("content-type") || "").toLowerCase();
    if (ct.startsWith("multipart/form-data")) {
      return await handleMultipartUpload(req);
    }
    // video/mp4, image/jpeg, application/octet-stream — hero raw path
    return await handleRawUpload(req);
  } catch (error: unknown) {
    console.error("Website upload error:", error);
    return NextResponse.json(uploadThrowResponse(error), { status: 500 });
  }
}
