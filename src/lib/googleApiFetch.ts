/**
 * Google API client for Drive and Vision only.
 * Data storage moved to Cloudflare D1.
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

// --- Token Caching ---

let _saTokenCache: { token: string; expiry: number; scopeKey: string } | null = null;

async function getServiceAccountToken(scopes: string[]): Promise<string> {
  const scopeKey = [...scopes].sort().join(",");
  if (_saTokenCache && _saTokenCache.scopeKey === scopeKey && Date.now() < _saTokenCache.expiry) {
    return _saTokenCache.token;
  }

  const credentials = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!credentials) throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY not set");
  const key = JSON.parse(credentials);
  const privateKey = key.private_key.replace(/\\n/g, "\n");

  const jwt = await createJwt(key.client_email, privateKey, scopes);

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token exchange failed: ${err}`);
  }

  const data = await res.json();
  if (!data.access_token) throw new Error("No access_token in token response");
  _saTokenCache = { token: data.access_token, expiry: Date.now() + 50 * 60 * 1000, scopeKey };
  return data.access_token;
}

let _oauthTokenCache: { token: string; expiry: number } | null = null;

async function getOAuthToken(): Promise<string | null> {
  if (_oauthTokenCache && Date.now() < _oauthTokenCache.expiry) {
    return _oauthTokenCache.token;
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}&refresh_token=${encodeURIComponent(refreshToken)}&grant_type=refresh_token`,
  });

  if (!res.ok) return null;
  const data = await res.json();
  if (!data.access_token) return null;
  _oauthTokenCache = { token: data.access_token, expiry: Date.now() + 50 * 60 * 1000 };
  return data.access_token;
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

  const permRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  });
  if (!permRes.ok) {
    console.error(`Failed to set file permissions for ${fileId}: ${permRes.status}`);
  }

  return `https://drive.google.com/file/d/${fileId}/view`;
}

export async function driveDeleteFile(fileId: string): Promise<void> {
  const token = await getOAuthToken();
  if (!token) throw new Error("OAuth token not available for Drive delete");
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Drive delete failed (${res.status}): ${await res.text()}`);
  }
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

// --- Gmail API ---

export type GmailMessage = {
  id: string;
  snippet: string;
  subject: string;
  from: string;
  date: string;
  body: string;
};

export async function gmailListMessages(query: string, maxResults = 20): Promise<{ id: string; threadId: string }[]> {
  const token = await getOAuthToken();
  if (!token) return [];

  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return [];
  const data = await res.json();
  return data.messages || [];
}

export async function gmailGetMessage(messageId: string): Promise<GmailMessage | null> {
  const token = await getOAuthToken();
  if (!token) return null;

  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const data = await res.json();

  const headers = data.payload?.headers || [];
  const getHeader = (name: string) => headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || "";

  let body = "";
  if (data.payload?.body?.data) {
    body = atob(data.payload.body.data.replace(/-/g, "+").replace(/_/g, "/"));
  } else if (data.payload?.parts) {
    const textPart = data.payload.parts.find((p: any) => p.mimeType === "text/plain") ||
                     data.payload.parts.find((p: any) => p.mimeType === "text/html");
    if (textPart?.body?.data) {
      body = atob(textPart.body.data.replace(/-/g, "+").replace(/_/g, "/"));
    }
  }

  return {
    id: data.id,
    snippet: data.snippet || "",
    subject: getHeader("Subject"),
    from: getHeader("From"),
    date: getHeader("Date"),
    body,
  };
}
