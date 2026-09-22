import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAuthSession } from "@/lib/authSession";

const GOOGLE_WEB_CLIENT_ID = process.env.GOOGLE_WEB_CLIENT_ID!;
const SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/gmail.readonly",
].join(" ");

export async function GET(req: NextRequest) {
  const auth = await getAuthSession("admin");
  if (!auth || auth.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const nonce = crypto.randomUUID();
  const expiry = Date.now() + 10 * 60 * 1000;
  (await cookies()).set("goko_oauth_state", nonce, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/auth/google", maxAge: 600 });

  const redirectUri = `${req.nextUrl.origin}/api/auth/google/callback`;
  const state = btoa(JSON.stringify({ nonce }));

  const params = new URLSearchParams({
    client_id: GOOGLE_WEB_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
    state,
  });

  return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}
