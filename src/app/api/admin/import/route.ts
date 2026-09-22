import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getDb } from "@/db";
import { checkins } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { getMonthKey, addSystemLog } from "@/db/queries";
import { authenticateUser } from "@/lib/auth";
import { actionAllowed } from "@/lib/actionPermissions";

const MAX_ROWS = 500;

const TEMPLATE_COLUMNS = [
  { header: "first_name", description: "Guest first name (required)" },
  { header: "last_name", description: "Guest last name (required)" },
  { header: "contact", description: "Phone number (required) - format as text in Excel" },
  { header: "arrival_date", description: "YYYY-MM-DD (required)" },
  { header: "arrival_time", description: "HH:MM" },
  { header: "persons", description: "Number of guests" },
  { header: "staying_days", description: "Number of days" },
  { header: "coming_from", description: "City/place" },
  { header: "nationality", description: "e.g., Indian, British" },
  { header: "id_type", description: "aadhaar / driving_licence / passport" },
  { header: "id_card_link", description: "Google Drive URL(s), pipe | for multiple" },
  { header: "visa_link", description: "Google Drive URL(s) for visa docs" },
  { header: "emergency_name", description: "Emergency contact name" },
  { header: "emergency_phone", description: "Emergency contact phone" },
  { header: "booking_platform", description: "e.g., Booking.com, Walk-in" },
  { header: "booking_id", description: "OTA reference number" },
  { header: "dob", description: "Date of birth YYYY-MM-DD or DD/MM/YYYY" },
  { header: "status", description: "active / checked_out (default: checked_out)" },
  { header: "checked_out_at", description: "YYYY-MM-DD (checkout date)" },
  { header: "verified", description: "yes / no / pending (default: yes if id_card_link present)" },
];

const VALID_STATUS = ["active", "checked_out", "cancelled"];
const VALID_ID_TYPES = ["aadhaar", "driving_licence", "passport", ""];
const VALID_VERIFIED = ["yes", "no", "pending"];

function generateBookingId(): string {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "");
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `GOKO${dateStr}${random}`;
}

function deriveCreatedMonth(arrivalDate: string): string {
  const date = new Date(arrivalDate);
  if (isNaN(date.getTime())) return getMonthKey();
  const months = [
    "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
    "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
  ];
  return `${months[date.getUTCMonth()]}-${date.getUTCFullYear()}`;
}

/**
 * Safely convert any cell value to a trimmed string.
 * Handles: numbers, booleans, null, undefined, Date objects, Excel serial dates.
 */
function cellToString(val: unknown): string {
  if (val === null || val === undefined) return "";
  if (typeof val === "number") return String(val);
  if (typeof val === "boolean") return val ? "yes" : "no";
  return String(val).trim();
}

/**
 * Normalize a contact number: remove spaces, dashes, dots. Keep leading +.
 * Ensures consistent format for duplicate detection.
 */
function normalizeContact(raw: string): string {
  return raw.replace(/[\s.\-()]/g, "");
}

/**
 * Parse a date value that might be an Excel serial number, a JS Date, or a string.
 * Returns YYYY-MM-DD or empty string.
 */
function parseDate(val: unknown): string {
  if (val === null || val === undefined || val === "") return "";

  // Excel serial number (number of days since 1900-01-01, with the Lotus 1-2-3 bug)
  if (typeof val === "number") {
    const jsDate = XLSX.SSF.parse_date_code(val);
    if (jsDate) {
      const y = String(jsDate.y).padStart(4, "0");
      const m = String(jsDate.m).padStart(2, "0");
      const d = String(jsDate.d).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }
    return "";
  }

  const str = String(val).trim();
  if (!str) return "";

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  // DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = str.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (dmyMatch) {
    return `${dmyMatch[3]}-${dmyMatch[2].padStart(2, "0")}-${dmyMatch[1].padStart(2, "0")}`;
  }

  // Try native parse as last resort
  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }

  return str;
}

function generateTemplate(): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const headers = TEMPLATE_COLUMNS.map((c) => c.header);
  const descriptions = TEMPLATE_COLUMNS.map((c) => c.description);
  const ws = XLSX.utils.aoa_to_sheet([headers, descriptions]);
  ws["!cols"] = TEMPLATE_COLUMNS.map((c) => ({
    wch: Math.max(c.header.length, c.description.length) + 2,
  }));

  // Format the contact column as text to prevent Excel from mangling phone numbers
  // Column B (index 1) = contact
  const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
  for (let r = range.s.r; r <= range.e.r; r++) {
    const addr = XLSX.utils.encode_cell({ r, c: 1 });
    if (ws[addr]) ws[addr].z = "@";
  }

  XLSX.utils.book_append_sheet(wb, ws, "Check-in Records");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

