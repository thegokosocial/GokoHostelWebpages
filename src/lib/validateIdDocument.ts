import { visionDetectText } from "./googleApiFetch";

const AADHAAR_PATTERNS = [
  /aadhaar/i,
  /आधार/,
  /unique\s*identification/i,
  /uidai/i,
  /\b\d{4}\s?\d{4}\s?\d{4}\b/,
];

const DRIVING_LICENCE_PATTERNS = [
  /driving\s*licen[cs]e/i,
  /transport\s*(department|authority)/i,
  /motor\s*vehicle/i,
  /\bDL\b/,
  /\bLMV\b/i,
  /licence\s*no/i,
  /valid\s*(till|upto|from)/i,
];

const PASSPORT_PATTERNS = [
  /passport/i,
  /republic\s*of\s*india/i,
  /travel\s*document/i,
  /nationality/i,
  /date\s*of\s*expiry/i,
  /place\s*of\s*(birth|issue)/i,
  /\b[A-Z]\d{7}\b/,
];

const VISA_PATTERNS = [
  /visa/i,
  /immigration/i,
  /entry\s*permit/i,
  /valid\s*(for|until|from)/i,
  /consulate|embassy/i,
  /type\s*of\s*visa/i,
  /duration\s*of\s*stay/i,
];

export type DocumentType = "aadhaar" | "driving_licence" | "passport" | "visa" | "unknown";

export type ValidationResult = {
  valid: boolean;
  documentType: DocumentType;
  confidence: "high" | "medium" | "low";
  message: string;
  nameMatch?: boolean;
};

function checkNameMatch(text: string, guestName?: string): boolean {
  if (!guestName || guestName.trim().length < 2) return true;
  const firstName = guestName.trim().split(/\s+/)[0].toLowerCase();
  if (firstName.length < 2) return true;
  return text.toLowerCase().includes(firstName);
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

export async function validateIdDocument(
  imageBuffer: Buffer,
  expectedCategory: "id" | "visa",
  expectedIdType?: "aadhaar" | "driving_licence" | "passport",
  guestName?: string
): Promise<ValidationResult> {
  const credentials = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!credentials) {
    return { valid: true, documentType: "unknown", confidence: "low", message: "Validation skipped (no credentials)" };
  }

  try {
    const imageBase64 = imageBuffer.toString("base64");
    const fullText = await visionDetectText(imageBase64);

    if (!fullText || fullText.length < 10) {
      return {
        valid: false,
        documentType: "unknown",
        confidence: "high",
        message: "Could not detect any text in the image. Please upload a clear photo of your ID document.",
      };
    }

    const { type, matchCount } = detectDocumentType(fullText);

    if (expectedCategory === "id") {
      const validIdTypes: DocumentType[] = ["aadhaar", "driving_licence", "passport"];
      if (validIdTypes.includes(type) && matchCount >= 2) {
        if (expectedIdType && type !== expectedIdType) {
          return {
            valid: false,
            documentType: type,
            confidence: "high",
            message: `You selected "${expectedIdType.replace("_", " ")}" but this appears to be a ${type.replace("_", " ")}. Please select the correct ID type or upload the right document.`,
          };
        }
        const nameMatched = checkNameMatch(fullText, guestName);
        if (guestName && !nameMatched) {
          return {
            valid: false,
            documentType: type,
            confidence: "high",
            nameMatch: false,
            message: `Name "${guestName.split(/\s+/)[0]}" not found on the document. Please upload an ID that matches the name you entered.`,
          };
        }
        return {
          valid: true,
          documentType: type,
          confidence: "high",
          nameMatch: true,
          message: `${type.replace("_", " ")} detected successfully.${nameMatched && guestName ? " Name verified." : ""}`,
        };
      }
      if (validIdTypes.includes(type) && matchCount === 1) {
        if (expectedIdType && type !== expectedIdType) {
          return {
            valid: false,
            documentType: type,
            confidence: "medium",
            message: `You selected "${expectedIdType.replace("_", " ")}" but this looks like a ${type.replace("_", " ")}. Please check your selection.`,
          };
        }
        const nameMatched = checkNameMatch(fullText, guestName);
        if (guestName && !nameMatched) {
          return {
            valid: false,
            documentType: type,
            confidence: "medium",
            nameMatch: false,
            message: `Name "${guestName.split(/\s+/)[0]}" not found on the document. Please upload your own ID.`,
          };
        }
        return {
          valid: true,
          documentType: type,
          confidence: "medium",
          nameMatch: true,
          message: `Document appears to be a ${type.replace("_", " ")}. Please ensure the image is clear.`,
        };
      }
      return {
        valid: false,
        documentType: "unknown",
        confidence: "medium",
        message: "Could not identify this as a valid ID (Aadhaar, Driving Licence, or Passport). Please upload a clear, readable photo of your government-issued ID.",
      };
    }

    if (expectedCategory === "visa") {
      if (type === "visa" && matchCount >= 1) {
        return { valid: true, documentType: "visa", confidence: "high", message: "Visa document detected." };
      }
      if (type === "passport" && matchCount >= 1) {
        return { valid: true, documentType: "visa", confidence: "medium", message: "Document accepted (passport with visa)." };
      }
      return {
        valid: false,
        documentType: "unknown",
        confidence: "medium",
        message: "Could not identify this as a valid visa document. Please upload a clear photo of your visa.",
      };
    }

    return { valid: false, documentType: "unknown", confidence: "low", message: "Validation failed." };
  } catch (error) {
    console.error("Vision API error:", error);
    return { valid: true, documentType: "unknown", confidence: "low", message: "Validation service unavailable, document accepted." };
  }
}

