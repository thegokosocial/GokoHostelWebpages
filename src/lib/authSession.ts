import { cookies } from "next/headers";
import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { authSessions } from "@/db/schema";
import { getUserByUsername } from "@/db/queries";
import type { AuthResult, KitchenAuthResult } from "@/lib/auth";

export const AUTH_COOKIE = "goko_session";
export type AuthScope = "admin" | "kitchen";

function cookieName(scope: AuthScope): string { return `${AUTH_COOKIE}_${scope}`; }

function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return encode(new Uint8Array(bytes));
}

function nowIso() { return new Date().toISOString(); }

export async function createAuthSession(auth: AuthResult | KitchenAuthResult, scope: AuthScope, rememberMe = false): Promise<void> {
  const raw = encode(crypto.getRandomValues(new Uint8Array(32)));
  const now = new Date();
  const expires = new Date(now.getTime() + (rememberMe ? 15 * 24 * 60 * 60 : (scope === "kitchen" ? 12 : 8) * 60 * 60) * 1000);
  await getDb().insert(authSessions).values({
    tokenHash: await digest(raw),
    username: "username" in auth && auth.username ? auth.username : auth.displayName,
    role: auth.role,
    displayName: auth.displayName,
    permissions: "permissions" in auth ? JSON.stringify(auth.permissions) : "{}",
    scope,
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    lastSeenAt: now.toISOString(),
  });
  const jar = await cookies();
  jar.set(cookieName(scope), raw, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires });
}

export async function getAuthSession(scope: AuthScope = "admin"): Promise<(AuthResult & { username: string }) | null> {
  try {
    const raw = (await cookies()).get(cookieName(scope))?.value;
    if (!raw) return null;
    const conditions = [eq(authSessions.tokenHash, await digest(raw)), eq(authSessions.scope, scope), gt(authSessions.expiresAt, nowIso()), isNull(authSessions.revokedAt)];
    const row = (await getDb().select().from(authSessions).where(and(...conditions)).limit(1))[0];
    if (!row) return null;

    let permissions: Record<string, boolean> = {};
    try { permissions = JSON.parse(row.permissions || "{}"); } catch { /* fail closed */ }

    // DB-user permissions are intentionally refreshed on every request so a
    // permission removal takes effect immediately instead of waiting for the
    // session TTL. Environment-backed sessions simply fall back to the
    // snapshot because there is no matching DB user.
    if (row.role !== "admin") {
      const user = await getUserByUsername(row.username);
      if (!user) return null;
      try { permissions = JSON.parse(user.permissions || "{}"); } catch { permissions = {}; }
      const result = { username: user.username, role: (user.role as AuthResult["role"]) || "staff", displayName: user.displayName || user.username, permissions };
      void getDb().update(authSessions).set({ role: result.role, displayName: result.displayName, permissions: JSON.stringify(permissions), lastSeenAt: nowIso() }).where(eq(authSessions.tokenHash, row.tokenHash)).catch(() => {});
      return result;
    }

    void getDb().update(authSessions).set({ lastSeenAt: nowIso() }).where(eq(authSessions.tokenHash, row.tokenHash)).catch(() => {});
    return { username: row.username, role: row.role as AuthResult["role"], displayName: row.displayName, permissions };
  } catch {
    return null;
  }
}

export async function revokeAuthSession(scope: AuthScope = "admin"): Promise<void> {
  const jar = await cookies();
  const name = cookieName(scope);
  const raw = jar.get(name)?.value;
  if (raw) await getDb().update(authSessions).set({ revokedAt: nowIso() }).where(eq(authSessions.tokenHash, await digest(raw)));
  jar.set(name, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
}
