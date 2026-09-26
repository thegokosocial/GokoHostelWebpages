import { visionAnalyze, type VisionAnalysis } from "./googleApiFetch";
import { isForeignNationality } from "./checkinSchema";

// --- Enhanced text patterns ---

const AADHAAR_STRONG_PATTERNS = [
  /aadhaar/i,
  /आधार/,
  /unique\s*identification/i,
  /uidai/i,
  /\bVID\b.*\d{4}\s?\d{4}\s?\d{4}\s?\d{4}/,
  /enrol(l)?ment\s*(no|number)/i,
];

const AADHAAR_PATTERNS = [
  ...AADHAAR_STRONG_PATTERNS,
  /\b\d{4}\s?\d{4}\s?\d{4}\b/,
  /generated\s*date/i,
];

const DRIVING_LICENCE_STRONG_PATTERNS = [
  /driving\s*licen[cs]e/i,
  /licence\s*no/i,
  /\bLMV\b/i,
  /\bMCWG\b/i,
  /sarathi/i,
  /\b(KA|MH|TN|AP|TS|DL|UP|GJ|RJ|MP|WB|KL|PB|HR|OR|JH|CG|BR|GA)\d{2}\s?\d{11,13}\b/,
  /class\s*of\s*vehicle/i,
];

const DRIVING_LICENCE_PATTERNS = [
  ...DRIVING_LICENCE_STRONG_PATTERNS,
  /transport\s*(department|authority|commissioner)/i,
  /motor\s*vehicle/i,
  /\bDL\b/,
  /valid\s*(till|upto|from|to)/i,
  /date\s*of\s*issue/i,
];

const PASSPORT_PATTERNS = [
  /passport/i,
  /republic\s*of\s*india/i,
  /travel\s*document/i,
  /nationality/i,
  /date\s*of\s*expiry/i,
  /place\s*of\s*(birth|issue)/i,
  /\b[A-Z]\d{7}\b/,
  /P<IND/,
  /\b[A-Z]{3}[A-Z0-9<]{39}\b/,
  /bureau\s*of\s*immigration/i,
  /type.*\bP\b/i,
];

const VISA_PATTERNS = [
  /visa/i,
  /immigration/i,
  /entry\s*permit/i,
  /valid\s*(for|until|from)/i,
  /consulate|embassy/i,
  /type\s*of\s*visa/i,
  /duration\s*of\s*stay/i,
  /e-?visa/i,
  /gratis/i,
  /category.*visa/i,
];

const ALLOWED_ID_HINT = "Please upload Aadhaar, Driving Licence, or Passport.";

const PAN_PATTERNS = [
  /pan\s*card/i,
  /permanent\s*account\s*number/i,
  /income\s*tax\s*department/i,
  /\b[A-Z]{5}\d{4}[A-Z]\b/,
  /pan\s*verification/i,
  /pan\s*number/i,
];

const VOTER_PATTERNS = [
  /elector\s*photo\s*identity/i,
  /\bEPIC\b/i,
  /election\s*commission\s*of\s*india/i,
  /electoral\s*photo\s*identity/i,
  /voter\s*(id|identity|card)/i,
];

const MARKSHEET_PATTERNS = [
  /mark\s*-?\s*sheet/i,
  /marksheet/i,
  /grade\s*card/i,
  /statement\s*of\s*marks/i,
  /\bCBSE\b/,
  /\bICSE\b/,
  /\bSSC\b.*\b(exam|board|mark)/i,
  /\bHSC\b.*\b(exam|board|mark)/i,
  /semester\s*(result|mark|grade)/i,
  /percentage\s*:?\s*\d/i,
  /board\s*of\s*(secondary|intermediate|higher)/i,
];

const VEHICLE_RC_PATTERNS = [
  /certificate\s*of\s*registration/i,
  /registration\s*certificate/i,
  /\bRC\s*book\b/i,
  /chassis\s*(no|number)/i,
  /engine\s*(no|number)/i,
  /vehicle\s*registration/i,
  /registered\s*owner/i,
];

export type DocumentType = "aadhaar" | "driving_licence" | "passport" | "visa" | "unknown";
export type NameMatchQuality = "full" | "partial" | "none";

