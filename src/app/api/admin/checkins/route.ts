import { NextRequest, NextResponse } from "next/server";
import {
  sheetsGet,
  sheetsAppend,
  sheetsUpdate,
  sheetsGetTabs,
  sheetsDeleteRow,
  sheetsAddTab,
  ensureMonthTab,
  driveDeleteFile,
  getMonthTabName,
  getSettingValue,
  setSettingValue,
  CHECKIN_HEADERS,
} from "@/lib/googleApiFetch";

const BED_HEADERS = ["Dorm Name", "Bed ID", "Position", "Type", "Status", "Guest Name", "Guest Contact", "Check-in Date", "Expected Checkout", "Staying Days"];
const BED_TAB = "Dorms";
const HISTORY_TAB = "BedHistory";

async function ensureBedTabs(spreadsheetId: string) {
  const tabs = await sheetsGetTabs(spreadsheetId);
  if (!tabs.find((t) => t.title === BED_TAB)) {
    await sheetsAddTab(spreadsheetId, BED_TAB);
    await sheetsUpdate(spreadsheetId, `'${BED_TAB}'!A1:J1`, [BED_HEADERS]);
  }
  if (!tabs.find((t) => t.title === HISTORY_TAB)) {
    await sheetsAddTab(spreadsheetId, HISTORY_TAB);
    await sheetsUpdate(spreadsheetId, `'${HISTORY_TAB}'!A1:F1`, [["Timestamp", "Bed ID", "Dorm", "Action", "Guest Name", "Guest Contact"]]);
  }
}

async function logBedHistory(spreadsheetId: string, bedId: string, dorm: string, action: string, guestName: string, guestContact: string) {
  const tabs = await sheetsGetTabs(spreadsheetId);
  if (!tabs.find((t) => t.title === HISTORY_TAB)) return;
  await sheetsAppend(spreadsheetId, `'${HISTORY_TAB}'!A:F`, [[new Date().toISOString(), bedId, dorm, action, guestName, guestContact]]);
}

type UserRole = "admin" | "manager";

function authenticateUser(password: string): UserRole | null {
  if (password === process.env.ADMIN_PASSWORD) return "admin";
  if (password === process.env.MANAGER_PASSWORD) return "manager";
  return null;
}

