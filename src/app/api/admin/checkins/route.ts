import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";

async function getAuthClient() {
  const credentials = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!credentials) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY env variable not set");
  }
  const key = JSON.parse(credentials);
  const privateKey = key.private_key.replace(/\\n/g, "\n");
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: key.client_email,
      private_key: privateKey,
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  return auth;
}

export async function POST(req: NextRequest) {
  try {
    const { password } = await req.json();

    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminPassword || password !== adminPassword) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const credentials = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    if (!credentials || !spreadsheetId) {
      return NextResponse.json({
        rows: [],
        warning: "Google Sheets not configured. Add GOOGLE_SERVICE_ACCOUNT_KEY and GOOGLE_SHEET_ID to .env.local",
      });
    }

    const auth = await getAuthClient();
    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: "v4", auth: authClient as any });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "CheckIns!A:M",
    });

    const allRows = response.data.values || [];
    const rows = allRows.length > 1 ? allRows.slice(1) : [];

    return NextResponse.json({ rows });
  } catch (error) {
    console.error("Admin API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