export function validateIdFromText(
  text: string,
  expectedCategory: "id" | "visa",
  expectedIdType?: "aadhaar" | "driving_licence" | "passport",
  guestName?: string
): ValidationResult {
  if (!text || text.trim().length < 10) {
    return {
      valid: false,
      documentType: "unknown",
      confidence: "high",
      message: "Could not extract readable text from PDF. Please upload a clear document.",
    };
  }

  const { type, matchCount } = detectDocumentType(text);

  if (expectedCategory === "id") {
    const validIdTypes: DocumentType[] = ["aadhaar", "driving_licence", "passport"];
    if (validIdTypes.includes(type) && matchCount >= 2) {
      if (expectedIdType && type !== expectedIdType) {
        return {
          valid: false,
          documentType: type,
          confidence: "high",
          message: `You selected "${expectedIdType.replace("_", " ")}" but this PDF appears to be a ${type.replace("_", " ")}. Please select the correct ID type.`,
        };
      }
      const nameMatched = checkNameMatch(text, guestName);
      if (guestName && !nameMatched) {
        return {
          valid: false,
          documentType: type,
          confidence: "high",
          nameMatch: false,
          message: `Name "${guestName.split(/\s+/)[0]}" not found in the PDF. Please upload an ID that matches your name.`,
        };
      }
      return {
        valid: true,
        documentType: type,
        confidence: "high",
        nameMatch: true,
        message: `${type.replace("_", " ")} detected successfully from PDF.${nameMatched && guestName ? " Name verified." : ""}`,
      };
    }
    if (validIdTypes.includes(type) && matchCount === 1) {
      if (expectedIdType && type !== expectedIdType) {
        return {
          valid: false,
          documentType: type,
          confidence: "medium",
          message: `You selected "${expectedIdType.replace("_", " ")}" but this looks like a ${type.replace("_", " ")}.`,
        };
      }
      const nameMatched = checkNameMatch(text, guestName);
      if (guestName && !nameMatched) {
        return {
          valid: false,
          documentType: type,
          confidence: "medium",
          nameMatch: false,
          message: `Name "${guestName.split(/\s+/)[0]}" not found in the PDF. Please upload your own ID.`,
        };
      }
      return {
        valid: true,
        documentType: type,
        confidence: "medium",
        nameMatch: true,
        message: `Document appears to be a ${type.replace("_", " ")} (PDF).`,
      };
    }
    return {
      valid: false,
      documentType: "unknown",
      confidence: "medium",
      message: "Could not identify this PDF as a valid ID (Aadhaar, Driving Licence, or Passport).",
    };
  }

  if (expectedCategory === "visa") {
    if (type === "visa" && matchCount >= 1) {
      return { valid: true, documentType: "visa", confidence: "high", message: "Visa document detected from PDF." };
    }
    return {
      valid: false,
      documentType: "unknown",
      confidence: "medium",
      message: "Could not identify this PDF as a valid visa document.",
    };
  }

  return { valid: false, documentType: "unknown", confidence: "low", message: "Validation failed." };
}
