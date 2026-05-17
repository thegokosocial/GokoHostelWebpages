import { NextRequest, NextResponse } from "next/server";
import {
  sheetsGet,
  sheetsAppend,
  sheetsUpdate,
  sheetsGetTabs,
  sheetsDeleteRow,
  ensureMonthTab,
  driveDeleteFile,
  getMonthTabName,
  CHECKIN_HEADERS,
} from "@/lib/googleApiFetch";

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

      const allRows = await sheetsGet(spreadsheetId, `'${tabName}'!A:N`);
      const rows = allRows.length > 1 ? allRows.slice(1) : [];

      return NextResponse.json({ rows, role, tabs: tabNames, currentTab: tabName });
    }

    if (action === "add") {
      const { entry } = body;
      if (!entry) return NextResponse.json({ error: "No entry data" }, { status: 400 });

      const tabName = getMonthTabName();
      await ensureMonthTab(spreadsheetId, tabName, CHECKIN_HEADERS);
      await sheetsAppend(spreadsheetId, `'${tabName}'!A:N`, [entry]);

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
      await sheetsUpdate(spreadsheetId, `'${tabName}'!A${rowNumber}:N${rowNumber}`, [entry]);

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

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error: any) {
    console.error("Admin API error:", error?.message || error);
    return NextResponse.json({ error: error?.message || "Internal server error", role }, { status: 500 });
  }
}
