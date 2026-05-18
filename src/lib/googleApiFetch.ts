/**
 * Lightweight Google API client using native fetch.
 * Replaces `googleapis` npm package for Cloudflare Workers compatibility.
 */

// --- JWT Token Generation ---

async function createJwt(
  clientEmail: string,
  privateKeyPem: string,
  scopes: string[]
): Promise<string> {
  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: clientEmail,
    scope: scopes.join(" "),
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const enc = (obj: any) =>
    btoa(JSON.stringify(obj)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

  const unsignedToken = `${enc(header)}.${enc(claim)}`;

  const keyData = privateKeyPem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\n/g, "");

  const binaryKey = Uint8Array.from(atob(keyData), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(unsignedToken)
  );

  const sig = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return `${unsignedToken}.${sig}`;
}

async function getServiceAccountToken(scopes: string[]): Promise<string> {
  const credentials = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!credentials) throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY not set");
  const key = JSON.parse(credentials);
  const privateKey = key.private_key.replace(/\\n/g, "\n");

  const jwt = await createJwt(key.client_email, privateKey, scopes);

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token exchange failed: ${err}`);
  }

  const data = await res.json();
  return data.access_token;
}

async function getOAuthToken(): Promise<string | null> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `client_id=${clientId}&client_secret=${clientSecret}&refresh_token=${refreshToken}&grant_type=refresh_token`,
  });

  if (!res.ok) return null;
  const data = await res.json();
  return data.access_token;
}

// --- Google Sheets ---

export async function sheetsGet(spreadsheetId: string, range: string): Promise<any[][]> {
  const token = await getServiceAccountToken(["https://www.googleapis.com/auth/spreadsheets.readonly"]);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Sheets GET failed: ${await res.text()}`);
  const data = await res.json();
  return data.values || [];
}

export async function sheetsAppend(spreadsheetId: string, range: string, values: any[][]): Promise<void> {
  const token = await getServiceAccountToken(["https://www.googleapis.com/auth/spreadsheets"]);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values }),
  });
  if (!res.ok) throw new Error(`Sheets append failed: ${await res.text()}`);
}

export async function sheetsUpdate(spreadsheetId: string, range: string, values: any[][]): Promise<void> {
  const token = await getServiceAccountToken(["https://www.googleapis.com/auth/spreadsheets"]);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values }),
  });
  if (!res.ok) throw new Error(`Sheets update failed: ${await res.text()}`);
}

export async function sheetsGetTabs(spreadsheetId: string): Promise<{ title: string; sheetId: number }[]> {
  const token = await getServiceAccountToken(["https://www.googleapis.com/auth/spreadsheets.readonly"]);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Sheets meta failed: ${await res.text()}`);
  const data = await res.json();
  return (data.sheets || []).map((s: any) => ({
    title: s.properties?.title || "",
    sheetId: s.properties?.sheetId || 0,
  }));
}

export async function sheetsAddTab(spreadsheetId: string, title: string): Promise<void> {
  const token = await getServiceAccountToken(["https://www.googleapis.com/auth/spreadsheets"]);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }),
  });
  if (!res.ok) throw new Error(`Sheets addTab failed: ${await res.text()}`);
}

export async function sheetsDeleteRow(spreadsheetId: string, sheetId: number, rowIndex: number): Promise<void> {
  const token = await getServiceAccountToken(["https://www.googleapis.com/auth/spreadsheets"]);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [{
        deleteDimension: {
          range: { sheetId, dimension: "ROWS", startIndex: rowIndex, endIndex: rowIndex + 1 },
        },
      }],
    }),
  });
  if (!res.ok) throw new Error(`Sheets deleteRow failed: ${await res.text()}`);
}

export async function ensureMonthTab(spreadsheetId: string, tabName: string, headers: string[]): Promise<void> {
  const tabs = await sheetsGetTabs(spreadsheetId);
  if (!tabs.find((t) => t.title === tabName)) {
    await sheetsAddTab(spreadsheetId, tabName);
    await sheetsUpdate(spreadsheetId, `'${tabName}'!A1:${String.fromCharCode(64 + headers.length)}1`, [headers]);
  }
}

// --- Google Drive ---

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunks: string[] = [];
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.slice(i, i + chunkSize)));
  }
  return btoa(chunks.join(""));
}

export async function driveUploadFile(
  fileName: string,
  mimeType: string,
  fileBuffer: ArrayBuffer,
  parentFolderId?: string
): Promise<string> {
  const token = await getOAuthToken();
  if (!token) throw new Error("OAuth token not available for Drive upload");

  const metadata = JSON.stringify({
    name: fileName,
    parents: parentFolderId ? [parentFolderId] : undefined,
  });

  const boundary = "----goko" + Date.now();
  const fileBase64 = arrayBufferToBase64(fileBuffer);
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
    `--${boundary}\r\nContent-Type: ${mimeType}\r\nContent-Transfer-Encoding: base64\r\n\r\n` +
    fileBase64 +
    `\r\n--${boundary}--`;

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );

  if (!res.ok) throw new Error(`Drive upload failed: ${await res.text()}`);
  const data = await res.json();
  const fileId = data.id;

  await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  });

  return `https://drive.google.com/file/d/${fileId}/view`;
}

