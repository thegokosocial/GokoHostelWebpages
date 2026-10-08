/** Short-lived proof that this exact self-check-in upload passed server validation. */

export type CheckinValidationAttestationInput = {
  category: "id" | "visa";
  fileDigests: string[];
  idType: string;
  guestName: string;
  nationality: string;
  expiresAt: number;
};

const TOKEN_TTL_SECONDS = 15 * 60;

function secret() {
  const value = process.env.CHECKIN_VALIDATION_TOKEN_SECRET;
  return value && value.length >= 32 ? value : null;
}

function normalized(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function payload(input: CheckinValidationAttestationInput) {
  return JSON.stringify({
    c: input.category,
    d: [...input.fileDigests].sort(),
    i: input.idType,
    g: normalized(input.guestName),
    n: normalized(input.nationality),
    e: input.expiresAt,
  });
}

async function hmacHex(message: string, key: string) {
  const cryptoKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sameHex(a: string, b: string) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index++) difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
}

export async function digestFiles(files: File[]) {
  return Promise.all(files.map(async (file) => {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }));
}

export async function issueCheckinValidationAttestation(input: Omit<CheckinValidationAttestationInput, "expiresAt">) {
  const key = secret();
  if (!key) return null;
  const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const body = payload({ ...input, expiresAt });
  return `${expiresAt}.${await hmacHex(body, key)}`;
}

export async function verifyCheckinValidationAttestation(token: string, input: Omit<CheckinValidationAttestationInput, "expiresAt">) {
  const key = secret();
  const match = /^(\d{10})\.([a-f0-9]{64})$/i.exec(token.trim());
  if (!key || !match) return false;
  const expiresAt = Number(match[1]);
  if (expiresAt < Math.floor(Date.now() / 1000)) return false;
  const expected = await hmacHex(payload({ ...input, expiresAt }), key);
  return sameHex(expected.toLowerCase(), match[2].toLowerCase());
}
