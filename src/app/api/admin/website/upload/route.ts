import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth";
import { actionAllowed } from "@/lib/actionPermissions";
import { isPiRuntime } from "@/lib/runtime";
import { getMediaBucket, putMediaObject } from "@/lib/mediaR2";
import { isSafeMediaKey, keyToMediaUrl } from "@/lib/mediaKeys";

const FOLDERS = new Set(["events", "community", "heroes", "menu"]);
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
    if (file.type !== "image/jpeg") {
      return NextResponse.json({ error: "Upload a processed JPEG" }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    if (bytes.byteLength > MAX_BYTES) {
      return NextResponse.json({ error: "Image is too large (max 5MB)" }, { status: 400 });
    }
    const head = new Uint8Array(bytes, 0, Math.min(3, bytes.byteLength));
    if (head.length < 3 || head[0] !== 0xff || head[1] !== 0xd8 || head[2] !== 0xff) {
      return NextResponse.json({ error: "Upload a processed JPEG" }, { status: 400 });
    }

    const day = new Date().toISOString().slice(0, 10);
    const key = `${folder}/${day}-${crypto.randomUUID()}.jpg`;
    if (!isSafeMediaKey(key)) {
      return NextResponse.json({ error: "Invalid media key" }, { status: 400 });
    }

    await putMediaObject(key, bytes, "image/jpeg");
    return NextResponse.json({ url: keyToMediaUrl(key) });
  } catch (error: unknown) {
    console.error("Website upload error:", error);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
