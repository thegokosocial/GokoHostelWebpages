import { visionAnalyze, type VisionAnalysis } from "./googleApiFetch";

// --- Enhanced text patterns ---

const AADHAAR_PATTERNS = [
  /aadhaar/i,
  /आधार/,
  /unique\s*identification/i,
  /uidai/i,
  /\b\d{4}\s?\d{4}\s?\d{4}\b/,
  /\bVID\b.*\d{4}\s?\d{4}\s?\d{4}\s?\d{4}/,
  /enrol(l)?ment\s*(no|number)/i,
  /generated\s*date/i,
  /government\s*of\s*india/i,
];

const DRIVING_LICENCE_PATTERNS = [
  /driving\s*licen[cs]e/i,
  /transport\s*(department|authority|commissioner)/i,
  /motor\s*vehicle/i,
  /\bDL\b/,
  /\bLMV\b/i,
  /\bMCWG\b/i,
  /licence\s*no/i,
  /valid\s*(till|upto|from|to)/i,
  /sarathi/i,
  /\b(KA|MH|TN|AP|TS|DL|UP|GJ|RJ|MP|WB|KL|PB|HR|OR|JH|CG|BR|GA)\d{2}\s?\d{11,13}\b/,
  /date\s*of\s*issue/i,
  /class\s*of\s*vehicle/i,
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

export type DocumentType = "aadhaar" | "driving_licence" | "passport" | "visa" | "unknown";

export type ValidationResult = {
  valid: boolean;
  documentType: DocumentType;
  confidence: "high" | "medium" | "low";
  message: string;
  nameMatch?: boolean;
  layers?: string[];
  needsBackSide?: boolean;
};

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
  if (high.includes(safeSearch.spoof)) {
    return { safe: false, reason: "Image appears to be manipulated or spoofed. Please upload an original photo of your ID." };
  }
  if (high.includes(safeSearch.violence)) {
    return { safe: false, reason: "Image contains inappropriate content." };
  }
  return { safe: true, reason: "" };
}

function checkNameMatch(text: string, guestName?: string): boolean {
  if (!guestName || guestName.trim().length < 2) return true;
  const textLower = text.toLowerCase();
  const parts = guestName.trim().split(/\s+/);

  const firstName = parts[0]?.toLowerCase();
  if (firstName && firstName.length >= 2 && textLower.includes(firstName)) return true;

  if (parts.length > 1) {
    const lastName = parts[parts.length - 1]?.toLowerCase();
    if (lastName && lastName.length >= 2 && textLower.includes(lastName)) return true;
  }

  return false;
}

const AADHAAR_ADDRESS_PATTERNS = [
  /\baddress\b/i,
  /\bS\/O\b|\bD\/O\b|\bW\/O\b|\bC\/O\b/,
  /pin\s*:?\s*\d{6}/i,
  /\b\d{6}\b/,
  /\b(street|road|lane|nagar|colony|apartment|flat|house|floor|sector|block|village|district|taluk|mandal|ward)\b/i,
  /\b(karnataka|maharashtra|tamil\s*nadu|kerala|andhra|telangana|gujarat|rajasthan|uttar\s*pradesh|madhya\s*pradesh|west\s*bengal|bihar|odisha|punjab|haryana|goa)\b/i,
];

function hasAadhaarAddress(text: string): boolean {
  const matchCount = AADHAAR_ADDRESS_PATTERNS.filter((p) => p.test(text)).length;
  return matchCount >= 2;
}

