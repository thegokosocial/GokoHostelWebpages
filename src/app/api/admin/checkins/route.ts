import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";

type UserRole = "admin" | "manager";

function getMonthTab(date?: Date): string {
  const d = date || new Date();
  const months = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
    "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
  return `${months[d.getMonth()]}-${d.getFullYear()}`;
}

function getOAuth2Client() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  return oauth2;
}

function getServiceAuth() {
  const credentials = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!credentials) throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY not set");
  const key = JSON.parse(credentials);
  const privateKey = key.private_key.replace(/\\n/g, "\n");
  return new google.auth.GoogleAuth({
    credentials: { client_email: key.client_email, private_key: privateKey },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

function authenticateUser(password: string): UserRole | null {
  if (password === process.env.ADMIN_PASSWORD) return "admin";
  if (password === process.env.MANAGER_PASSWORD) return "manager";
  return null;
}

async function ensureMonthTab(sheets: any, spreadsheetId: string, tabName: string) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties.title" });
  const existing = meta.data.sheets?.map((s: any) => s.properties.title) || [];

  if (!existing.includes(tabName)) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: tabName } } }],
      },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${tabName}'!A1:N1`,
      valueInputOption: "RAW",
      requestBody: {
        values: [["Submitted At", "Arrival Date", "Arrival Time", "Name", "Persons",
          "Contact", "Days", "Coming From", "Nationality", "Emergency Contact",
          "Emergency Phone", "ID Type", "ID Card", "Visa"]],
      },
    });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { password, action, month } = body;

    const role = authenticateUser(password);
    if (!role) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const credentials = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    if (!credentials || !spreadsheetId) {
      return NextResponse.json({ rows: [], role, tabs: [], warning: "Google Sheets not configured" });
    }

    const auth = getServiceAuth();
    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: "v4", auth: authClient as any });

    if (action === "list" || !action) {
      const tabName = month || getMonthTab();
      await ensureMonthTab(sheets, spreadsheetId, tabName);

      const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties.title" });
      const tabs = (meta.data.sheets?.map((s: any) => s.properties.title) || []);

      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${tabName}'!A:N`,
      });
      const allRows = response.data.values || [];
      const rows = allRows.length > 1 ? allRows.slice(1) : [];

      return NextResponse.json({ rows, role, tabs, currentTab: tabName });
    }

    if (action === "add") {
      const { entry } = body;
      if (!entry) return NextResponse.json({ error: "No entry data" }, { status: 400 });

      const tabName = getMonthTab();
      await ensureMonthTab(sheets, spreadsheetId, tabName);

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `'${tabName}'!A:N`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [entry] },
      });

      return NextResponse.json({ success: true });
    }

    if (action === "update") {
      if (role !== "admin") {
        return NextResponse.json({ error: "Only admin can modify entries" }, { status: 403 });
      }

      const { rowIndex, entry, tab } = body;
      const tabName = tab || getMonthTab();

      if (!entry || rowIndex === undefined) {
        return NextResponse.json({ error: "Missing entry data or row index" }, { status: 400 });
      }

      const rowNumber = rowIndex + 2;
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${tabName}'!A${rowNumber}:N${rowNumber}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [entry] },
      });

      return NextResponse.json({ success: true });
    }

    if (action === "delete") {
      if (role !== "admin") {
        return NextResponse.json({ error: "Only admin can delete entries" }, { status: 403 });
      }

      const { rowIndex, driveFileIds, tab } = body;
      const tabName = tab || getMonthTab();

      if (driveFileIds && driveFileIds.length > 0) {
        const oauth2 = getOAuth2Client();
        if (oauth2) {
          const drive = google.drive({ version: "v3", auth: oauth2 });
          for (const fileId of driveFileIds) {
            try {
              await drive.files.delete({ fileId });
            } catch (err: any) {
              console.error(`Failed to delete Drive file ${fileId}:`, err?.message);
            }
          }
        }
      }

      const meta = await sheets.spreadsheets.get({ spreadsheetId });
      const sheet = meta.data.sheets?.find((s: any) => s.properties?.title === tabName);
      if (sheet?.properties) {
        const sheetId = sheet.properties.sheetId;
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [{
              deleteDimension: {
                range: {
                  sheetId,
                  dimension: "ROWS",
                  startIndex: rowIndex + 1,
                  endIndex: rowIndex + 2,
                },
              },
            }],
          },
        });
      }

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error: any) {
    console.error("Admin API error:", error?.message || error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