export async function POST(req: NextRequest) {
  let role: UserRole | null = null;

  try {
    const body = await req.json();
    const { password, action, month } = body;

    role = authenticateUser(password);
    if (!role) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    if (!spreadsheetId) {
      return NextResponse.json({ rows: [], role, tabs: [], currentTab: getMonthTabName(), warning: "Google Sheets not configured" });
    }

    if (action === "list" || !action) {
      const tabName = month || getMonthTabName();
      await ensureMonthTab(spreadsheetId, tabName, CHECKIN_HEADERS);

      const tabs = await sheetsGetTabs(spreadsheetId);
      const tabNames = tabs.map((t) => t.title);

      const allRows = await sheetsGet(spreadsheetId, `'${tabName}'!A:O`);
      const rows = allRows.length > 1 ? allRows.slice(1) : [];

      return NextResponse.json({ rows, role, tabs: tabNames, currentTab: tabName });
    }

    if (action === "add") {
      const { entry } = body;
      if (!entry) return NextResponse.json({ error: "No entry data" }, { status: 400 });

      const tabName = getMonthTabName();
      await ensureMonthTab(spreadsheetId, tabName, CHECKIN_HEADERS);
      await sheetsAppend(spreadsheetId, `'${tabName}'!A:O`, [entry]);

      return NextResponse.json({ success: true });
    }

    if (action === "update") {
      if (role !== "admin") {
        return NextResponse.json({ error: "Only admin can modify entries" }, { status: 403 });
      }

      const { rowIndex, entry, tab } = body;
      const tabName = tab || getMonthTabName();

      if (!entry || rowIndex === undefined) {
        return NextResponse.json({ error: "Missing entry data or row index" }, { status: 400 });
      }

      const rowNumber = rowIndex + 2;
      await sheetsUpdate(spreadsheetId, `'${tabName}'!A${rowNumber}:O${rowNumber}`, [entry]);

      return NextResponse.json({ success: true });
    }

    if (action === "delete") {
      if (role !== "admin") {
        return NextResponse.json({ error: "Only admin can delete entries" }, { status: 403 });
      }

      const { rowIndex, driveFileIds, tab } = body;
      const tabName = tab || getMonthTabName();

      if (driveFileIds && driveFileIds.length > 0) {
        for (const fileId of driveFileIds) {
          try {
            await driveDeleteFile(fileId);
          } catch (err: any) {
            console.error(`Failed to delete Drive file ${fileId}:`, err?.message);
          }
        }
      }

      const tabs = await sheetsGetTabs(spreadsheetId);
      const sheet = tabs.find((t) => t.title === tabName);
      if (sheet) {
        await sheetsDeleteRow(spreadsheetId, sheet.sheetId, rowIndex + 1);
      }

      return NextResponse.json({ success: true });
    }

    if (action === "verifyCheckin") {
      const { rowIndex, verified, tab } = body;
      const tabName = tab || getMonthTabName();
      const rowNum = rowIndex + 2;
      await sheetsUpdate(spreadsheetId, `'${tabName}'!O${rowNum}:O${rowNum}`, [[verified ? "yes" : "no"]]);
      return NextResponse.json({ success: true });
    }

    if (action === "getSetting") {
      const { key } = body;
      const value = await getSettingValue(spreadsheetId, key);
      return NextResponse.json({ value });
    }

    if (action === "setSetting") {
      if (role !== "admin") {
        return NextResponse.json({ error: "Only admin can change settings" }, { status: 403 });
      }
      const { key, value } = body;
      await setSettingValue(spreadsheetId, key, value);
      return NextResponse.json({ success: true });
    }

    // --- Bed Management ---

    if (action === "getBedHistory") {
      await ensureBedTabs(spreadsheetId);
      const allRows = await sheetsGet(spreadsheetId, `'${HISTORY_TAB}'!A:F`);
      const rows = allRows.length > 1 ? allRows.slice(1) : [];
      return NextResponse.json({ rows, role });
    }

    if (action === "getDashboard") {
      await ensureBedTabs(spreadsheetId);
      const tabName = getMonthTabName();
      await ensureMonthTab(spreadsheetId, tabName, CHECKIN_HEADERS);

      const allRows = await sheetsGet(spreadsheetId, `'${tabName}'!A:O`);
      const checkins = allRows.length > 1 ? allRows.slice(1) : [];
      const today = new Date().toISOString().split("T")[0];
      const todayCheckins = checkins.filter((r) => r[1] === today);

      const bedRows = await sheetsGet(spreadsheetId, `'${BED_TAB}'!A:J`);
      const beds = bedRows.length > 1 ? bedRows.slice(1) : [];
      const total = beds.length;
      const occupied = beds.filter((b) => b[4] === "occupied").length;
      const available = beds.filter((b) => b[4] === "available").length;
      const cleanup = beds.filter((b) => b[4] === "cleanup").length;

      const todayCheckoutBeds = beds.map((b, i) => ({ bed: b, idx: i })).filter(({ bed }) => bed[4] === "occupied" && bed[8] && bed[8] <= today);

      const assignedContacts = new Map<string, string>();
      for (const b of beds) {
        if (b[4] === "occupied" && b[6]) assignedContacts.set(b[6], `${b[0]} / ${b[1]}`);
      }

      const todayCheckinsWithBed = todayCheckins.map((r) => ({
        row: r,
        assignedBed: assignedContacts.get(r[5]) || null,
      }));

      const validationValue = await getSettingValue(spreadsheetId, "image_validation");

      return NextResponse.json({
        todayCheckins: todayCheckinsWithBed,
        todayCheckouts: todayCheckoutBeds.map(({ bed, idx }) => ({ name: bed[5], contact: bed[6], bedId: bed[1], dorm: bed[0], bedIdx: idx, expectedCheckout: bed[8] })),
        stats: { total, occupied, available, cleanup },
        validationEnabled: validationValue !== "off",
        role,
      });
    }

    if (action === "getBeds") {
      await ensureBedTabs(spreadsheetId);
      const bedRows = await sheetsGet(spreadsheetId, `'${BED_TAB}'!A:J`);
      const beds = bedRows.length > 1 ? bedRows.slice(1) : [];

      const tabName = getMonthTabName();
      await ensureMonthTab(spreadsheetId, tabName, CHECKIN_HEADERS);
      const allRows = await sheetsGet(spreadsheetId, `'${tabName}'!A:O`);
      const checkins = allRows.length > 1 ? allRows.slice(1) : [];

      const assignedContacts = new Set(beds.filter((b) => b[4] === "occupied" && b[6]).map((b) => b[6]));
      const unassigned = checkins.filter((r) => r[5] && !assignedContacts.has(r[5]));

      return NextResponse.json({ beds, unassigned, role });
    }

    if (action === "assignBed") {
      const { bedIndex, guestName, guestContact, checkinDate, stayingDays } = body;
      if (bedIndex === undefined || !guestName) {
        return NextResponse.json({ error: "Missing data" }, { status: 400 });
      }
      const days = parseInt(stayingDays) || 1;
      const checkin = checkinDate || new Date().toISOString().split("T")[0];
      const checkoutDate = new Date(new Date(checkin).getTime() + days * 86400000).toISOString().split("T")[0];

      const rowNum = bedIndex + 2;
      const bedRows = await sheetsGet(spreadsheetId, `'${BED_TAB}'!A:J`);
      const bed = bedRows[bedIndex + 1];
      if (!bed) return NextResponse.json({ error: "Bed not found" }, { status: 404 });

      await sheetsUpdate(spreadsheetId, `'${BED_TAB}'!E${rowNum}:J${rowNum}`, [["occupied", guestName, guestContact, checkin, checkoutDate, String(days)]]);
      await logBedHistory(spreadsheetId, bed[1], bed[0], "assign", guestName, guestContact);

      return NextResponse.json({ success: true });
    }

    if (action === "checkoutBed") {
      const { bedIndex } = body;
      const rowNum = bedIndex + 2;
      const bedRows = await sheetsGet(spreadsheetId, `'${BED_TAB}'!A:J`);
      const bed = bedRows[bedIndex + 1];
      if (!bed) return NextResponse.json({ error: "Bed not found" }, { status: 404 });

      await logBedHistory(spreadsheetId, bed[1], bed[0], "checkout", bed[5] || "", bed[6] || "");
      await sheetsUpdate(spreadsheetId, `'${BED_TAB}'!E${rowNum}:J${rowNum}`, [["cleanup", "", "", "", "", ""]]);

      return NextResponse.json({ success: true });
    }

    if (action === "markClean") {
      const { bedIndex } = body;
      const rowNum = bedIndex + 2;
      await sheetsUpdate(spreadsheetId, `'${BED_TAB}'!E${rowNum}:J${rowNum}`, [["available", "", "", "", "", ""]]);
      return NextResponse.json({ success: true });
    }

    if (action === "initDorms") {
      if (role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
      const { dormName, bedCount, bedType } = body;
      if (!dormName || !bedCount) return NextResponse.json({ error: "Missing data" }, { status: 400 });

      await ensureBedTabs(spreadsheetId);
      const count = parseInt(bedCount) || 6;
      const prefix = dormName.replace(/[^A-Z0-9]/gi, "").slice(0, 3).toUpperCase();
      const rows: string[][] = [];

      if (bedType === "Bunk") {
        const pairs = Math.ceil(count / 2);
        for (let i = 1; i <= pairs; i++) {
          rows.push([dormName, `${prefix}-U${i}`, "Upper", "Bunk", "available", "", "", "", "", ""]);
          if (rows.length < count) {
            rows.push([dormName, `${prefix}-L${i}`, "Lower", "Bunk", "available", "", "", "", "", ""]);
          }
        }
      } else if (bedType === "Bunk2L1U") {
        const groups = Math.ceil(count / 3);
        for (let i = 1; i <= groups; i++) {
          rows.push([dormName, `${prefix}-U${i}`, "Upper", "Bunk", "available", "", "", "", "", ""]);
          if (rows.length < count) rows.push([dormName, `${prefix}-LA${i}`, "Lower", "Bunk", "available", "", "", "", "", ""]);
          if (rows.length < count) rows.push([dormName, `${prefix}-LB${i}`, "Lower", "Bunk", "available", "", "", "", "", ""]);
        }
      } else {
        for (let i = 1; i <= count; i++) {
          rows.push([dormName, `${prefix}-S${i}`, "Single", "Single", "available", "", "", "", "", ""]);
        }
      }

      await sheetsAppend(spreadsheetId, `'${BED_TAB}'!A:J`, rows);
      return NextResponse.json({ success: true });
    }

    if (action === "removeDorm") {
      if (role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
      const { dormName } = body;
      if (!dormName) return NextResponse.json({ error: "Missing dorm name" }, { status: 400 });

      const bedRows = await sheetsGet(spreadsheetId, `'${BED_TAB}'!A:J`);
      const dataRows = bedRows.length > 1 ? bedRows.slice(1) : [];
      const dormIndices = dataRows.map((r, i) => ({ row: r, idx: i })).filter(({ row }) => row[0] === dormName);

      const hasOccupied = dormIndices.some(({ row }) => row[4] !== "available");
      if (hasOccupied) return NextResponse.json({ error: "Cannot delete dorm with occupied or cleanup beds" }, { status: 400 });

      const tabs = await sheetsGetTabs(spreadsheetId);
      const tab = tabs.find((t) => t.title === BED_TAB);
      if (tab) {
        const indicesToDelete = dormIndices.map(({ idx }) => idx + 1).sort((a, b) => b - a);
        for (const rowIdx of indicesToDelete) {
          await sheetsDeleteRow(spreadsheetId, tab.sheetId, rowIdx);
        }
      }
      return NextResponse.json({ success: true });
    }

    if (action === "removeBed") {
      if (role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
      const { bedIndex } = body;
      const bedRows = await sheetsGet(spreadsheetId, `'${BED_TAB}'!A:J`);
      const bed = bedRows[bedIndex + 1];
      if (!bed) return NextResponse.json({ error: "Bed not found" }, { status: 404 });
      if (bed[4] !== "available") return NextResponse.json({ error: "Can only remove available beds" }, { status: 400 });

      const tabs = await sheetsGetTabs(spreadsheetId);
      const tab = tabs.find((t) => t.title === BED_TAB);
      if (tab) await sheetsDeleteRow(spreadsheetId, tab.sheetId, bedIndex + 1);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error: any) {
    console.error("Admin API error:", error?.message || error);
    return NextResponse.json({ error: error?.message || "Internal server error", role }, { status: 500 });
  }
}