export async function driveDeleteFile(fileId: string): Promise<void> {
  const token = await getOAuthToken();
  if (!token) return;
  await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function driveGetOrCreateFolder(parentId: string, folderName: string): Promise<string> {
  const token = await getOAuthToken();
  if (!token) return parentId;

  const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
    `name='${folderName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
  )}&fields=files(id)`;

  const searchRes = await fetch(searchUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (searchRes.ok) {
    const searchData = await searchRes.json();
    if (searchData.files?.length > 0) return searchData.files[0].id;
  }

  const createRes = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: folderName, mimeType: "application/vnd.google-apps.folder", parents: [parentId] }),
  });

  if (!createRes.ok) return parentId;
  const createData = await createRes.json();
  return createData.id || parentId;
}

// --- Google Cloud Vision ---

export type VisionAnalysis = {
  text: string;
  labels: string[];
  objects: string[];
  safeSearch: {
    adult: string;
    spoof: string;
    violence: string;
    racy: string;
  } | null;
  isPdf: boolean;
};

export async function visionAnalyze(fileBase64: string, mimeType: string = "image/jpeg"): Promise<VisionAnalysis> {
  const token = await getServiceAccountToken(["https://www.googleapis.com/auth/cloud-vision"]);

  if (mimeType === "application/pdf") {
    const res = await fetch("https://vision.googleapis.com/v1/files:annotate", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [{
          inputConfig: { content: fileBase64, mimeType: "application/pdf" },
          features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
          pages: [1],
        }],
      }),
    });
    if (!res.ok) throw new Error(`Vision PDF API failed: ${await res.text()}`);
    const data = await res.json();
    const pages = data.responses?.[0]?.responses || [];
    const text = pages.map((p: any) => p?.fullTextAnnotation?.text || "").join("\n");
    return { text, labels: [], objects: [], safeSearch: null, isPdf: true };
  }

  const res = await fetch("https://vision.googleapis.com/v1/images:annotate", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [{
        image: { content: fileBase64 },
        features: [
          { type: "TEXT_DETECTION", maxResults: 1 },
          { type: "DOCUMENT_TEXT_DETECTION", maxResults: 1 },
          { type: "LABEL_DETECTION", maxResults: 10 },
          { type: "SAFE_SEARCH_DETECTION" },
          { type: "OBJECT_LOCALIZATION", maxResults: 5 },
        ],
      }],
    }),
  });

  if (!res.ok) throw new Error(`Vision API failed: ${await res.text()}`);
  const data = await res.json();
  const ann = data.responses?.[0];

  const text = ann?.fullTextAnnotation?.text || ann?.textAnnotations?.[0]?.description || "";
  const labels = (ann?.labelAnnotations || []).map((l: any) => (l.description || "").toLowerCase());
  const objects = (ann?.localizedObjectAnnotations || []).map((o: any) => (o.name || "").toLowerCase());
  const ss = ann?.safeSearchAnnotation;
  const safeSearch = ss ? { adult: ss.adult, spoof: ss.spoof, violence: ss.violence, racy: ss.racy } : null;

  return { text, labels, objects, safeSearch, isPdf: false };
}

/** Backward-compatible wrapper */
export async function visionDetectText(fileBase64: string, mimeType: string = "image/jpeg"): Promise<string> {
  const result = await visionAnalyze(fileBase64, mimeType);
  return result.text;
}

// --- Settings (stored in "Settings" tab of the same sheet) ---

