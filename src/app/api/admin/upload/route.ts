import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";

function getMonthFolderName(): string {
  const d = new Date();
  const months = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
    "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
  return `${months[d.getMonth()]}-${d.getFullYear()}`;
}

async function getOrCreateMonthFolder(drive: any, parentFolderId: string): Promise<string> {
  const folderName = getMonthFolderName();
  const search = await drive.files.list({
    q: `name='${folderName}' and '${parentFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id)",
  });
  if (search.data.files?.length > 0) return search.data.files[0].id;
  const created = await drive.files.create({
    requestBody: { name: folderName, mimeType: "application/vnd.google-apps.folder", parents: [parentFolderId] },
    fields: "id",
  });
  return created.data.id;
}

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

    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

    if (!clientId || !clientSecret || !refreshToken) {
      return NextResponse.json({ error: "Drive not configured" }, { status: 500 });
    }

    const { Readable } = await import("stream");
    const buffer = Buffer.from(await file.arrayBuffer());
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const ext = file.name.split(".").pop() || "jpg";
    const fileName = `${name.replace(/[^a-zA-Z]/g, "_")}_${type}_${timestamp}.${ext}`;

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    const drive = google.drive({ version: "v3", auth: oauth2Client });

    let targetFolderId = folderId;
    if (folderId) {
      try { targetFolderId = await getOrCreateMonthFolder(drive, folderId); } catch {}
    }

    const response = await drive.files.create({
      requestBody: { name: fileName, parents: targetFolderId ? [targetFolderId] : undefined },
      media: { mimeType: file.type || "image/jpeg", body: Readable.from(buffer) },
      fields: "id",
    });

    const fileId = response.data.id;
    if (!fileId) throw new Error("Upload failed");

    await drive.permissions.create({
      fileId,
      requestBody: { role: "reader", type: "anyone" },
    });

    return NextResponse.json({ link: `https://drive.google.com/file/d/${fileId}/view` });
  } catch (error: any) {
    console.error("Admin upload error:", error?.message);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
