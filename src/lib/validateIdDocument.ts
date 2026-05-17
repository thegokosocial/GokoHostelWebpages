import { google } from "googleapis";

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
};

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
  expectedCategory: "id" | "visa"
): Promise<ValidationResult> {
  const credentials = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!credentials) {
    return { valid: true, documentType: "unknown", confidence: "low", message: "Validation skipped (no credentials)" };
  }

  try {
    const key = JSON.parse(credentials);
    const privateKey = key.private_key.replace(/\\n/g, "\n");
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: key.client_email,
        private_key: privateKey,
      },
      scopes: ["https://www.googleapis.com/auth/cloud-vision"],
    });

    const vision = google.vision({ version: "v1", auth: auth as any });

    const response = await vision.images.annotate({
      requestBody: {
        requests: [
          {
            image: { content: imageBuffer.toString("base64") },
            features: [
              { type: "TEXT_DETECTION", maxResults: 1 },
              { type: "DOCUMENT_TEXT_DETECTION", maxResults: 1 },
            ],
          },
        ],
      },
    });

    const annotations = response.data.responses?.[0];
    const fullText = annotations?.fullTextAnnotation?.text || annotations?.textAnnotations?.[0]?.description || "";

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
        return {
          valid: true,
          documentType: type,
          confidence: "high",
          message: `${type.replace("_", " ")} detected successfully.`,
        };
      }
      if (validIdTypes.includes(type) && matchCount === 1) {
        return {
          valid: true,
          documentType: type,
          confidence: "medium",
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
