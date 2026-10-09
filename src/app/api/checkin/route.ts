import { NextRequest, NextResponse } from "next/server";
import { validateIdDocument, validateMultipleFiles, verifiedFromIdValidation } from "@/lib/validateIdDocument";
import { driveUploadFile, driveGetOrCreateFolder } from "@/lib/googleApiFetch";
import { addCheckin, getActiveCheckins, getCheckinByIdempotencyKey, claimCheckinSubmission, releaseCheckinSubmissionClaim, incrementStat, getMonthKey, getSetting, addAuditEntry, addSystemLog } from "@/db/queries";
import { dispatchPush, notificationFirstName } from "@/lib/pushNotify";
import { isOfflineMode } from "@/lib/runtime";
import { isForeignNationality } from "@/lib/checkinSchema";
import { isSameCheckinVisit } from "@/lib/checkinDuplicate";
import { dobEqualsArrivalDate, getAgeFromDob } from "@/lib/parseDob";
import { guestBookingRateLimit, assertGuestOrigin } from "@/lib/guestBookingRateLimit";
import { isUniqueConstraintError, parseCreateIdempotencyKey } from "@/lib/createIdempotency";
import { isPasswordProtectedPdf } from "@/lib/pdfSecurity";
import { digestFiles, verifyCheckinValidationAttestation } from "@/lib/checkinValidationAttestation";
import { checkinReviewReasons } from "@/lib/checkinReview";

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

async function uploadToDrive(file: File, guestName: string, fileType: string, targetFolderId?: string): Promise<string> {
  const buffer = await file.arrayBuffer();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const ext = file.name.split(".").pop() || "jpg";
  const fileName = `${guestName.replace(/[^a-zA-Z]/g, "_")}_${fileType}_${timestamp}.${ext}`;

  return driveUploadFile(fileName, file.type || "image/jpeg", buffer, targetFolderId);
}

function isReusableDriveLink(value: string) {
  const links = value.split(" | ").map((link) => link.trim()).filter(Boolean);
  return links.length > 0 && links.every((link) => /^https:\/\/drive\.google\.com\/file\/d\/[^/]+\/view(?:\?|$)/.test(link));
}

async function uploadFiles(files: File[], guestName: string, prefix: string, folderId?: string) {
  const links: string[] = [];
  for (let index = 0; index < files.length; index += 2) {
    const batch = files.slice(index, index + 2);
    const results = await Promise.all(batch.map((file, offset) => uploadToDrive(file, guestName, `${prefix}_${index + offset + 1}`, folderId)));
    links.push(...results);
  }
  return links;
}

