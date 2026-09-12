import { NextRequest, NextResponse } from "next/server";
import { validateIdDocument, validateMultipleFiles } from "@/lib/validateIdDocument";
import { driveUploadFile, driveGetOrCreateFolder } from "@/lib/googleApiFetch";
import { addCheckin, getActiveCheckins, incrementStat, getSetting, getMonthKey, addAuditEntry, addSystemLog } from "@/db/queries";
import { dispatchPush, notificationFirstName } from "@/lib/pushNotify";
import { isOfflineMode } from "@/lib/runtime";
import { isForeignNationality } from "@/lib/checkinSchema";
import { isSameCheckinVisit } from "@/lib/checkinDuplicate";

function generateBookingId(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let random = "";
  for (let i = 0; i < 6; i++) random += chars[Math.floor(Math.random() * chars.length)];
  return `GOKO${yyyy}${mm}${dd}${random}`;
}

async function uploadToDrive(file: File, guestName: string, fileType: string): Promise<string> {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

  const buffer = await file.arrayBuffer();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const ext = file.name.split(".").pop() || "jpg";
  const fileName = `${guestName.replace(/[^a-zA-Z]/g, "_")}_${fileType}_${timestamp}.${ext}`;

  let targetFolderId = folderId;
  if (folderId) {
    try {
      targetFolderId = await driveGetOrCreateFolder(folderId, getMonthKey());
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
    const idImagesRaw = formData.getAll("idImages") as File[];
    const idImages = idImagesRaw.filter((f) => f.size > 0);
    const visaImagesRaw = formData.getAll("visaImages") as File[];
    const visaImages = visaImagesRaw.filter((f) => f.size > 0);

    const bookingPlatform = formData.get("bookingPlatform") as string || "";
    const rawBookingId = formData.get("bookingId") as string || "";

    const prevIdCardLink = formData.get("prevIdCardLink") as string || "";
    const prevVisaLink = formData.get("prevVisaLink") as string || "";

    const arrivedFromCountry = formData.get("arrivedFromCountry") as string || "";
    const arrivedFromCity = formData.get("arrivedFromCity") as string || "";
    const arrivedFromPlace = formData.get("arrivedFromPlace") as string || "";
    const dateOfArrivalInIndia = formData.get("dateOfArrivalInIndia") as string || "";
    const purposeOfVisit = formData.get("purposeOfVisit") as string || "";
    const employedInIndia = formData.get("employedInIndia") as string || "";
    const nextDestination = formData.get("nextDestination") as string || "";
    const nextDestState = formData.get("nextDestState") as string || "";
    const nextDestCity = formData.get("nextDestCity") as string || "";
    const nextDestPlace = formData.get("nextDestPlace") as string || "";
    const homeAddress = formData.get("homeAddress") as string || "";
    const homeCity = formData.get("homeCity") as string || "";
    const homeCountryPhone = formData.get("homeCountryPhone") as string || "";

    const hasIdImages = idImages.length > 0 || !!prevIdCardLink;
    if (!name || !contactNumber || !nationality || !idType || !hasIdImages || !arrivalDate || !stayingDays || !comingFrom || !numberOfPersons) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    if (isForeignNationality(nationality) && idType !== "passport") {
      return NextResponse.json({ error: "Foreign nationals must provide a passport", field: "idType" }, { status: 400 });
    }
    if (isForeignNationality(nationality) && visaImages.length === 0 && !prevVisaLink) {
      return NextResponse.json({ error: "Visa document is required for non-Indian nationals", field: "visaImages" }, { status: 400 });
    }

    const duplicate = (await getActiveCheckins()).find((existing) => isSameCheckinVisit(existing, {
      name,
      contact: contactNumber,
      arrivalDate,
    }));
    if (duplicate) {
      addSystemLog({ level: "info", source: "checkin", message: `Duplicate self check-in ignored: ${name} (#${duplicate.id})` }).catch(() => {});
      return NextResponse.json({ success: true, duplicate: true, checkinId: duplicate.id });
    }

    for (const file of [...idImages, ...visaImages]) {
      if (file.size > 10 * 1024 * 1024) {
        return NextResponse.json({ error: `File "${file.name}" exceeds 10 MB limit` }, { status: 400 });
      }
    }

    let validationEnabled = true;
    try {
      const val = await getSetting("image_validation");
      validationEnabled = val !== "off";
    } catch { /* default to enabled */ }

    let serverVisionCalls = 0;
    let validationFailed = false;
    let idSpoofWarning = false;
    let passportOcrText = "";
    let visaOcrText = "";
    let idOcrText = "";

    const reusingPrevId = idImages.length === 0 && !!prevIdCardLink;
    const reusingPrevVisa = visaImages.length === 0 && !!prevVisaLink;

    if (validationEnabled && !reusingPrevId && !isOfflineMode()) {
      async function validateFile(file: File, category: "id" | "visa", idTypeHint?: string, nameToCheck?: string) {
        if (!file.type.startsWith("image/") && file.type !== "application/pdf") {
          return { valid: false, documentType: "unknown" as const, confidence: "high" as const, message: "Only images and PDFs accepted" };
        }
        const buffer = Buffer.from(await file.arrayBuffer());
        return validateIdDocument(buffer, category, idTypeHint as any, nameToCheck, file.type);
      }

      try {
        let idValidation;
        if (idImages.length > 1) {
          for (const f of idImages) {
            if (!f.type.startsWith("image/") && f.type !== "application/pdf") {
              return NextResponse.json({ error: "Only images and PDFs accepted", field: "idImages" }, { status: 422 });
            }
          }
          const buffers = await Promise.all(idImages.map(async (f) => ({
            buffer: Buffer.from(await f.arrayBuffer()),
            mimeType: f.type,
          })));
          idValidation = await validateMultipleFiles(buffers, "id", idType as any, name);
          serverVisionCalls += idImages.length;
        } else {
          idValidation = await validateFile(idImages[0], "id", idType, name);
          serverVisionCalls++;
        }
        if (idValidation.ocrText) {
          idOcrText = idValidation.ocrText;
          if (idType === "passport") {
            passportOcrText = idValidation.ocrText;
          }
        }
        if (idValidation.spoofWarning) {
          idSpoofWarning = true;
        }
        if (!idValidation.valid) {
          return NextResponse.json({ error: idValidation.message, field: "idImages" }, { status: 422 });
        }
      } catch (valErr: any) {
        console.error("ID validation error:", valErr?.message);
        validationFailed = true;
      }

      if (visaImages.length > 0 && !reusingPrevVisa) {
        try {
          let visaValidation;
          if (visaImages.length > 1) {
            for (const f of visaImages) {
              if (!f.type.startsWith("image/") && f.type !== "application/pdf") {
                return NextResponse.json({ error: "Only images and PDFs accepted", field: "visaImages" }, { status: 422 });
              }
            }
            const buffers = await Promise.all(visaImages.map(async (f) => ({
              buffer: Buffer.from(await f.arrayBuffer()),
              mimeType: f.type,
            })));
            visaValidation = await validateMultipleFiles(buffers, "visa");
            serverVisionCalls += visaImages.length;
          } else {
            visaValidation = await validateFile(visaImages[0], "visa");
            serverVisionCalls++;
          }
          if (visaValidation.ocrText) {
            visaOcrText = visaValidation.ocrText;
          }
          if (!visaValidation.valid) {
            return NextResponse.json({ error: visaValidation.message, field: "visaImages" }, { status: 422 });
          }
        } catch (valErr: any) {
          console.error("Visa validation error:", valErr?.message);
          validationFailed = true;
        }
      }
    }

    if (serverVisionCalls > 0) incrementStat("vision", serverVisionCalls).catch(() => {});

    let idCardLink: string;
    let visaLink: string;

    if (reusingPrevId) {
      idCardLink = prevIdCardLink;
    } else if (isOfflineMode()) {
      idCardLink = "offline-pending";
    } else {
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
      idCardLink = idCardLinks.join(" | ");
    }

    if (reusingPrevVisa) {
      visaLink = prevVisaLink;
    } else if (isOfflineMode()) {
      visaLink = visaImages.length > 0 ? "offline-pending" : "";
    } else {
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
      visaLink = visaLinks.join(" | ");
    }
    const submittedAt = new Date().toISOString();
    const verified = reusingPrevId ? "yes" : !validationEnabled ? "pending" : validationFailed ? "pending" : idSpoofWarning ? "spoof_warning" : "yes";

    const isForeigner = isForeignNationality(nationality);
    let formCData = "";
    if (isForeigner) {
      let extractedPassport = {};
      let extractedVisa = {};
      if (passportOcrText) {
        const { parsePassportMRZ } = await import("@/lib/parsePassportData");
        extractedPassport = parsePassportMRZ(passportOcrText);
      }
      if (visaOcrText) {
        const { parseVisaFromText } = await import("@/lib/parsePassportData");
        extractedVisa = parseVisaFromText(visaOcrText);
      }
      formCData = JSON.stringify({
        arrivedFromCountry, arrivedFromCity, arrivedFromPlace,
        dateOfArrivalInIndia, purposeOfVisit, employedInIndia,
        nextDestination, nextDestState, nextDestCity, nextDestPlace,
        homeAddress, homeCity, homeCountryPhone,
        extractedPassport, extractedVisa,
      });
    }

    const finalBookingId = (bookingPlatform === "Offline booking" || bookingPlatform === "Walk-in")
      ? generateBookingId()
      : rawBookingId;

    let formDob = "";
    let ocrDob = "";
    try {
      formDob = (formData.get("dob") as string) || "";
      if (idOcrText) {
        const { parseDobFromOcr } = await import("@/lib/parseDob");
        ocrDob = parseDobFromOcr(idOcrText, idType) || "";
      }
      if (!ocrDob && isForeigner && passportOcrText) {
        const { parseDobFromOcr } = await import("@/lib/parseDob");
        ocrDob = parseDobFromOcr(passportOcrText, "passport") || "";
      }
    } catch {}

    const dob = formDob || ocrDob;
    const dobFromId = ocrDob;

    const checkinData: Parameters<typeof addCheckin>[0] = {
      submittedAt,
      arrivalDate,
      arrivalTime: arrivalTime || "",
      name,
      persons: numberOfPersons,
      contact: contactNumber,
      stayingDays,
      comingFrom,
      nationality,
      emergencyName: emergencyName || "",
      emergencyPhone: emergencyPhone || "",
      idType,
      idCardLink,
      visaLink,
      verified,
      formCData,
      createdMonth: getMonthKey(),
      bookingPlatform,
      bookingId: finalBookingId,
      dob: dob || undefined,
      dobFromId: dobFromId || undefined,
    };

    try {
      await addCheckin(checkinData);
    } catch (insertErr: any) {
      if (insertErr?.message?.includes("dob") || insertErr?.message?.includes("vibe_matched") || insertErr?.message?.includes("dob_from_id")) {
        const { dob: _d, dobFromId: _di, ...fallbackData } = checkinData;
        await addCheckin(fallbackData as Parameters<typeof addCheckin>[0]);
      } else {
        throw insertErr;
      }
    }

    const newUploads = (reusingPrevId ? 0 : idImages.length) + (reusingPrevVisa ? 0 : visaImages.length);
    if (newUploads > 0) incrementStat("drive", newUploads).catch(() => {});

    addAuditEntry({ username: "guest", action: "self_checkin", target: name }).catch(() => {});
    addSystemLog({ level: "info", source: "checkin", message: `Self check-in: ${name}` }).catch(() => {});

    if (!isOfflineMode()) {
      await dispatchPush({
        title: "New Check-in",
        body: `${notificationFirstName(name)} · ${numberOfPersons} ${Number(numberOfPersons) === 1 ? "guest" : "guests"} · ${finalBookingId ? `Booking ${finalBookingId}` : bookingPlatform || "Walk-in"}`,
        url: "/admin?section=dashboard",
        eventId: `self-checkin-${finalBookingId || submittedAt}`,
        category: "checkin",
      });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Check-in API error:", error?.message || error);
    addSystemLog({ level: "error", source: "checkin", message: error?.message || "Unknown error" }).catch(() => {});
    const raw = error?.message || "Internal server error";
    const userMessage = raw.includes("Failed query") || raw.includes("D1_ERROR")
      ? "Database temporarily unavailable. Please try again."
      : raw.includes("UNIQUE") || raw.includes("unique")
        ? "Duplicate entry detected. This check-in may already exist."
        : "Check-in failed. Please try again.";
    return NextResponse.json({ error: userMessage }, { status: 500 });
  }
}
