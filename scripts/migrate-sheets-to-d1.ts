/**
 * One-time migration script: Google Sheets → Cloudflare D1
 *
 * Reads all data from Google Sheets and inserts into D1 via the HTTP API.
 * This script is idempotent — it clears D1 tables before inserting.
 * It NEVER modifies or deletes data in Google Sheets.
 *
 * Prerequisites:
 *   - .env.local must have: GOOGLE_SERVICE_ACCOUNT_KEY, GOOGLE_SHEET_ID,
 *     CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_DATABASE_ID, CLOUDFLARE_D1_TOKEN
 *
 * Usage:
 *   npx tsx scripts/migrate-sheets-to-d1.ts
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID!;
const DATABASE_ID = process.env.CLOUDFLARE_DATABASE_ID!;
const D1_TOKEN = process.env.CLOUDFLARE_D1_TOKEN!;
const SHEET_ID = process.env.GOOGLE_SHEET_ID!;

if (!ACCOUNT_ID || !DATABASE_ID || !D1_TOKEN) {
  console.error("Missing CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_DATABASE_ID, or CLOUDFLARE_D1_TOKEN in .env.local");
  process.exit(1);
}
if (!SHEET_ID) {
  console.error("Missing GOOGLE_SHEET_ID in .env.local");
  process.exit(1);
}

// --- D1 HTTP API helper ---

async function d1Execute(sql: string, params: any[] = []): Promise<any> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${D1_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sql, params }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`D1 API error (${res.status}): ${text}`);
  }
  const data = await res.json();
  if (!data.success) {
    throw new Error(`D1 query failed: ${JSON.stringify(data.errors)}`);
  }
  return data.result?.[0]?.results || [];
}

// --- Google Sheets reader (reuses existing JWT logic) ---

async function getServiceAccountToken(): Promise<string> {
  const credentials = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!credentials) throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY not set");
  const key = JSON.parse(credentials);
  const privateKey = key.private_key.replace(/\\n/g, "\n");

  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: key.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const { createSign } = await import("crypto");
  const enc = (obj: any) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  const unsignedToken = `${enc(header)}.${enc(claim)}`;
  const sign = createSign("RSA-SHA256");
  sign.update(unsignedToken);
  const signature = sign.sign(privateKey, "base64url");
  const jwt = `${unsignedToken}.${signature}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

async function sheetsGet(range: string): Promise<string[][]> {
  const token = await getServiceAccountToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Sheets GET failed: ${await res.text()}`);
  const data = await res.json();
  return data.values || [];
}

async function sheetsGetTabs(): Promise<string[]> {
  const token = await getServiceAccountToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=sheets.properties.title`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Sheets tabs failed: ${await res.text()}`);
  const data = await res.json();
  return (data.sheets || []).map((s: any) => s.properties?.title).filter(Boolean);
}

// --- Migration ---

const SYSTEM_TABS = ["CheckIns", "Settings", "Dorms", "BedHistory", "ApiStats"];

async function migrate() {
  console.log("=== Goko Hostel: Google Sheets → D1 Migration ===\n");

  // Clear existing D1 data (idempotent re-run)
  console.log("Clearing D1 tables...");
  await d1Execute("DELETE FROM bed_history");
  await d1Execute("DELETE FROM beds");
  await d1Execute("DELETE FROM dorms");
  await d1Execute("DELETE FROM checkins");
  await d1Execute("DELETE FROM settings");
  await d1Execute("DELETE FROM api_stats");
  console.log("  Done.\n");

  const allTabs = await sheetsGetTabs();
  console.log(`Found ${allTabs.length} tabs: ${allTabs.join(", ")}\n`);

  // --- 1. Migrate check-ins from monthly tabs ---
  const monthTabs = allTabs.filter((t) => !SYSTEM_TABS.includes(t));
  let totalCheckins = 0;

  for (const tab of monthTabs) {
    const rows = await sheetsGet(`'${tab}'!A:O`);
    const dataRows = rows.length > 1 ? rows.slice(1) : [];
    const validRows = dataRows.filter((r) => r.some((cell) => cell && cell.trim()));

    for (const row of validRows) {
      await d1Execute(
        `INSERT INTO checkins (submitted_at, arrival_date, arrival_time, name, persons, contact, staying_days, coming_from, nationality, emergency_name, emergency_phone, id_type, id_card_link, visa_link, verified, created_month)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row[0] || "", row[1] || "", row[2] || "", row[3] || "", row[4] || "1",
          row[5] || "", row[6] || "1", row[7] || "", row[8] || "", row[9] || "",
          row[10] || "", row[11] || "", row[12] || "", row[13] || "", row[14] || "pending",
          tab,
        ]
      );
      totalCheckins++;
    }
    console.log(`  ✓ ${tab}: ${validRows.length} check-ins migrated`);
  }
  console.log(`  Total check-ins: ${totalCheckins}\n`);

  // --- 2. Migrate Dorms + Beds ---
  if (allTabs.includes("Dorms")) {
    const rows = await sheetsGet("'Dorms'!A:J");
    const dataRows = rows.length > 1 ? rows.slice(1) : [];

    // Extract unique dorm names and create dorms
    const dormNames = [...new Set(dataRows.map((r) => r[0]).filter(Boolean))];
    const dormIdMap = new Map<string, number>();

    for (const name of dormNames) {
      await d1Execute("INSERT INTO dorms (name, created_at) VALUES (?, ?)", [name, new Date().toISOString()]);
      const result = await d1Execute("SELECT id FROM dorms WHERE name = ?", [name]);
      if (result.length > 0) dormIdMap.set(name, result[0].id);
    }
    console.log(`  ✓ ${dormNames.length} dorms created`);

    // Insert beds
    let bedCount = 0;
    for (const row of dataRows) {
      const dormName = row[0] || "";
      const dormId = dormIdMap.get(dormName);
      if (!dormId) continue;

      await d1Execute(
        `INSERT INTO beds (dorm_id, dorm_name, bed_id, position, type, status, guest_name, guest_contact, checkin_date, expected_checkout, staying_days)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          dormId, dormName, row[1] || "", row[2] || "Lower", row[3] || "Bunk",
          row[4] || "available", row[5] || "", row[6] || "", row[7] || "", row[8] || "", row[9] || "",
        ]
      );
      bedCount++;
    }
    console.log(`  ✓ ${bedCount} beds migrated\n`);
  } else {
    console.log("  ⚠ No 'Dorms' tab found, skipping beds.\n");
  }

  // --- 3. Migrate Bed History ---
  let historyCount = 0;
  if (allTabs.includes("BedHistory")) {
    const rows = await sheetsGet("'BedHistory'!A:F");
    const dataRows = rows.length > 1 ? rows.slice(1) : [];

    for (const row of dataRows) {
      if (!row[0]) continue;
      await d1Execute(
        `INSERT INTO bed_history (created_at, bed_id_label, dorm_name, action, guest_name, guest_contact)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [row[0] || "", row[1] || "", row[2] || "", row[3] || "", row[4] || "", row[5] || ""]
      );
      historyCount++;
    }
    console.log(`  ✓ ${historyCount} bed history entries migrated`);
  } else {
    console.log("  ⚠ No 'BedHistory' tab found, skipping.");
  }

  // --- 4. Migrate Settings ---
  let settingsCount = 0;
  if (allTabs.includes("Settings")) {
    const rows = await sheetsGet("'Settings'!A:B");
    const dataRows = rows.length > 1 ? rows.slice(1) : [];

    for (const row of dataRows) {
      if (!row[0]) continue;
      await d1Execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
        [row[0], row[1] || ""]
      );
      settingsCount++;
    }
    console.log(`  ✓ ${settingsCount} settings migrated`);
  }

  // --- 5. Migrate API Stats ---
  let statsCount = 0;
  if (allTabs.includes("ApiStats")) {
    const rows = await sheetsGet("'ApiStats'!A:E");
    const dataRows = rows.length > 1 ? rows.slice(1) : [];

    for (const row of dataRows) {
      if (!row[0]) continue;
      const vision = parseInt(row[1] || "0", 10);
      const sheets = parseInt(row[2] || "0", 10);
      const drive = parseInt(row[3] || "0", 10);
      const total = parseInt(row[4] || "0", 10);
      await d1Execute(
        "INSERT OR REPLACE INTO api_stats (month, vision, sheets, drive, total) VALUES (?, ?, ?, ?, ?)",
        [row[0], vision, sheets, drive, total]
      );
      statsCount++;
    }
    console.log(`  ✓ ${statsCount} API stats rows migrated`);
  }

  // --- Verification ---
  console.log("\n\n=== Migration Verification ===\n");

  const checkinCount = await d1Execute("SELECT COUNT(*) as cnt FROM checkins");
  const bedCountDb = await d1Execute("SELECT COUNT(*) as cnt FROM beds");
  const dormCount = await d1Execute("SELECT COUNT(*) as cnt FROM dorms");
  const histCount = await d1Execute("SELECT COUNT(*) as cnt FROM bed_history");
  const setCount = await d1Execute("SELECT COUNT(*) as cnt FROM settings");
  const statCount = await d1Execute("SELECT COUNT(*) as cnt FROM api_stats");

  console.log(`  Checkins:    ${checkinCount[0]?.cnt || 0} rows`);
  console.log(`  Dorms:       ${dormCount[0]?.cnt || 0} rows`);
  console.log(`  Beds:        ${bedCountDb[0]?.cnt || 0} rows`);
  console.log(`  Bed History: ${histCount[0]?.cnt || 0} rows`);
  console.log(`  Settings:    ${setCount[0]?.cnt || 0} rows`);
  console.log(`  API Stats:   ${statCount[0]?.cnt || 0} rows`);

  const bedStatuses = await d1Execute("SELECT status, COUNT(*) as cnt FROM beds GROUP BY status");
  console.log("\n  Bed status breakdown:");
  for (const row of bedStatuses) {
    console.log(`    ${row.status}: ${row.cnt}`);
  }

  console.log("\n✅ Migration complete! Google Sheet is untouched.\n");
}

migrate().catch((err) => {
  console.error("\n❌ Migration failed:", err.message);
  process.exit(1);
});
