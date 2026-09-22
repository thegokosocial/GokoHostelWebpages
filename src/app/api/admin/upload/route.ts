import { NextRequest, NextResponse } from "next/server";
import { driveUploadFile, driveGetOrCreateFolder } from "@/lib/googleApiFetch";
import { getMonthKey, incrementStat, addSystemLog } from "@/db/queries";
import { isOfflineMode } from "@/lib/runtime";
import { authenticateUser } from "@/lib/auth";
import { actionAllowed } from "@/lib/actionPermissions";

export async function POST(req: NextRequest) {
  if (isOfflineMode()) {
    return NextResponse.json({ error: "File uploads require internet connection" }, { status: 503 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const name = formData.get("name") as string || "Guest";
    const type = formData.get("type") as string || "doc";
    const username = String(formData.get("username") || "") || undefined;
    const auth = await authenticateUser("", username);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const access = actionAllowed(auth.role, auth.permissions, ["canAddCheckin", "canEditRecords"]);
    if (access !== "allowed") return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });

    if (!file || file.size === 0) {
      return NextResponse.json({ error: "No file" }, { status: 400 });
    }
    if (file.size > 10 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(file.type)) {
      return NextResponse.json({ error: "Unsupported or oversized document" }, { status: 400 });
    }

    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

    const buffer = await file.arrayBuffer();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const ext = file.name.split(".").pop() || "jpg";
    const fileName = `${name.replace(/[^a-zA-Z]/g, "_")}_${type}_${timestamp}.${ext}`;

    let targetFolderId = folderId;
    if (folderId) {
      try {
        targetFolderId = await driveGetOrCreateFolder(folderId, getMonthKey());
      } catch {}
    }

    const link = await driveUploadFile(fileName, file.type || "image/jpeg", buffer, targetFolderId);
    incrementStat("drive", 1).catch(() => {});
    addSystemLog({ level: "info", source: "admin-upload", message: `File uploaded for ${name} (${type})` }).catch(() => {});

    return NextResponse.json({ link });
  } catch (error: any) {
    console.error("Admin upload error:", error?.message);
    addSystemLog({ level: "error", source: "admin-upload", message: error?.message || "Upload failed" }).catch(() => {});
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