export async function POST(req: NextRequest) {
  const contentLength = Number(req.headers.get("content-length") || "0");
  if (contentLength > 35 * 1024 * 1024) return NextResponse.json({ error: "Submission is too large" }, { status: 413 });
  try { assertGuestOrigin(req); } catch { return NextResponse.json({ error: "Invalid request origin" }, { status: 403 }); }
  const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "unknown";
  if (!guestBookingRateLimit(`checkin:${ip}`, 8, 10 * 60_000)) return NextResponse.json({ error: "Too many submissions. Please try again later." }, { status: 429 });
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
    const idValidationAttestation = (formData.get("idValidationAttestation") as string || "").trim();
    const visaValidationAttestation = (formData.get("visaValidationAttestation") as string || "").trim();

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
    const formDob = (formData.get("dob") as string || "").trim();
    const parsedKey = parseCreateIdempotencyKey(formData.get("idempotencyKey"));
    if ("error" in parsedKey) {
      return NextResponse.json({ error: parsedKey.error }, { status: 400 });
    }
    const idempotencyKey = parsedKey.key;
    const existingByKey = await getCheckinByIdempotencyKey(idempotencyKey);
    if (existingByKey) {
      return NextResponse.json({ success: true, duplicate: true, checkinId: existingByKey.id });
    }

    const validPrevIdCardLink = isReusableDriveLink(prevIdCardLink) ? prevIdCardLink : "";
    const validPrevVisaLink = isReusableDriveLink(prevVisaLink) ? prevVisaLink : "";
    const hasIdImages = idImages.length > 0 || !!validPrevIdCardLink;
    if (!name || !contactNumber || !nationality || !idType || !hasIdImages || !arrivalDate || !stayingDays || !comingFrom || !numberOfPersons) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    if (isForeignNationality(nationality) && idType !== "passport") {
      return NextResponse.json({ error: "Foreign nationals must provide a passport", field: "idType" }, { status: 400 });
    }
    if (isForeignNationality(nationality) && visaImages.length === 0 && !validPrevVisaLink) {
      return NextResponse.json({ error: "Visa document is required for non-Indian nationals", field: "visaImages" }, { status: 400 });
    }
    if (formDob && getAgeFromDob(formDob) === null) {
      return NextResponse.json({ error: "Please enter a valid date of birth that is not in the future", field: "dob" }, { status: 400 });
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
      if (file.type === "application/pdf" && isPasswordProtectedPdf(await file.arrayBuffer())) {
        return NextResponse.json({ error: `File "${file.name}" is password-protected. Upload an unlocked PDF or a photo instead.`, field: idImages.includes(file) ? "idImages" : "visaImages" }, { status: 422 });
      }
    }

    // Public check-in is fail-closed for known bad documents. The admin Vision
    // display setting must not turn this identity boundary into client trust.
    const validationEnabled = true;

    let serverVisionCalls = 0;
    let validationFailed = false;
    let idSpoofWarning = false;
    let idVerifiedOverride: ReturnType<typeof verifiedFromIdValidation> | null = null;
    let passportOcrText = "";
    let visaOcrText = "";
    let idOcrText = "";

    const reusingPrevId = idImages.length === 0 && !!validPrevIdCardLink;
    const reusingPrevVisa = visaImages.length === 0 && !!validPrevVisaLink;
    const idFileDigests = idImages.length > 0 ? await digestFiles(idImages) : [];
    const visaFileDigests = visaImages.length > 0 ? await digestFiles(visaImages) : [];
    const trustedIdValidation = idImages.length > 0 && await verifyCheckinValidationAttestation(idValidationAttestation, {
      category: "id", fileDigests: idFileDigests, idType, guestName: name, nationality,
    });
    const trustedVisaValidation = visaImages.length > 0 && await verifyCheckinValidationAttestation(visaValidationAttestation, {
      category: "visa", fileDigests: visaFileDigests, idType: "", guestName: "", nationality: "",
    });

    if (trustedIdValidation) idVerifiedOverride = "yes";

    if (validationEnabled && !isOfflineMode()) {
      async function validateFile(file: File, category: "id" | "visa", idTypeHint?: string, nameToCheck?: string) {
        if (!file.type.startsWith("image/") && file.type !== "application/pdf") {
          return { valid: false, documentType: "unknown" as const, confidence: "high" as const, message: "Only images and PDFs accepted" };
        }
        const buffer = Buffer.from(await file.arrayBuffer());
        return validateIdDocument(buffer, category, idTypeHint as any, nameToCheck, file.type, nationality);
      }

      if (!reusingPrevId && !trustedIdValidation) try {
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
          idValidation = await validateMultipleFiles(buffers, "id", idType as any, name, nationality);
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
        if (idValidation.unavailable) {
          validationFailed = true;
        } else if (!idValidation.valid) {
          return NextResponse.json({ error: idValidation.message, field: "idImages" }, { status: 422 });
        } else {
          const visionSoftDown = (idValidation.layers || []).includes("validation_unavailable");
          if (visionSoftDown) {
          // One file is enough when Vision is down (DigiLocker / combined photo OK).
          // Hard both-sides applies only when OCR succeeds and a side is missing.
            validationFailed = true;
          } else {
            idVerifiedOverride = verifiedFromIdValidation(idValidation);
          }
        }
      } catch (valErr: any) {
        console.error("ID validation error:", valErr?.message);
        validationFailed = true;
      }

      if (visaImages.length > 0 && !reusingPrevVisa && !trustedVisaValidation) {
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
          if (visaValidation.unavailable) {
            validationFailed = true;
          } else if (!visaValidation.valid) {
            return NextResponse.json({ error: visaValidation.message, field: "visaImages" }, { status: 422 });
          }
        } catch (valErr: any) {
          console.error("Visa validation error:", valErr?.message);
          validationFailed = true;
        }
      }
    }

    const ownsSubmission = await claimCheckinSubmission(idempotencyKey);
    if (!ownsSubmission) {
      const completed = await getCheckinByIdempotencyKey(idempotencyKey);
      if (completed) return NextResponse.json({ success: true, duplicate: true, checkinId: completed.id });
      return NextResponse.json({
        error: "This check-in is already being submitted. Please wait a moment and try again.",
        code: "checkin_submission_in_progress",
      }, { status: 409 });
    }

    try {
    if (serverVisionCalls > 0) incrementStat("vision", serverVisionCalls).catch(() => {});

    const rootFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    let monthFolderId: string | undefined;
    if (!isOfflineMode() && rootFolderId && (idImages.length > 0 || visaImages.length > 0)) {
      try {
        monthFolderId = await driveGetOrCreateFolder(rootFolderId, getMonthKey());
      } catch (folderError: any) {
        console.error("ID upload folder failed:", folderError?.message);
        return NextResponse.json({ error: "Could not prepare document storage. Please try again." }, { status: 503 });
      }
    }

    let idCardLink: string;
    let visaLink: string;

    if (reusingPrevId) {
      idCardLink = validPrevIdCardLink;
    } else if (isOfflineMode()) {
      idCardLink = "offline-pending";
    } else {
      try {
        idCardLink = (await uploadFiles(idImages, name, "id", monthFolderId)).join(" | ");
      } catch (uploadErr: any) {
        console.error("ID upload failed:", uploadErr?.message);
        return NextResponse.json({ error: "Could not save your ID document. Please try again." }, { status: 503 });
      }
    }

    if (reusingPrevVisa) {
      visaLink = validPrevVisaLink;
    } else if (isOfflineMode()) {
      visaLink = visaImages.length > 0 ? "offline-pending" : "";
    } else {
      try {
        visaLink = (await uploadFiles(visaImages, name, "visa", monthFolderId)).join(" | ");
      } catch (uploadErr: any) {
        console.error("Visa upload failed:", uploadErr?.message);
        return NextResponse.json({ error: "Could not save your visa document. Please try again." }, { status: 503 });
      }
    }
    const submittedAt = new Date().toISOString();
    const verified = reusingPrevId
      ? "yes"
      : !validationEnabled || validationFailed
        ? "pending"
        : idVerifiedOverride
          ? (idSpoofWarning && idVerifiedOverride === "yes" ? "spoof_warning" : idVerifiedOverride)
          : idSpoofWarning
            ? "spoof_warning"
            : "yes";

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
        draftId: `FCD-${Date.now()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        status: "draft",
        draftCreatedAt: submittedAt,
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

    let ocrDob = "";
    try {
      if (idOcrText) {
        const { parseDobFromOcr } = await import("@/lib/parseDob");
        ocrDob = parseDobFromOcr(idOcrText, idType) || "";
      }
      if (!ocrDob && isForeigner && passportOcrText) {
        const { parseDobFromOcr } = await import("@/lib/parseDob");
        ocrDob = parseDobFromOcr(passportOcrText, "passport") || "";
      }
      if (ocrDob && dobEqualsArrivalDate(ocrDob, arrivalDate)) {
        ocrDob = "";
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
      idempotencyKey,
    };

    let createdId: number | undefined;
    try {
      const rows = await addCheckin(checkinData);
      createdId = rows?.[0]?.id;
    } catch (insertErr: unknown) {
      if (isUniqueConstraintError(insertErr)) {
        const raced = await getCheckinByIdempotencyKey(idempotencyKey);
        if (raced) {
          return NextResponse.json({ success: true, duplicate: true, checkinId: raced.id });
        }
      }
      const msg = insertErr instanceof Error ? insertErr.message : String(insertErr);
      if (msg.includes("dob") || msg.includes("vibe_matched") || msg.includes("dob_from_id")) {
        const { dob: _d, dobFromId: _di, ...fallbackData } = checkinData;
        const rows = await addCheckin(fallbackData as Parameters<typeof addCheckin>[0]);
        createdId = rows?.[0]?.id;
      } else {
        throw insertErr;
      }
    }

    const newUploads = (reusingPrevId ? 0 : idImages.length) + (reusingPrevVisa ? 0 : visaImages.length);
    if (newUploads > 0) incrementStat("drive", newUploads).catch(() => {});

    addAuditEntry({ username: "guest", action: "self_checkin", target: name }).catch(() => {});
    addSystemLog({ level: "info", source: "checkin", message: `Self check-in: ${name}` }).catch(() => {});

    if (!isOfflineMode()) {
      void Promise.resolve(dispatchPush({
        notificationType: "checkin.new",
        title: "New Check-in",
        body: `${notificationFirstName(name)} · ${numberOfPersons} ${Number(numberOfPersons) === 1 ? "guest" : "guests"} · ${finalBookingId ? `Booking ${finalBookingId}` : bookingPlatform || "Walk-in"}`,
        url: "/admin?section=dashboard",
        eventId: `self-checkin-${finalBookingId || submittedAt}`,
      })).catch((pushErr: any) => {
        console.error("Check-in notification failed after save:", pushErr?.message || pushErr);
      });
      const [minSetting, maxSetting] = await Promise.all([getSetting("guest_min_age"), getSetting("guest_max_age")]).catch(() => [null, null]);
      const reasons = checkinReviewReasons({ dob, dobFromId, verified, minAge: Number(minSetting) || 18, maxAge: Number(maxSetting) || 40 });
      if (reasons.length > 0) {
        void Promise.resolve(dispatchPush({
          notificationType: "checkin.needs_review",
          title: "Check-in needs review",
          body: `${notificationFirstName(name)} · ${reasons.map((reason) => reason.label).join(" · ")}`,
          url: "/admin?section=records",
          eventId: `self-checkin-review-${createdId || finalBookingId || submittedAt}`,
        })).catch((pushErr: any) => {
          console.error("Check-in review notification failed after save:", pushErr?.message || pushErr);
        });
      }
    }

    return NextResponse.json({ success: true });
    } finally {
      await releaseCheckinSubmissionClaim(idempotencyKey).catch(() => undefined);
    }
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
