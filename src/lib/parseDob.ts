/**
 * Extract Date of Birth from ID document OCR text.
 * Supports Aadhaar, Driving Licence, and Passport (via MRZ or free-text).
 * Returns DOB in DD/MM/YYYY format, or null if not found.
 */

import { parsePassportMRZ } from "./parsePassportData";

const DATE_DMY_PATTERN = /(\d{1,2})[\/.\-\s](\d{1,2})[\/.\-\s](\d{2,4})/;
const DATE_ISO_PATTERN = /(\d{4})-(\d{1,2})-(\d{1,2})/;

function normalizeYear(y: string): string {
  if (y.length === 4) return y;
  const n = parseInt(y);
  return n > 50 ? `19${y}` : `20${y}`;
}

function formatDob(dd: string, mm: string, yyyy: string): string {
  return `${dd.padStart(2, "0")}/${mm.padStart(2, "0")}/${yyyy}`;
}

function extractDateAfterLabel(text: string, ...labels: string[]): string | null {
  for (const label of labels) {
    const isoRegex = new RegExp(`${label}[^\\d]{0,40}?${DATE_ISO_PATTERN.source}`, "i");
    const isoM = text.match(isoRegex);
    if (isoM) {
      return formatDob(isoM[3], isoM[2], isoM[1]);
    }

    const dmyRegex = new RegExp(`${label}[^\\d]{0,40}?${DATE_DMY_PATTERN.source}`, "i");
    const dmyM = text.match(dmyRegex);
    if (dmyM) {
      return formatDob(dmyM[1], dmyM[2], normalizeYear(dmyM[3]));
    }
  }
  return null;
}

/** Find a standalone YYYY-MM-DD date on its own line (DigiLocker Aadhaar format) */
function extractStandaloneIsoDate(text: string): string | null {
  const lines = text.split(/\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    const m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      const y = parseInt(m[1]);
      if (y >= 1920 && y <= 2020) {
        return formatDob(m[3], m[2], m[1]);
      }
    }
  }
  return null;
}

function parseAadhaarDob(text: string): string | null {
  const labels = [
    "DOB\\s*:?",
    "D\\.?O\\.?B\\.?\\s*:?",
    "date\\s*of\\s*birth\\s*:?",
    "birth\\s*:?",
    "जन्म\\s*(?:तिथि|दिनांक)\\s*:?",
    "जन्मतिथि\\s*:?",
  ];
  const result = extractDateAfterLabel(text, ...labels);
  if (result) return result;

  const yobMatch = text.match(/(?:year\s*of\s*birth|YOB)\s*:?\s*(\d{4})/i);
  if (yobMatch) {
    return `01/01/${yobMatch[1]}`;
  }

  // DigiLocker Aadhaar: DOB appears as standalone YYYY-MM-DD on its own line
  const standalone = extractStandaloneIsoDate(text);
  if (standalone) return standalone;

  return null;
}

function parseDrivingLicenceDob(text: string): string | null {
  const labels = [
    "DOB\\s*:?",
    "D\\.?O\\.?B\\.?\\s*:?",
    "date\\s*of\\s*birth\\s*:?",
    "birth\\s*:?",
  ];
  const result = extractDateAfterLabel(text, ...labels);
  if (result) {
    // OCR sometimes linearizes a DL's two-column layout as "Issued on … DoB …"
    // and returns the issue date for the later DOB label. Prefer a DOB candidate
    // that is not also explicitly labelled as an issue date.
    const issueDates = [
      extractDateAfterLabel(text, "issued\\s*on\\s*: ?", "date\\s*of\\s*issue\\s*: ?", "issue\\s*date\\s*: ?"),
    ].filter(Boolean) as string[];
    if (!issueDates.some((date) => dobsMatch(date, result))) return result;
    const dobCandidates = text.match(/(?:DOB|D\.?O\.?B\.?|date\s*of\s*birth)[^\d]{0,80}(\d{1,2}[\/\.\-\s]\d{1,2}[\/\.\-\s]\d{2,4})/gi) || [];
    for (const candidate of dobCandidates) {
      const date = candidate.match(DATE_DMY_PATTERN);
      if (date) {
        const parsed = formatDob(date[1], date[2], normalizeYear(date[3]));
        if (!issueDates.some((issueDate) => dobsMatch(issueDate, parsed))) return parsed;
      }
    }
  }

  const standalone = extractStandaloneIsoDate(text);
  if (standalone) return standalone;

  return null;
}

function parsePassportDob(text: string): string | null {
  const parsed = parsePassportMRZ(text);
  if (parsed.dateOfBirth) return parsed.dateOfBirth;
  return null;
}

export function parseDobFromOcr(ocrText: string, idType: string): string | null {
  if (!ocrText || ocrText.trim().length < 10) return null;

  const parsed = (() => {
    switch (idType) {
    case "aadhaar":
        return parseAadhaarDob(ocrText);
    case "driving_licence":
        return parseDrivingLicenceDob(ocrText);
    case "passport":
        return parsePassportDob(ocrText);
    default:
        return parseAadhaarDob(ocrText) || parseDrivingLicenceDob(ocrText) || parsePassportDob(ocrText);
    }
  })();
  return parsed ? normalizeDob(parsed) : null;
}

/**
 * Normalize a DOB string (various formats) to DD/MM/YYYY for comparison.
 */
function normalizeDob(dob: string): string | null {
  if (!dob) return null;
  const slashMatch = dob.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) return validDobParts(slashMatch[1], slashMatch[2], slashMatch[3]);
  const isoMatch = dob.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) return validDobParts(isoMatch[3], isoMatch[2], isoMatch[1]);
  const dashDmy = dob.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dashDmy) return validDobParts(dashDmy[1], dashDmy[2], dashDmy[3]);
  return null;
}

function validDobParts(dd: string, mm: string, yyyy: string): string | null {
  const day = Number(dd);
  const month = Number(mm);
  const year = Number(yyyy);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 1900 || year > 2100 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  if (date.getTime() > Date.now()) return null;
  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
}

/**
 * Compare two DOB strings for equality after normalizing formats.
 */
export function dobsMatch(dob1: string, dob2: string): boolean {
  const n1 = normalizeDob(dob1);
  const n2 = normalizeDob(dob2);
  if (!n1 || !n2) return false;
  return n1 === n2;
}

/** Select the manual DOB first, then a valid DOB extracted from the ID. */
export function resolveDobForChecks(manualDob?: string | null, dobFromId?: string | null): string | null {
  return normalizeDob(manualDob || "") || normalizeDob(dobFromId || "");
}

/**
 * Calculate age from a DOB string in DD/MM/YYYY format.
 * Returns null if the date can't be parsed.
 */
export function getAgeFromDob(dob: string): number | null {
  const normalized = normalizeDob(dob);
  if (!normalized) return null;

  const slashMatch = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!slashMatch) return null;
  const dd = parseInt(slashMatch[1]);
  const mm = parseInt(slashMatch[2]);
  const yyyy = parseInt(slashMatch[3]);

  const today = new Date();
  let age = today.getFullYear() - yyyy;
  const monthDiff = (today.getMonth() + 1) - mm;
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dd)) {
    age--;
  }
  return age >= 0 ? age : null;
}
