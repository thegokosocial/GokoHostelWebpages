import { NextRequest, NextResponse } from "next/server";
import { driveUploadFile, driveGetOrCreateFolder, getMonthTabName } from "@/lib/googleApiFetch";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const name = formData.get("name") as string || "Guest";
    const type = formData.get("type") as string || "doc";
    const password = formData.get("password") as string;

    const adminPw = process.env.ADMIN_PASSWORD;
    const managerPw = process.env.MANAGER_PASSWORD;
    if (!password || (password !== adminPw && password !== managerPw)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!file || file.size === 0) {
      return NextResponse.json({ error: "No file" }, { status: 400 });
    }

    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

    const buffer = await file.arrayBuffer();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const ext = file.name.split(".").pop() || "jpg";
    const fileName = `${name.replace(/[^a-zA-Z]/g, "_")}_${type}_${timestamp}.${ext}`;

    let targetFolderId = folderId;
    if (folderId) {
      try {
        targetFolderId = await driveGetOrCreateFolder(folderId, getMonthTabName());
      } catch {}
    }

    const link = await driveUploadFile(fileName, file.type || "image/jpeg", buffer, targetFolderId);

    return NextResponse.json({ link });
  } catch (error: any) {
    console.error("Admin upload error:", error?.message);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