export type ValidationResult = {
  valid: boolean;
  documentType: DocumentType;
  confidence: "high" | "medium" | "low";
  message: string;
  nameMatch?: boolean;
  nameMatchQuality?: NameMatchQuality;
  layers?: string[];
  needsBackSide?: boolean;
  needsFrontSide?: boolean;
  needsDocReview?: boolean;
  ocrText?: string;
  spoofWarning?: boolean;
};

export type IdSidesResult = {
  requiresBothSides: boolean;
  hasFront: boolean;
  hasAddress: boolean;
  missing: "front" | "address" | null;
};

/** Aadhaar or Indian passport must show both identity (front/bio) and address sides. */
export function requiresBothIdSides(documentType: DocumentType | string, nationality?: string | null): boolean {
  if (documentType === "aadhaar") return true;
  if (documentType === "passport" && !isForeignNationality(nationality || "India")) return true;
  return false;
}

/** Holder-side cues (DOB / sex). Guardian S/O lines alone do not count. */
export function hasAadhaarFrontEvidence(text: string): boolean {
  const nonGuardian = text
    .split(/\n/)
    .filter((line) => !GUARDIAN_PATTERN.test(line))
    .join("\n");
  if (/\b(dob|date\s*of\s*birth|year\s*of\s*birth)\b/i.test(nonGuardian)) return true;
  if (/\b(male|female|transgender)\b/i.test(nonGuardian)) return true;
  return false;
}

export function hasPassportBioEvidence(text: string): boolean {
  if (/P<[A-Z]{3}/.test(text)) return true;
  if (/\b(dob|date\s*of\s*birth)\b/i.test(text) && /passport/i.test(text)) return true;
  if (countPatternHits(text, PASSPORT_PATTERNS) >= 2 && !/\baddress\b/i.test(text)) return true;
  if (countPatternHits(text, PASSPORT_PATTERNS) >= 3) return true;
  return false;
}

export function evaluateIdSides(
  text: string,
  documentType: DocumentType | string,
  nationality?: string | null,
): IdSidesResult {
  const requiresBoth = requiresBothIdSides(documentType, nationality);
  if (!requiresBoth) {
    return { requiresBothSides: false, hasFront: true, hasAddress: true, missing: null };
  }
  const hasFront = documentType === "aadhaar"
    ? hasAadhaarFrontEvidence(text)
    : hasPassportBioEvidence(text);
  const hasAddress = hasAddressEvidence(text);
  const missing: "front" | "address" | null = !hasFront ? "front" : !hasAddress ? "address" : null;
  return { requiresBothSides: true, hasFront, hasAddress, missing };
}

/** When Vision is down, Aadhaar / Indian passport need 2+ files (or a prior successful verify). */
export function bothSidesFileGateAllows(opts: {
  idType: string;
  nationality?: string | null;
  fileCount: number;
  visionUnavailable: boolean;
}): boolean {
  if (!opts.visionUnavailable) return true;
  if (!requiresBothIdSides(opts.idType, opts.nationality)) return true;
  return opts.fileCount >= 2;
}

// --- Layer helpers ---

const DOCUMENT_LABELS = [
  "document", "identity document", "card", "text", "paper", "license",
  "passport", "id card", "driving license", "receipt", "font",
  "identity", "plastic card", "certificate", "official document",
  "government", "permit", "credential", "laminate", "badge",
];

const JUNK_ONLY_LABELS = [
  "selfie", "food", "animal", "pet", "cat", "dog", "nature",
  "landscape", "building", "architecture", "flower", "tree",
  "sky", "mountain", "ocean", "sunset", "fashion", "clothing",
];

function checkIsDocument(labels: string[], objects: string[]): { isDoc: boolean; reason: string } {
  const all = [...labels, ...objects];
  const hasDocLabel = all.some((l) => DOCUMENT_LABELS.some((d) => l.includes(d)));
  if (hasDocLabel) return { isDoc: true, reason: "" };

  const onlyJunk = labels.slice(0, 5).every((l) => JUNK_ONLY_LABELS.some((j) => l.includes(j)));
  if (onlyJunk && labels.length > 0) {
    return { isDoc: false, reason: `This looks like a ${labels[0]} photo, not an ID document.` };
  }

  return { isDoc: true, reason: "" };
}

