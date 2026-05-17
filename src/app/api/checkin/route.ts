import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { validateIdDocument, validateIdFromText } from "@/lib/validateIdDocument";

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

function getMonthFolderName(): string {
  const d = new Date();
  const months = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
    "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
  return `${months[d.getMonth()]}-${d.getFullYear()}`;
}

function getMonthTab(): string {
  return getMonthFolderName();
}

async function getOrCreateMonthFolder(drive: any, parentFolderId: string): Promise<string> {
  const folderName = getMonthFolderName();

  const search = await drive.files.list({
    q: `name='${folderName}' and '${parentFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id)",
  });

  if (search.data.files?.length > 0) {
    return search.data.files[0].id;
  }

  const created = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentFolderId],
    },
    fields: "id",
  });

  return created.data.id;
}

async function uploadToDrive(file: File, guestName: string, fileType: string): Promise<string> {
  const stream = require("stream");

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Google Drive OAuth credentials not configured");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const ext = file.name.split(".").pop() || "jpg";
  const fileName = `${guestName.replace(/[^a-zA-Z]/g, "_")}_${fileType}_${timestamp}.${ext}`;

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  const drive = google.drive({ version: "v3", auth: oauth2Client });

  let targetFolderId = folderId;
  if (folderId) {
    try {
      targetFolderId = await getOrCreateMonthFolder(drive, folderId);
    } catch (err: any) {
      console.error("Month folder creation failed, using root:", err?.message);
    }
  }

  const readable = new stream.PassThrough();
  readable.end(buffer);

  const response = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: targetFolderId ? [targetFolderId] : undefined,
    },
    media: {
      mimeType: file.type || "image/jpeg",
      body: readable,
    },
    fields: "id",
  });

  const fileId = response.data.id;
  if (!fileId) throw new Error("Drive upload returned no file ID");

  await drive.permissions.create({
    fileId,
    requestBody: { role: "reader", type: "anyone" },
  });

  return `https://drive.google.com/file/d/${fileId}/view`;
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
    const idType = formData.get("idType") as string;
    const idImages = formData.getAll("idImages") as File[];
    const visaImagesRaw = formData.getAll("visaImages") as File[];
    const visaImages = visaImagesRaw.filter((f) => f.size > 0);

    if (!name || !contactNumber || !nationality || !idType || idImages.length === 0) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    for (const file of [...idImages, ...visaImages]) {
      if (file.size > 10 * 1024 * 1024) {
        return NextResponse.json({ error: `File "${file.name}" exceeds 10 MB limit` }, { status: 400 });
      }
    }

    async function validateFile(file: File, category: "id" | "visa", idTypeHint?: string, nameToCheck?: string) {
      if (file.type === "application/pdf") {
        const pdfParse = (await import("pdf-parse") as any).default || (await import("pdf-parse"));
        const pdfBuffer = Buffer.from(await file.arrayBuffer());
        const data = await pdfParse(pdfBuffer);
        return validateIdFromText(data.text || "", category, idTypeHint as any, nameToCheck);
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      return validateIdDocument(buffer, category, idTypeHint as any, nameToCheck);
    }

    try {
      const idValidation = await validateFile(idImages[0], "id", idType, name);
      if (!idValidation.valid) {
        return NextResponse.json(
          { error: idValidation.message, field: "idImages" },
          { status: 422 }
        );
      }
    } catch (valErr: any) {
      console.error("ID validation error:", valErr?.message);
    }

    if (visaImages.length > 0) {
      try {
        const visaValidation = await validateFile(visaImages[0], "visa");
        if (!visaValidation.valid) {
          return NextResponse.json(
            { error: visaValidation.message, field: "visaImages" },
            { status: 422 }
          );
        }
      } catch (valErr: any) {
        console.error("Visa validation error:", valErr?.message);
      }
    }

    const auth = await getAuthClient();
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    if (!spreadsheetId) {
      throw new Error("GOOGLE_SHEET_ID env variable not set");
    }

    const idCardLinks: string[] = [];
    for (let i = 0; i < idImages.length; i++) {
      try {
        const link = await uploadToDrive(idImages[i], name, `id_${i + 1}`);
        idCardLinks.push(link);
      } catch (uploadErr: any) {
        console.error(`ID image ${i + 1} upload failed:`, uploadErr?.message);
        idCardLinks.push("Upload failed");
      }
    }

    const visaLinks: string[] = [];
    for (let i = 0; i < visaImages.length; i++) {
      try {
        const link = await uploadToDrive(visaImages[i], name, `visa_${i + 1}`);
        visaLinks.push(link);
      } catch (uploadErr: any) {
        console.error(`Visa image ${i + 1} upload failed:`, uploadErr?.message);
        visaLinks.push("Upload failed");
      }
    }

    const idCardLink = idCardLinks.join(" | ");
    const visaLink = visaLinks.join(" | ");

    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: "v4", auth: authClient as any });
    const submittedAt = new Date().toISOString();
    const tabName = getMonthTab();

    const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties.title" });
    const existingTabs = meta.data.sheets?.map((s: any) => s.properties.title) || [];
    if (!existingTabs.includes(tabName)) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{ addSheet: { properties: { title: tabName } } }],
        },
      });
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${tabName}'!A1:M1`,
        valueInputOption: "RAW",
        requestBody: {
          values: [["Submitted At", "Arrival Date", "Arrival Time", "Name", "Persons",
            "Contact", "Days", "Coming From", "Nationality", "Emergency Contact",
            "Emergency Phone", "ID Type", "ID Card", "Visa"]],
        },
      });
    }

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `'${tabName}'!A:N`,
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
            idType,
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
