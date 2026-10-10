/** Proof that a returning guest may reuse the exact verified document links. */

const TOKEN_TTL_SECONDS = 15 * 60;

function secret() {
  const value = process.env.CHECKIN_VALIDATION_TOKEN_SECRET;
  return value && value.length >= 32 ? value : null;
}

function normalized(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function payload(input: { category: "id" | "visa"; name: string; nationality: string; idType: string; links: string; expiresAt: number }) {
  return JSON.stringify({ c: input.category, g: normalized(input.name), n: normalized(input.nationality), i: input.idType, l: input.links, e: input.expiresAt });
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

export async function issueCheckinReuseAttestation(input: { category: "id" | "visa"; name: string; nationality: string; idType: string; links: string; verified: string }) {
  const key = secret();
  if (!key || input.verified !== "yes" || !input.links) return null;
  const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  return `${expiresAt}.${await hmacHex(payload({ ...input, expiresAt }), key)}`;
}

export async function verifyCheckinReuseAttestation(token: string, input: { category: "id" | "visa"; name: string; nationality: string; idType: string; links: string }) {
  const key = secret();
  const match = /^(\d{10})\.([a-f0-9]{64})$/i.exec(token.trim());
  if (!key || !match || Number(match[1]) < Math.floor(Date.now() / 1000)) return false;
  return sameHex((await hmacHex(payload({ ...input, expiresAt: Number(match[1]) }), key)).toLowerCase(), match[2].toLowerCase());
}