function checkSafeSearch(safeSearch: VisionAnalysis["safeSearch"]): { safe: boolean; reason: string } {
  if (!safeSearch) return { safe: true, reason: "" };

  const high = ["LIKELY", "VERY_LIKELY"];
  if (high.includes(safeSearch.adult)) {
    return { safe: false, reason: "Image contains inappropriate content. Please upload a valid ID." };
  }
  // Spoof: only reject VERY_LIKELY — digital IDs (DigiLocker, mAadhaar) trigger
  // LIKELY spoof since they're renders, not photos of physical cards
  if (safeSearch.spoof === "VERY_LIKELY") {
    return { safe: false, reason: "Image appears to be manipulated or spoofed. Please upload an original photo of your ID." };
  }
  if (high.includes(safeSearch.violence)) {
    return { safe: false, reason: "Image contains inappropriate content." };
  }
  return { safe: true, reason: "" };
}

const GUARDIAN_PATTERN = /\b[SDWC]\/O\b|पिता|माता|पति|पुत्र|पुत्री/i;

function wordBoundaryMatch(text: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?:^|[\\s,.:;/\\-])${escaped}(?:$|[\\s,.:;/\\-])`, "i");
  return pattern.test(text);
}

function countPatternHits(text: string, patterns: RegExp[]): number {
  return patterns.filter((p) => p.test(text)).length;
}

function hasStrongAadhaarCues(text: string): boolean {
  return countPatternHits(text, AADHAAR_STRONG_PATTERNS) >= 1
    || (/आधार/.test(text) && /\b\d{4}\s?\d{4}\s?\d{4}\b/.test(text));
}

function hasStrongDlCues(text: string): boolean {
  return countPatternHits(text, DRIVING_LICENCE_STRONG_PATTERNS) >= 1;
}

function hasAllowlistIdCues(text: string): boolean {
  return hasStrongAadhaarCues(text)
    || hasStrongDlCues(text)
    || countPatternHits(text, PASSPORT_PATTERNS) >= 2;
}

type UnsupportedClass = "pan" | "voter" | "marksheet" | "vehicle_rc";

function detectUnsupportedDocument(text: string): { kind: UnsupportedClass; hits: number } | null {
  const candidates: { kind: UnsupportedClass; hits: number; minHits: number }[] = [
    { kind: "pan", hits: countPatternHits(text, PAN_PATTERNS), minHits: 2 },
    { kind: "voter", hits: countPatternHits(text, VOTER_PATTERNS), minHits: 2 },
    { kind: "marksheet", hits: countPatternHits(text, MARKSHEET_PATTERNS), minHits: 2 },
    { kind: "vehicle_rc", hits: countPatternHits(text, VEHICLE_RC_PATTERNS), minHits: 2 },
  ];

  let best: { kind: UnsupportedClass; hits: number; minHits: number } | null = null;
  for (const c of candidates) {
    if (c.hits < c.minHits) continue;
    if (!best || c.hits > best.hits) best = c;
  }
  if (!best) return null;

  // Real DL must never be rejected as vehicle RC
  if (best.kind === "vehicle_rc" && hasStrongDlCues(text)) return null;
  // Clear allowlisted ID with stronger signals wins over weak wrong-doc
  if (hasAllowlistIdCues(text) && best.hits < 3 && best.kind !== "pan" && best.kind !== "voter") {
    return null;
  }
  // PAN/voter with allowlist cues still reject when wrong-doc cues are strong
  if ((best.kind === "pan" || best.kind === "voter") && hasStrongAadhaarCues(text) && best.hits < 2) {
    return null;
  }

  return { kind: best.kind, hits: best.hits };
}

function unsupportedMessage(kind: UnsupportedClass): string {
  switch (kind) {
    case "pan":
      return `PAN card detected. ${ALLOWED_ID_HINT}`;
    case "voter":
      return `Voter ID detected. ${ALLOWED_ID_HINT}`;
    case "marksheet":
      return `Mark sheet detected. ${ALLOWED_ID_HINT}`;
    case "vehicle_rc":
      return `Vehicle registration detected. ${ALLOWED_ID_HINT}`;
  }
}

function isAmbiguousWrongDoc(text: string): boolean {
  const rcHits = countPatternHits(text, VEHICLE_RC_PATTERNS);
  const markHits = countPatternHits(text, MARKSHEET_PATTERNS);
  if (hasStrongDlCues(text) || hasStrongAadhaarCues(text)) return false;
  // Single weak cue — prefer staff review over hard reject
  return (rcHits === 1 && !hasStrongDlCues(text)) || (markHits === 1 && !hasAllowlistIdCues(text));
}

type NameMatchResult = { quality: NameMatchQuality; matched: boolean };

function checkNameMatchQuality(text: string, guestName?: string): NameMatchResult {
  if (!guestName || guestName.trim().length < 2) {
    return { quality: "full", matched: true };
  }

  const parts = guestName.trim().toLowerCase().split(/\s+/).filter(Boolean);

  const lines = text.split(/\n/);
  const nonGuardianLines = lines.filter((line) => !GUARDIAN_PATTERN.test(line));
  const nonGuardianText = nonGuardianLines.join("\n");

  const normalizedText = nonGuardianLines
    .map((line) => {
      const collapsed = line.replace(/(?<!\p{L})\p{L}(\s\p{L}){2,}(?!\p{L})/gu, (m) => m.replace(/\s/g, ""));
      return collapsed;
    })
    .join("\n")
    .toLowerCase();

  const searchTexts = [nonGuardianText.toLowerCase(), normalizedText];
  const idTokens = normalizedText.split(/[^a-z0-9]+/i).filter((token) => token.length > 0);
  const meaningfulParts = parts.filter((part) => part.length >= 2 || parts.length === 1);
  if (meaningfulParts.length === 0) return { quality: "full", matched: true };

  const partMatches = meaningfulParts.map((part) => {
    const exact = idTokens.some((token) => token === part);
    const initial = part.length === 1 && idTokens.some((token) => token.startsWith(part));
    return exact || initial;
  });
  const matchedCount = partMatches.filter(Boolean).length;
  const firstOk = searchTexts.some((searchText) => wordBoundaryMatch(searchText, meaningfulParts[0]));

  if (matchedCount === meaningfulParts.length && firstOk) {
    return { quality: "full", matched: true };
  }
  if (matchedCount >= 1 && meaningfulParts.some((p) => p.length >= 2 && idTokens.includes(p))) {
    return { quality: "partial", matched: false };
  }
  return { quality: "none", matched: false };
}

const ADDRESS_PATTERNS = [
  /\baddress\b/i,
  /address\s*of\s*(parents|guardian|holder)/i,
  /permanent\s*address/i,
  /\bS\/O\b|\bD\/O\b|\bW\/O\b|\bC\/O\b/,
  /pin\s*:?\s*\d{6}/i,
  /\b\d{6}\b/,
  /\b(street|road|lane|nagar|colony|apartment|flat|house|floor|sector|block|village|district|taluk|mandal|ward)\b/i,
  /\b(karnataka|maharashtra|tamil\s*nadu|kerala|andhra|telangana|gujarat|rajasthan|uttar\s*pradesh|madhya\s*pradesh|west\s*bengal|bihar|odisha|punjab|haryana|goa)\b/i,
];

function hasAddressEvidence(text: string): boolean {
  return countPatternHits(text, ADDRESS_PATTERNS) >= 2;
}

function detectDocumentType(text: string): { type: DocumentType; matchCount: number } {
  const checks: { type: DocumentType; patterns: RegExp[]; minStrong?: () => boolean }[] = [
    { type: "aadhaar", patterns: AADHAAR_PATTERNS, minStrong: () => hasStrongAadhaarCues(text) },
    { type: "driving_licence", patterns: DRIVING_LICENCE_PATTERNS, minStrong: () => hasStrongDlCues(text) || countPatternHits(text, DRIVING_LICENCE_PATTERNS) >= 3 },
    { type: "passport", patterns: PASSPORT_PATTERNS },
    { type: "visa", patterns: VISA_PATTERNS },
  ];

  let bestMatch: { type: DocumentType; matchCount: number } = { type: "unknown", matchCount: 0 };
  for (const check of checks) {
    const matchCount = check.patterns.filter((p) => p.test(text)).length;
    if (matchCount === 0) continue;
    if (check.minStrong && !check.minStrong()) continue;
    if (matchCount > bestMatch.matchCount) {
      bestMatch = { type: check.type, matchCount };
    }
  }
  return bestMatch;
}

function runTextValidation(
  text: string,
  expectedCategory: "id" | "visa",
  expectedIdType?: string,
  guestName?: string,
  nationality?: string | null,
): ValidationResult {
  // Unreadable OCR is not high-confidence junk — soft-accept for staff review.
  if (!text || text.trim().length < 10) {
    return {
      valid: true,
      documentType: "unknown",
      confidence: "low",
      needsDocReview: true,
      layers: ["text_detection", "unreadable", "doc_review"],
      message: "Could not read clear text from this upload. You can still submit — staff will verify manually.",
    };
  }

  const layers: string[] = ["text_detection"];

  if (expectedCategory === "id") {
    const unsupported = detectUnsupportedDocument(text);
    if (unsupported) {
      layers.push("unsupported_doc", `unsupported_${unsupported.kind}`);
      return {
        valid: false,
        documentType: "unknown",
        confidence: "high",
        layers,
        message: unsupportedMessage(unsupported.kind),
      };
    }

    const { type, matchCount } = detectDocumentType(text);
    const validIdTypes: DocumentType[] = ["aadhaar", "driving_licence", "passport"];
    if (!validIdTypes.includes(type) || matchCount === 0) {
      layers.push("invalid_id", "doc_review");
      return {
        valid: true,
        documentType: "unknown",
        confidence: "low",
        needsDocReview: true,
        layers,
        message: `Document accepted for staff review. ${ALLOWED_ID_HINT}`,
      };
    }

    if (expectedIdType && type !== expectedIdType) {
      layers.push("type_mismatch");
      return {
        valid: false,
        documentType: type,
        confidence: "high",
        layers,
        message: `You selected "${expectedIdType.replace("_", " ")}" but this appears to be a ${type.replace("_", " ")}. Please change your ID type selection to "${type.replace("_", " ")}" to proceed.`,
      };
    }
    layers.push("type_match");

    // Both-sides hard rule before name soft-allow (blocks back-only surname matches).
    if (requiresBothIdSides(type, nationality)) {
      const sides = evaluateIdSides(text, type, nationality);
      if (sides.missing === "front") {
        layers.push("front_missing");
        return {
          valid: false,
          documentType: type,
          confidence: "high",
          needsFrontSide: true,
          layers,
          message: type === "passport"
            ? "Please also upload the passport bio page (photo + date of birth). Address page alone is not enough."
            : "Please also upload the front of your Aadhaar (photo + date of birth). Address/back side alone is not enough.",
        };
      }
      if (sides.missing === "address") {
        layers.push("address_missing");
        return {
          valid: false,
          documentType: type,
          confidence: "high",
          needsBackSide: true,
          layers,
          message: type === "passport"
            ? "Passport bio found, but address was not. Please also upload the address page of your Indian passport."
            : "Aadhaar front found, but address was not. Please also upload the back side showing your address.",
        };
      }
      layers.push("both_sides_ok");
    }

    const nameResult = checkNameMatchQuality(text, guestName);
    if (guestName && nameResult.quality === "none") {
      if (matchCount < 2) layers.push("weak_id");
      layers.push("name_mismatch");
      return {
        valid: true,
        documentType: type,
        confidence: matchCount < 2 ? "medium" : "high",
        nameMatch: false,
        nameMatchQuality: "none",
        needsDocReview: true,
        layers,
        message: `Name on the ${type.replace("_", " ")} could not be matched automatically. You can still submit — staff will confirm.`,
      };
    }

    let needsDocReview = false;
    if (guestName && nameResult.quality === "partial") {
      layers.push("name_partial");
    } else if (guestName && nameResult.quality === "full") {
      layers.push("name_verified");
    }

    if (isAmbiguousWrongDoc(text) && type === "driving_licence" && matchCount < 3) {
      needsDocReview = true;
      layers.push("doc_review");
    }

    const conf = matchCount >= 2 ? "high" : "medium";
    const nameBit = nameResult.quality === "full" && guestName
      ? " Name verified."
      : nameResult.quality === "partial"
        ? " Name partially matches — staff will confirm."
        : "";
    const addressBit = type === "aadhaar" || (type === "passport" && !isForeignNationality(nationality || "India"))
      ? " Address found."
      : "";

    return {
      valid: true,
      documentType: type,
      confidence: conf,
      nameMatch: nameResult.quality === "full",
      nameMatchQuality: nameResult.quality,
      needsDocReview: nameResult.quality === "partial" || needsDocReview,
      layers,
      message: `${type.replace("_", " ")} detected.${nameBit}${addressBit}`,
    };
  }

  if (expectedCategory === "visa") {
    const { type, matchCount } = detectDocumentType(text);
    if (type === "visa" && matchCount >= 1) {
      return { valid: true, documentType: "visa", confidence: "high", layers, message: "Visa document detected." };
    }
    if (type === "passport" && matchCount >= 1) {
      return { valid: true, documentType: "visa", confidence: "medium", layers, message: "Document accepted (passport with visa)." };
    }
    layers.push("visa_unidentified");
    return {
      valid: true,
      documentType: "unknown",
      confidence: "low",
      needsDocReview: true,
      layers,
      message: "Could not identify this as a visa automatically. You can still submit — staff will verify.",
    };
  }

  return {
    valid: true,
    documentType: "unknown",
    confidence: "low",
    needsDocReview: true,
    layers: ["doc_review"],
    message: "Document accepted for staff review.",
  };
}

function unavailableResult(): ValidationResult {
  return {
    valid: true,
    documentType: "unknown",
    confidence: "low",
    layers: ["validation_unavailable"],
    message: "Validation service unavailable, document accepted for staff review.",
  };
}

// --- Main validation (images use full 5-layer, PDFs use text-only) ---

export async function validateIdDocument(
  fileBuffer: Buffer,
  expectedCategory: "id" | "visa",
  expectedIdType?: "aadhaar" | "driving_licence" | "passport",
  guestName?: string,
  mimeType?: string,
  nationality?: string | null,
): Promise<ValidationResult> {
  const credentials = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!credentials) {
    return { valid: true, documentType: "unknown", confidence: "low", layers: ["validation_skipped"], message: "Validation skipped (no credentials)" };
  }

  try {
    const fileBase64 = fileBuffer.toString("base64");
    const analysis = await visionAnalyze(fileBase64, mimeType || "image/jpeg");
    const layers: string[] = [];

    if (!analysis.isPdf && analysis.labels.length > 0) {
      const { isDoc, reason } = checkIsDocument(analysis.labels, analysis.objects);
      if (!isDoc) {
        return { valid: false, documentType: "unknown", confidence: "high", layers: ["label_rejected"], message: reason || "This does not appear to be an ID document." };
      }
      layers.push("label_ok");
    }

    const textResult = runTextValidation(analysis.text, expectedCategory, expectedIdType, guestName, nationality);
    layers.push(...(textResult.layers || []));

    if (!textResult.valid) {
      return { ...textResult, layers };
    }

    const isDigiLocker = /digilocker|digi\s*locker|m[\s-]?aadhaar/i.test(analysis.text);
    let spoofWarning = false;
    if (!analysis.isPdf && analysis.safeSearch) {
      if (isDigiLocker) {
        layers.push("digilocker_trusted");
      } else {
        const { safe, reason } = checkSafeSearch(analysis.safeSearch);
        if (!safe) {
          return { valid: false, documentType: textResult.documentType, confidence: "high", layers: [...layers, "safesearch_rejected"], message: reason };
        }
        if (analysis.safeSearch.spoof === "LIKELY") {
          spoofWarning = true;
          layers.push("spoof_warning");
        }
      }
      layers.push("safesearch_ok");
    }

    return { ...textResult, layers, message: textResult.message, ocrText: analysis.text, spoofWarning };
  } catch (error) {
    console.error("Vision API error:", error);
    return unavailableResult();
  }
}

/** Text-only validation for PDFs parsed externally */
export function validateIdFromText(
  text: string,
  expectedCategory: "id" | "visa",
  expectedIdType?: "aadhaar" | "driving_licence" | "passport",
  guestName?: string,
  nationality?: string | null,
): ValidationResult {
  return runTextValidation(text, expectedCategory, expectedIdType, guestName, nationality);
}

/** Validate multiple files together (combines OCR text for name + address) */
export async function validateMultipleFiles(
  files: { buffer: Buffer; mimeType: string }[],
  expectedCategory: "id" | "visa",
  expectedIdType?: "aadhaar" | "driving_licence" | "passport",
  guestName?: string,
  nationality?: string | null,
): Promise<ValidationResult> {
  const credentials = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!credentials) {
    return { valid: true, documentType: "unknown", confidence: "low", layers: ["validation_skipped"], message: "Validation skipped (no credentials)" };
  }

  try {
    const allTexts: string[] = [];
    const allLabels: string[] = [];
    const allObjects: string[] = [];
    let safeSearch: VisionAnalysis["safeSearch"] | null = null;

    for (const file of files) {
      const base64 = file.buffer.toString("base64");
      const analysis = await visionAnalyze(base64, file.mimeType);
      allTexts.push(analysis.text);
      allLabels.push(...analysis.labels);
      allObjects.push(...analysis.objects);
      if (analysis.safeSearch && !safeSearch) safeSearch = analysis.safeSearch;
    }

    const combinedText = allTexts.join("\n");
    const layers: string[] = [];

    if (allLabels.length > 0) {
      const { isDoc, reason } = checkIsDocument(allLabels, allObjects);
      if (!isDoc) {
        return { valid: false, documentType: "unknown", confidence: "high", layers: ["label_rejected"], message: reason || "This does not appear to be an ID document." };
      }
      layers.push("label_ok");
    }

    const textResult = runTextValidation(combinedText, expectedCategory, expectedIdType, guestName, nationality);
    layers.push(...(textResult.layers || []));

    if (!textResult.valid) {
      return { ...textResult, layers };
    }

    if (textResult.documentType === "aadhaar" && allTexts.length > 1) {
      layers.push("aadhaar_multi_page");
    }

    const isDigiLockerMulti = /digilocker|digi\s*locker|m[\s-]?aadhaar/i.test(combinedText);
    let spoofWarningMulti = false;
    if (safeSearch) {
      if (isDigiLockerMulti) {
        layers.push("digilocker_trusted");
      } else {
        const { safe, reason } = checkSafeSearch(safeSearch);
        if (!safe) {
          return { valid: false, documentType: textResult.documentType, confidence: "high", layers: [...layers, "safesearch_rejected"], message: reason };
        }
        if (safeSearch.spoof === "LIKELY") {
          spoofWarningMulti = true;
          layers.push("spoof_warning");
        }
      }
      layers.push("safesearch_ok");
    }

    return { ...textResult, layers, message: textResult.message, ocrText: combinedText, spoofWarning: spoofWarningMulti };
  } catch (error) {
    console.error("Multi-file validation error:", error);
    return unavailableResult();
  }
}

/** Map validation outcome to checkins.verified for self check-in persistence. */
export function verifiedFromIdValidation(result: {
  layers?: string[];
  nameMatchQuality?: NameMatchQuality;
  needsDocReview?: boolean;
  spoofWarning?: boolean;
}): "yes" | "pending" | "spoof_warning" | "name_review" | "doc_review" {
  const layers = result.layers || [];
  if (layers.includes("validation_unavailable") || layers.includes("validation_skipped")) return "pending";
  if (result.spoofWarning || layers.includes("spoof_warning")) return "spoof_warning";
  if (
    result.nameMatchQuality === "partial"
    || result.nameMatchQuality === "none"
    || layers.includes("name_partial")
    || layers.includes("name_mismatch")
  ) {
    return "name_review";
  }
  if (result.needsDocReview || layers.includes("doc_review") || layers.includes("unreadable") || layers.includes("visa_unidentified")) {
    return "doc_review";
  }
  return "yes";
}
