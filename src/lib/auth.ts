import { getUserByUsername, getAllUsers, updateUser } from "@/db/queries";
import type { UserRole } from "@/lib/actionPermissions";
import { getAuthSession } from "@/lib/authSession";

export type { UserRole };

export type AuthResult = {
  role: UserRole;
  displayName: string;
  permissions: Record<string, boolean>;
  username?: string;
};

export type KitchenAuthResult = { role: UserRole; displayName: string; username?: string; permissions?: Record<string, boolean> };

// Cloudflare Workers WebCrypto rejects PBKDF2 requests above 100,000 rounds.
// Keep this value in the serialized hash so future changes can be versioned.
const PBKDF2_ITERATIONS = 100_000;

function base64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function unbase64(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

async function legacyHashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + "goko-salt-2026");
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: salt as unknown as BufferSource, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" }, key, 256);
  return `pbkdf2$1$${PBKDF2_ITERATIONS}$${base64(salt)}$${base64(new Uint8Array(bits))}`;
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const parts = hash.split("$");
  if (parts.length === 5 && parts[0] === "pbkdf2" && parts[1] === "1") {
    const iterations = Number(parts[2]);
    if (!Number.isSafeInteger(iterations) || iterations < 50_000 || iterations > 2_000_000) return false;
    try {
      const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
      const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: unbase64(parts[3]) as unknown as BufferSource, iterations, hash: "SHA-256" }, key, 256);
      const actual = new Uint8Array(bits);
      const expected = unbase64(parts[4]);
      if (actual.length !== expected.length) return false;
      let diff = 0;
      for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
      return diff === 0;
    } catch { return false; }
  }
  return (await legacyHashPassword(password)) === hash;
}

function isLegacyHash(hash: string): boolean { return !hash.startsWith("pbkdf2$"); }

export async function authenticateUser(password: string, username?: string): Promise<AuthResult | null> {
  if (!password) return getAuthSession("admin");

  if (!username) {
    if (process.env.ADMIN_PASSWORD && password === process.env.ADMIN_PASSWORD) return { role: "admin", displayName: "Admin", username: "admin", permissions: {} };
    if (process.env.MANAGER_PASSWORD && password === process.env.MANAGER_PASSWORD) return { role: "manager", displayName: "Manager", username: "manager", permissions: {} };
    return null;
  }

  if (process.env.ADMIN_PASSWORD && password === process.env.ADMIN_PASSWORD && username === "admin") return { role: "admin", displayName: "Admin", username: "admin", permissions: {} };
  if (process.env.MANAGER_PASSWORD && password === process.env.MANAGER_PASSWORD && username === "manager") return { role: "manager", displayName: "Manager", username: "manager", permissions: {} };

  try {
    const user = await getUserByUsername(username);
    if (!user) return null;
    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) return null;
    if (isLegacyHash(user.passwordHash)) {
      updateUser(user.id, { passwordHash: await hashPassword(password) }).catch(() => {});
    }
    let permissions: Record<string, boolean> = {};
    try { permissions = JSON.parse(user.permissions || "{}"); } catch {}
    return { role: (user.role as UserRole) || "manager", displayName: user.displayName || username, username, permissions };
  } catch {
    return null;
  }
}

export async function authenticateSimple(password: string, username?: string): Promise<boolean> {
  const result = await authenticateUser(password, username);
  return result !== null;
}

export async function authenticateKitchen(password: string, scope: "admin" | "kitchen" = "kitchen"): Promise<KitchenAuthResult | null> {
  if (!password) return getAuthSession(scope);

  if (process.env.ADMIN_PASSWORD && password === process.env.ADMIN_PASSWORD) return { role: "admin", displayName: "Admin" };
  if (process.env.MANAGER_PASSWORD && password === process.env.MANAGER_PASSWORD) return { role: "manager", displayName: "Manager" };

  try {
    const allUsers = await getAllUsers();
    const legacy = await legacyHashPassword(password);
    for (const user of allUsers) {
      const valid = isLegacyHash(user.passwordHash)
        ? legacy === user.passwordHash
        : await verifyPassword(password, user.passwordHash);
      if (valid) {
        if (isLegacyHash(user.passwordHash)) updateUser(user.id, { passwordHash: await hashPassword(password) }).catch(() => {});
        return { role: (user.role as UserRole) || "staff", displayName: user.displayName || user.username };
      }
    }
  } catch {}

  return null;
}