// POST - handles both template download (JSON body) and import (multipart)
export async function POST(req: NextRequest) {
  const contentType = req.headers.get("content-type") || "";

  // Template download request (JSON body with action: "template")
  if (contentType.includes("application/json")) {
    const body = await req.json();
    const auth = await authenticateUser("", typeof body.username === "string" ? body.username : undefined);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (actionAllowed(auth.role, auth.permissions, "canAddCheckin") !== "allowed") return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });

    const buf = generateTemplate();
    return new NextResponse(buf, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="checkin_import_template.xlsx"',
      },
    });
  }

  // Import request (multipart form data)
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const username = String(formData.get("username") || "") || undefined;
  const auth = await authenticateUser("", username);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (actionAllowed(auth.role, auth.permissions, "canAddCheckin") !== "allowed") return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });

  if (!file || file.size === 0) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: "File too large (max 5MB)" }, { status: 400 });
  }

  try {
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: "array", cellDates: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) {
      return NextResponse.json({ error: "Empty workbook" }, { status: 400 });
    }

    // Use raw: true to get unformatted values, then handle type conversion ourselves
    const rawRows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, {
      defval: "",
      raw: true,
    });

    // Skip the description/helper row
    const rows = rawRows.filter((row) => {
      const name = cellToString(row.name);
      return name && !name.toLowerCase().includes("required") && !name.toLowerCase().includes("guest full name");
    });

    if (rows.length === 0) {
      return NextResponse.json({ error: "No data rows found in the file" }, { status: 400 });
    }

    if (rows.length > MAX_ROWS) {
      return NextResponse.json(
        { error: `Too many rows (${rows.length}). Maximum ${MAX_ROWS} rows per upload.` },
        { status: 400 }
      );
    }

    const db = getDb();
    const results = {
      total: rows.length,
      inserted: 0,
      skipped: 0,
      failed: [] as { row: number; reason: string }[],
    };

    const BATCH_SIZE = 50;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);

      for (let j = 0; j < batch.length; j++) {
        const rowIndex = i + j + 3; // +1 header, +1 description row, +1 for 1-indexed Excel
        const row = batch[j];

        try {
          const firstName = cellToString(row.first_name);
          const lastName = cellToString(row.last_name);
          const legacyName = cellToString(row.name);
          const name = firstName && lastName
            ? `${firstName} ${lastName}`
            : firstName || lastName || legacyName;
          const rawContact = cellToString(row.contact);
          const contact = normalizeContact(rawContact);
          const arrivalDate = parseDate(row.arrival_date);

          if (!name) {
            results.failed.push({ row: rowIndex, reason: "Missing name" });
            continue;
          }
          if (!contact) {
            results.failed.push({ row: rowIndex, reason: "Missing contact" });
            continue;
          }
          if (!arrivalDate) {
            results.failed.push({ row: rowIndex, reason: "Missing arrival_date" });
            continue;
          }

          // Validate date is parseable
          const dateCheck = new Date(arrivalDate);
          if (isNaN(dateCheck.getTime())) {
            results.failed.push({ row: rowIndex, reason: `Invalid arrival_date: ${cellToString(row.arrival_date)}` });
            continue;
          }

          // Validate enum fields
          const idType = cellToString(row.id_type).toLowerCase();
          if (idType && !VALID_ID_TYPES.includes(idType)) {
            results.failed.push({ row: rowIndex, reason: `Invalid id_type: "${idType}". Use: aadhaar, driving_licence, or passport` });
            continue;
          }

          const status = cellToString(row.status).toLowerCase() || "checked_out";
          if (!VALID_STATUS.includes(status)) {
            results.failed.push({ row: rowIndex, reason: `Invalid status: "${status}". Use: active, checked_out, or cancelled` });
            continue;
          }

          // Duplicate check using normalized contact
          const existing = await db
            .select({ id: checkins.id })
            .from(checkins)
            .where(
              and(
                sql`LOWER(${checkins.name}) = LOWER(${name})`,
                eq(checkins.contact, contact),
                eq(checkins.arrivalDate, arrivalDate)
              )
            )
            .limit(1);

          if (existing.length > 0) {
            results.skipped++;
            continue;
          }

          // Build the record
          const idCardLink = cellToString(row.id_card_link);
          const verified = cellToString(row.verified).toLowerCase() || (idCardLink ? "yes" : "pending");
          if (!VALID_VERIFIED.includes(verified)) {
            results.failed.push({ row: rowIndex, reason: `Invalid verified value: "${verified}". Use: yes, no, or pending` });
            continue;
          }

          const checkedOutAt = parseDate(row.checked_out_at);

          const rawDob = cellToString(row.dob);
          const dob = rawDob ? parseDate(rawDob) || rawDob : "";

          const record = {
            submittedAt: new Date().toISOString(),
            arrivalDate,
            arrivalTime: cellToString(row.arrival_time),
            name,
            persons: cellToString(row.persons),
            contact,
            stayingDays: cellToString(row.staying_days),
            comingFrom: cellToString(row.coming_from),
            nationality: cellToString(row.nationality),
            emergencyName: cellToString(row.emergency_name),
            emergencyPhone: normalizeContact(cellToString(row.emergency_phone)),
            idType,
            idCardLink,
            visaLink: cellToString(row.visa_link),
            verified,
            status,
            checkedOutAt,
            formCData: "",
            bookingPlatform: cellToString(row.booking_platform),
            bookingId: cellToString(row.booking_id) || generateBookingId(),
            dob,
            createdMonth: deriveCreatedMonth(arrivalDate),
          };

          await db.insert(checkins).values(record);
          results.inserted++;
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "Database insert failed";
          results.failed.push({ row: rowIndex, reason: message });
        }
      }
    }

    addSystemLog({
      level: "info",
      source: "bulk-import",
      message: `Bulk import: ${results.inserted} inserted, ${results.skipped} skipped, ${results.failed.length} failed out of ${results.total} rows`,
    }).catch(() => {});

    return NextResponse.json(results);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Import failed";
    addSystemLog({
      level: "error",
      source: "bulk-import",
      message,
    }).catch(() => {});
    return NextResponse.json(
      { error: "Failed to process file. Ensure it's a valid .xlsx file." },
      { status: 500 }
    );
  }
}