function detectDocumentType(text: string): { type: DocumentType; matchCount: number } {
  const checks: { type: DocumentType; patterns: RegExp[] }[] = [
    { type: "aadhaar", patterns: AADHAAR_PATTERNS },
    { type: "driving_licence", patterns: DRIVING_LICENCE_PATTERNS },
    { type: "passport", patterns: PASSPORT_PATTERNS },
    { type: "visa", patterns: VISA_PATTERNS },
  ];

  let bestMatch: { type: DocumentType; matchCount: number } = { type: "unknown", matchCount: 0 };
  for (const check of checks) {
    const matchCount = check.patterns.filter((p) => p.test(text)).length;
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
): ValidationResult {
  if (!text || text.trim().length < 10) {
    return { valid: false, documentType: "unknown", confidence: "high", message: "Could not detect readable text. Please upload a clear photo of your ID." };
  }

  const { type, matchCount } = detectDocumentType(text);
  const layers: string[] = ["text_detection"];

  if (expectedCategory === "id") {
    const validIdTypes: DocumentType[] = ["aadhaar", "driving_licence", "passport"];
    if (!validIdTypes.includes(type) || matchCount === 0) {
      return { valid: false, documentType: "unknown", confidence: "medium", layers, message: "Could not identify this as a valid ID (Aadhaar, Driving Licence, or Passport). Please upload a clear, readable photo." };
    }

    if (expectedIdType && type !== expectedIdType) {
      layers.push("type_mismatch");
      return { valid: false, documentType: type, confidence: "high", layers, message: `You selected "${expectedIdType.replace("_", " ")}" but this appears to be a ${type.replace("_", " ")}. Please change your ID type selection to "${type.replace("_", " ")}" to proceed.` };
    }
    layers.push("type_match");

    const nameMatched = checkNameMatch(text, guestName);
    if (guestName && !nameMatched) {
      layers.push("name_mismatch");
      return { valid: false, documentType: type, confidence: "high", nameMatch: false, layers, message: `Your name was not found on the document. Please upload your own ID.` };
    }
    if (guestName) layers.push("name_verified");

    if (type === "aadhaar" && !hasAadhaarAddress(text)) {
      layers.push("address_missing");
      const conf = matchCount >= 2 ? "high" : "medium";
      return {
        valid: true,
        documentType: type,
        confidence: conf,
        nameMatch: true,
        needsBackSide: true,
        layers,
        message: `Aadhaar detected. Name verified. Address not found — please also upload the back side of your Aadhaar.`,
      };
    }

    const conf = matchCount >= 2 ? "high" : "medium";
    return {
      valid: true,
      documentType: type,
      confidence: conf,
      nameMatch: true,
      layers,
      message: `${type.replace("_", " ")} detected.${nameMatched && guestName ? " Name verified." : ""}${type === "aadhaar" ? " Address found." : ""}`,
    };
  }

  if (expectedCategory === "visa") {
    if (type === "visa" && matchCount >= 1) {
      return { valid: true, documentType: "visa", confidence: "high", layers, message: "Visa document detected." };
    }
    if (type === "passport" && matchCount >= 1) {
      return { valid: true, documentType: "visa", confidence: "medium", layers, message: "Document accepted (passport with visa)." };
    }
    return { valid: false, documentType: "unknown", confidence: "medium", layers, message: "Could not identify this as a valid visa document." };
  }

  return { valid: false, documentType: "unknown", confidence: "low", message: "Validation failed." };
}

// --- Main validation (images use full 5-layer, PDFs use text-only) ---

export async function validateIdDocument(
  fileBuffer: Buffer,
  expectedCategory: "id" | "visa",
  expectedIdType?: "aadhaar" | "driving_licence" | "passport",
  guestName?: string,
  mimeType?: string
): Promise<ValidationResult> {
  const credentials = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!credentials) {
    return { valid: true, documentType: "unknown", confidence: "low", message: "Validation skipped (no credentials)" };
  }

  try {
    const { getSettingValue } = await import("./googleApiFetch");
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    if (spreadsheetId) {
      const enabled = await getSettingValue(spreadsheetId, "image_validation");
      if (enabled === "off") {
        return { valid: true, documentType: "unknown", confidence: "low", message: "Validation disabled by admin." };
      }
    }
  } catch {}

  try {
    const fileBase64 = fileBuffer.toString("base64");
    const analysis = await visionAnalyze(fileBase64, mimeType || "image/jpeg");
    const layers: string[] = [];

    // Layer 1: Label/Object detection (images only)
    if (!analysis.isPdf && analysis.labels.length > 0) {
      const { isDoc, reason } = checkIsDocument(analysis.labels, analysis.objects);
      if (!isDoc) {
        return { valid: false, documentType: "unknown", confidence: "high", layers: ["label_rejected"], message: reason || "This does not appear to be an ID document." };
      }
      layers.push("label_ok");
    }

    // Layer 2-4: Text detection + pattern matching + type check + name check
    const textResult = runTextValidation(analysis.text, expectedCategory, expectedIdType, guestName);
    layers.push(...(textResult.layers || []));

    if (!textResult.valid) {
      return { ...textResult, layers };
    }

    // Layer 5: SafeSearch (images only)
    if (!analysis.isPdf && analysis.safeSearch) {
      const { safe, reason } = checkSafeSearch(analysis.safeSearch);
      if (!safe) {
        return { valid: false, documentType: textResult.documentType, confidence: "high", layers: [...layers, "safesearch_rejected"], message: reason };
      }
      layers.push("safesearch_ok");
    }

    return { ...textResult, layers, message: textResult.message };
  } catch (error) {
    console.error("Vision API error:", error);
    return { valid: true, documentType: "unknown", confidence: "low", message: "Validation service unavailable, document accepted." };
  }
}

/** Text-only validation for PDFs parsed externally */
export function validateIdFromText(
  text: string,
  expectedCategory: "id" | "visa",
  expectedIdType?: "aadhaar" | "driving_licence" | "passport",
  guestName?: string
): ValidationResult {
  return runTextValidation(text, expectedCategory, expectedIdType, guestName);
}
