import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth";
import { actionAllowed } from "@/lib/actionPermissions";
import { isPiRuntime } from "@/lib/runtime";
import { getMediaBucket, putMediaObject } from "@/lib/mediaR2";
import { isSafeMediaKey, keyToMediaUrl } from "@/lib/mediaKeys";

const FOLDERS = new Set(["events", "community", "heroes", "menu", "quick-links"]);
const MAX_BYTES = 5 * 1024 * 1024;

export async function POST(req: NextRequest) {
  if (isPiRuntime()) {
    return NextResponse.json({ error: "Website media uploads are only available on the live site" }, { status: 403 });
  }

  try {
    const cl = Number(req.headers.get("content-length") || "0");
    if (cl > MAX_BYTES + 64_000) {
      return NextResponse.json({ error: "Image is too large (max 5MB)" }, { status: 400 });
    }

    const formData = await req.formData();
    const password = String(formData.get("password") || "");
    const username = String(formData.get("username") || "") || undefined;
    const folder = String(formData.get("folder") || "events");
    const file = formData.get("file");

    const auth = await authenticateUser(password, username);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const access = actionAllowed(auth.role, auth.permissions, folder === "menu" ? "canManageMenuItems" : "admin_only");
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
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Image is too large (max 5MB)" }, { status: 400 });
    }
    const allowedTypes = folder === "quick-links" ? new Set(["image/jpeg", "image/png", "image/webp"]) : new Set(["image/jpeg"]);
    if (!allowedTypes.has(file.type)) {
      return NextResponse.json({ error: folder === "quick-links" ? "Upload a JPEG, PNG, or WebP image" : "Upload a processed JPEG" }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    if (bytes.byteLength > MAX_BYTES) {
      return NextResponse.json({ error: "Image is too large (max 5MB)" }, { status: 400 });
    }
    const head = new Uint8Array(bytes, 0, Math.min(12, bytes.byteLength));
    const jpeg = head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    const png = head.length >= 8 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47 && head[4] === 0x0d && head[5] === 0x0a && head[6] === 0x1a && head[7] === 0x0a;
    const webp = head.length >= 12 && head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50;
    if (!jpeg && !(folder === "quick-links" && (png || webp))) {
      return NextResponse.json({ error: folder === "quick-links" ? "Upload a valid JPEG, PNG, or WebP image" : "Upload a processed JPEG" }, { status: 400 });
    }

    const day = new Date().toISOString().slice(0, 10);
    const key = `${folder}/${day}-${crypto.randomUUID()}.jpg`;
    if (!isSafeMediaKey(key)) {
      return NextResponse.json({ error: "Invalid media key" }, { status: 400 });
    }

    await putMediaObject(key, bytes, file.type);
    return NextResponse.json({ url: keyToMediaUrl(key) });
  } catch (error: unknown) {
    console.error("Website upload error:", error);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
