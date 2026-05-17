import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { validateIdDocument } from "@/lib/validateIdDocument";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive", "https://www.googleapis.com/auth/cloud-vision"];

async function getAuthClient() {
  const credentials = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!credentials) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY env variable not set");
  }
  const key = JSON.parse(credentials);
  const privateKey = key.private_key.replace(/\\n/g, "\n");
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: key.client_email,
      private_key: privateKey,
    },
    scopes: SCOPES,
  });
  return auth;
}

async function saveUploadedFile(file: File, guestName: string, fileType: string): Promise<string> {
  const fs = require("fs");
  const path = require("path");
  const stream = require("stream");

  const buffer = Buffer.from(await file.arrayBuffer());
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const ext = file.name.split(".").pop() || "jpg";
  const fileName = `${guestName.replace(/[^a-zA-Z]/g, "_")}_${fileType}_${timestamp}.${ext}`;

  const uploadsDir = path.join(process.cwd(), "public", "uploads");
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  const filePath = path.join(uploadsDir, fileName);
  fs.writeFileSync(filePath, buffer);

  const localUrl = `/uploads/${fileName}`;

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

  if (clientId && clientSecret && refreshToken) {
    try {
      const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
      oauth2Client.setCredentials({ refresh_token: refreshToken });

      const drive = google.drive({ version: "v3", auth: oauth2Client });

      const readable = new stream.PassThrough();
      readable.end(buffer);

      const response = await drive.files.create({
        requestBody: {
          name: fileName,
          parents: folderId ? [folderId] : undefined,
        },
        media: {
          mimeType: file.type || "image/jpeg",
          body: readable,
        },
        fields: "id",
      });

      if (response.data.id) {
        await drive.permissions.create({
          fileId: response.data.id,
          requestBody: { role: "reader", type: "anyone" },
        });
        return `https://drive.google.com/file/d/${response.data.id}/view`;
      }
    } catch (driveErr: any) {
      console.error("Drive upload failed, using local:", driveErr?.message);
    }
  }

  return localUrl;
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();

    const arrivalDate = formData.get("arrivalDate") as string;
    const arrivalTime = formData.get("arrivalTime") as string;
    const name = formData.get("name") as string;
    const numberOfPersons = formData.get("numberOfPersons") as string;
    const contactNumber = formData.get("contactNumber") as string;
    const stayingDays = formData.get("stayingDays") as string;
    const comingFrom = formData.get("comingFrom") as string;
    const nationality = formData.get("nationality") as string;
    const emergencyName = formData.get("emergencyName") as string;
    const emergencyPhone = formData.get("emergencyPhone") as string;
    const idCardImage = formData.get("idCardImage") as File | null;
    const visaImage = formData.get("visaImage") as File | null;

    if (!name || !contactNumber || !nationality || !idCardImage) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    if (idCardImage.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "ID card image must be less than 10 MB" }, { status: 400 });
    }

    if (visaImage && visaImage.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "Visa image must be less than 10 MB" }, { status: 400 });
    }

    const idBuffer = Buffer.from(await idCardImage.arrayBuffer());
    const idValidation = await validateIdDocument(idBuffer, "id");
    if (!idValidation.valid) {
      return NextResponse.json(
        { error: idValidation.message, field: "idCardImage" },
        { status: 422 }
      );
    }

    if (visaImage && visaImage.size > 0) {
      const visaBuffer = Buffer.from(await visaImage.arrayBuffer());
      const visaValidation = await validateIdDocument(visaBuffer, "visa");
      if (!visaValidation.valid) {
        return NextResponse.json(
          { error: visaValidation.message, field: "visaImage" },
          { status: 422 }
        );
      }
    }

    const auth = await getAuthClient();
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    if (!spreadsheetId) {
      throw new Error("GOOGLE_SHEET_ID env variable not set");
    }

    let idCardLink = "";
    let visaLink = "";

    try {
      idCardLink = await saveUploadedFile(idCardImage, name, "id");
    } catch (uploadErr: any) {
      console.error("ID upload failed:", uploadErr?.message || uploadErr);
      idCardLink = "Upload failed";
    }

    if (visaImage && visaImage.size > 0) {
      try {
        visaLink = await saveUploadedFile(visaImage, name, "visa");
      } catch (uploadErr) {
        console.error("Visa upload failed:", uploadErr);
        visaLink = "Upload failed";
      }
    }

    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: "v4", auth: authClient as any });
    const submittedAt = new Date().toISOString();

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "CheckIns!A:M",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [
          [
            submittedAt,
            arrivalDate,
            arrivalTime,
            name,
            numberOfPersons,
            contactNumber,
            stayingDays,
            comingFrom,
            nationality,
            emergencyName,
            emergencyPhone,
            idCardLink,
            visaLink,
          ],
        ],
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Check-in API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