export async function getSettingValue(spreadsheetId: string, key: string): Promise<string | null> {
  try {
    const tabs = await sheetsGetTabs(spreadsheetId);
    if (!tabs.find((t) => t.title === "Settings")) return null;
    const rows = await sheetsGet(spreadsheetId, "'Settings'!A:B");
    const row = rows.find((r) => r[0] === key);
    return row ? row[1] || null : null;
  } catch {
    return null;
  }
}

export async function setSettingValue(spreadsheetId: string, key: string, value: string): Promise<void> {
  const tabs = await sheetsGetTabs(spreadsheetId);
  if (!tabs.find((t) => t.title === "Settings")) {
    await sheetsAddTab(spreadsheetId, "Settings");
    await sheetsUpdate(spreadsheetId, "'Settings'!A1:B1", [["Key", "Value"]]);
  }
  const rows = await sheetsGet(spreadsheetId, "'Settings'!A:B");
  const rowIndex = rows.findIndex((r) => r[0] === key);
  if (rowIndex >= 0) {
    await sheetsUpdate(spreadsheetId, `'Settings'!A${rowIndex + 1}:B${rowIndex + 1}`, [[key, value]]);
  } else {
    await sheetsAppend(spreadsheetId, "'Settings'!A:B", [[key, value]]);
  }
}

// --- API Usage Tracking ---

const STATS_TAB = "ApiStats";

export type ApiStatRow = {
  month: string;
  vision: number;
  sheets: number;
  drive: number;
  totalCalls: number;
};

export async function incrementApiStat(spreadsheetId: string, apiType: "vision" | "sheets" | "drive", count = 1): Promise<void> {
  try {
    const tabs = await sheetsGetTabs(spreadsheetId);
    if (!tabs.find((t) => t.title === STATS_TAB)) {
      await sheetsAddTab(spreadsheetId, STATS_TAB);
      await sheetsUpdate(spreadsheetId, `'${STATS_TAB}'!A1:E1`, [["Month", "Vision", "Sheets", "Drive", "Total"]]);
    }

    const monthKey = getMonthTabName();
    const rows = await sheetsGet(spreadsheetId, `'${STATS_TAB}'!A:E`);
    const rowIndex = rows.findIndex((r) => r[0] === monthKey);

    if (rowIndex >= 0) {
      const current = rows[rowIndex];
      const vision = parseInt(current[1] || "0", 10) + (apiType === "vision" ? count : 0);
      const sheets = parseInt(current[2] || "0", 10) + (apiType === "sheets" ? count : 0);
      const drive = parseInt(current[3] || "0", 10) + (apiType === "drive" ? count : 0);
      const total = vision + sheets + drive;
      await sheetsUpdate(spreadsheetId, `'${STATS_TAB}'!A${rowIndex + 1}:E${rowIndex + 1}`, [[monthKey, String(vision), String(sheets), String(drive), String(total)]]);
    } else {
      const vision = apiType === "vision" ? count : 0;
      const sheets = apiType === "sheets" ? count : 0;
      const drive = apiType === "drive" ? count : 0;
      const total = vision + sheets + drive;
      await sheetsAppend(spreadsheetId, `'${STATS_TAB}'!A:E`, [[monthKey, String(vision), String(sheets), String(drive), String(total)]]);
    }
  } catch (e) {
    console.error("Failed to log API stat:", e);
  }
}

export async function getApiStats(spreadsheetId: string): Promise<ApiStatRow[]> {
  try {
    const tabs = await sheetsGetTabs(spreadsheetId);
    if (!tabs.find((t) => t.title === STATS_TAB)) return [];
    const rows = await sheetsGet(spreadsheetId, `'${STATS_TAB}'!A:E`);
    return rows.slice(1).filter((r) => r[0]).map((r) => ({
      month: r[0],
      vision: parseInt(r[1] || "0", 10),
      sheets: parseInt(r[2] || "0", 10),
      drive: parseInt(r[3] || "0", 10),
      totalCalls: parseInt(r[4] || "0", 10),
    }));
  } catch {
    return [];
  }
}

// --- Helpers ---

export function getMonthTabName(date?: Date): string {
  const d = date || new Date();
  const months = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
    "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
  return `${months[d.getMonth()]}-${d.getFullYear()}`;
}

export const CHECKIN_HEADERS = [
  "Submitted At", "Arrival Date", "Arrival Time", "Name", "Persons",
  "Contact", "Days", "Coming From", "Nationality", "Emergency Contact",
  "Emergency Phone", "ID Type", "ID Card", "Visa", "Verified",
];
