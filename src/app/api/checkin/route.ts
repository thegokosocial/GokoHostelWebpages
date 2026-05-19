import { NextRequest, NextResponse } from "next/server";
import { validateIdDocument } from "@/lib/validateIdDocument";
import {
  sheetsAppend,
  ensureMonthTab,
  driveUploadFile,
  driveGetOrCreateFolder,
  getMonthTabName,
  getSettingValue,
  CHECKIN_HEADERS,
  incrementApiStat,
} from "@/lib/googleApiFetch";

async function uploadToDrive(file: File, guestName: string, fileType: string): Promise<string> {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

  const buffer = await file.arrayBuffer();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const ext = file.name.split(".").pop() || "jpg";
  const fileName = `${guestName.replace(/[^a-zA-Z]/g, "_")}_${fileType}_${timestamp}.${ext}`;

  let targetFolderId = folderId;
  if (folderId) {
    try {
      targetFolderId = await driveGetOrCreateFolder(folderId, getMonthTabName());
    } catch (err: any) {
      console.error("Month folder creation failed:", err?.message);
    }
  }

  return driveUploadFile(fileName, file.type || "image/jpeg", buffer, targetFolderId);
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

    if (!name || !contactNumber || !nationality || !idType || idImages.length === 0 || !arrivalDate || !stayingDays || !comingFrom || !numberOfPersons) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    for (const file of [...idImages, ...visaImages]) {
      if (file.size > 10 * 1024 * 1024) {
        return NextResponse.json({ error: `File "${file.name}" exceeds 10 MB limit` }, { status: 400 });
      }
    }

    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    if (!spreadsheetId) throw new Error("GOOGLE_SHEET_ID not set");

    let validationEnabled = true;
    try {
      const val = await getSettingValue(spreadsheetId, "image_validation");
      validationEnabled = val !== "off";
    } catch { /* default to enabled */ }

    let serverVisionCalls = 0;
    let validationFailed = false;
    if (validationEnabled) {
      async function validateFile(file: File, category: "id" | "visa", idTypeHint?: string, nameToCheck?: string) {
        if (!file.type.startsWith("image/") && file.type !== "application/pdf") {
          return { valid: false, documentType: "unknown" as const, confidence: "high" as const, message: "Only images and PDFs accepted" };
        }
        const buffer = Buffer.from(await file.arrayBuffer());
        return validateIdDocument(buffer, category, idTypeHint as any, nameToCheck, file.type);
      }

      try {
        const idValidation = await validateFile(idImages[0], "id", idType, name);
        serverVisionCalls++;
        if (!idValidation.valid) {
          return NextResponse.json({ error: idValidation.message, field: "idImages" }, { status: 422 });
        }
      } catch (valErr: any) {
        console.error("ID validation error:", valErr?.message);
        validationFailed = true;
      }

      if (visaImages.length > 0) {
        try {
          const visaValidation = await validateFile(visaImages[0], "visa");
          serverVisionCalls++;
          if (!visaValidation.valid) {
            return NextResponse.json({ error: visaValidation.message, field: "visaImages" }, { status: 422 });
          }
        } catch (valErr: any) {
          console.error("Visa validation error:", valErr?.message);
          validationFailed = true;
        }
      }
    }

    if (serverVisionCalls > 0) incrementApiStat(spreadsheetId, "vision", serverVisionCalls).catch(() => {});

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
    const submittedAt = new Date().toISOString();
    const tabName = getMonthTabName();

    await ensureMonthTab(spreadsheetId, tabName, CHECKIN_HEADERS);

    const verified = !validationEnabled ? "pending" : validationFailed ? "pending" : "yes";

    await sheetsAppend(spreadsheetId, `'${tabName}'!A:O`, [
      [submittedAt, arrivalDate, arrivalTime, name, numberOfPersons, contactNumber,
        stayingDays, comingFrom, nationality, emergencyName, emergencyPhone, idType, idCardLink, visaLink, verified],
    ]);

    const driveCount = idCardLinks.filter((l) => l !== "Upload failed").length + visaLinks.filter((l) => l !== "Upload failed").length;
    if (driveCount > 0) incrementApiStat(spreadsheetId, "drive", driveCount).catch(() => {});
    incrementApiStat(spreadsheetId, "sheets", 1).catch(() => {});

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Check-in API error:", error?.message || error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
