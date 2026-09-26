import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth";
import { actionAllowed } from "@/lib/actionPermissions";
import { isPiRuntime } from "@/lib/runtime";
import { getMediaBucket, putMediaObject } from "@/lib/mediaR2";
import { isSafeMediaKey, keyToMediaUrl } from "@/lib/mediaKeys";

const FOLDERS = new Set(["events", "community", "heroes", "rooms", "menu", "quick-links", "bills", "hero-videos"]);
const MULTI_IMAGE_FOLDERS = new Set(["quick-links", "bills"]);
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const VIDEO_MAX_BYTES = 15 * 1024 * 1024;

function folderPermission(folder: string) {
  if (folder === "menu") return "canManageMenuItems" as const;
  if (folder === "bills") return "canManageFoodSettings" as const;
  return "admin_only" as const;
}

function maxBytesFor(folder: string, contentType: string) {
  if (folder === "hero-videos" && contentType === "video/mp4") return VIDEO_MAX_BYTES;
  return IMAGE_MAX_BYTES;
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
  // bytes 4-7 are 'ftyp'
  return head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70;
}

export async function POST(req: NextRequest) {
  if (isPiRuntime()) {
    return NextResponse.json({ error: "Website media uploads are only available on the live site" }, { status: 403 });
  }

  try {
    const cl = Number(req.headers.get("content-length") || "0");
    if (cl > VIDEO_MAX_BYTES + 64_000) {
      return NextResponse.json({ error: "File is too large" }, { status: 400 });
    }

    const formData = await req.formData();
    const password = String(formData.get("password") || "");
    const username = String(formData.get("username") || "") || undefined;
    const folder = String(formData.get("folder") || "events");
    const file = formData.get("file");

    const auth = await authenticateUser(password, username);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const access = actionAllowed(auth.role, auth.permissions, folderPermission(folder));
    if (access !== "allowed") {
      return NextResponse.json({ error: access === "admin_required" ? "Admin access required" : "Insufficient permissions" }, { status: 403 });
    }

    if (!getMediaBucket()) {
      return NextResponse.json({ error: "R2 bucket not bound. Create goko-media and bind MEDIA." }, { status: 503 });
    }

    if (!FOLDERS.has(folder)) {
      return NextResponse.json({ error: "Invalid folder" }, { status: 400 });
    }
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "No file" }, { status: 400 });
    }

    const declaredType = file.type || "application/octet-stream";
    const maxBytes = maxBytesFor(folder, declaredType === "video/mp4" || folder === "hero-videos" ? (declaredType.includes("video") ? "video/mp4" : declaredType) : declaredType);

    if (file.size > maxBytes) {
      return NextResponse.json({
        error: folder === "hero-videos" && declaredType.startsWith("video/")
          ? "Video is too large (max 15MB after encoding)"
          : "Image is too large (max 5MB)",
      }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    if (bytes.byteLength > maxBytes) {
      return NextResponse.json({ error: "File is too large" }, { status: 400 });
    }
    const head = new Uint8Array(bytes, 0, Math.min(12, bytes.byteLength));
    const jpeg = isJpeg(head);
    const png = isPng(head);
    const webp = isWebp(head);
    const mp4 = isMp4(head);

    let contentType = "";
    let ext = "";

    if (folder === "hero-videos") {
      if (mp4 || declaredType === "video/mp4") {
        if (!mp4) return NextResponse.json({ error: "Upload a valid MP4 video" }, { status: 400 });
        contentType = "video/mp4";
        ext = "mp4";
      } else if (jpeg) {
        contentType = "image/jpeg";
        ext = "jpg";
      } else {
        return NextResponse.json({ error: "Upload a processed MP4 or JPEG poster" }, { status: 400 });
      }
      if (contentType === "video/mp4" && bytes.byteLength > VIDEO_MAX_BYTES) {
        return NextResponse.json({ error: "Video is too large (max 15MB after encoding)" }, { status: 400 });
      }
      if (contentType === "image/jpeg" && bytes.byteLength > IMAGE_MAX_BYTES) {
        return NextResponse.json({ error: "Image is too large (max 5MB)" }, { status: 400 });
      }
    } else {
      const multi = MULTI_IMAGE_FOLDERS.has(folder);
      const allowedTypes = multi ? new Set(["image/jpeg", "image/png", "image/webp"]) : new Set(["image/jpeg"]);
      if (!allowedTypes.has(declaredType) && !(jpeg || (multi && (png || webp)))) {
        return NextResponse.json({ error: multi ? "Upload a JPEG, PNG, or WebP image" : "Upload a processed JPEG" }, { status: 400 });
      }
      if (!jpeg && !(multi && (png || webp))) {
        return NextResponse.json({ error: multi ? "Upload a valid JPEG, PNG, or WebP image" : "Upload a processed JPEG" }, { status: 400 });
      }
      ext = jpeg ? "jpg" : png ? "png" : "webp";
      contentType = jpeg ? "image/jpeg" : png ? "image/png" : "image/webp";
    }

    const day = new Date().toISOString().slice(0, 10);
    const key = `${folder}/${day}-${crypto.randomUUID()}.${ext}`;
    if (!isSafeMediaKey(key)) {
      return NextResponse.json({ error: "Invalid media key" }, { status: 400 });
    }

    await putMediaObject(key, bytes, contentType);
    return NextResponse.json({ url: keyToMediaUrl(key) });
  } catch (error: unknown) {
    console.error("Website upload error:", error);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
