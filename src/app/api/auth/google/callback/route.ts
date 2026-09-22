import { NextRequest, NextResponse } from "next/server";
import { getSetting, setSetting } from "@/db/queries";
import { cookies } from "next/headers";

const GOOGLE_WEB_CLIENT_ID = process.env.GOOGLE_WEB_CLIENT_ID!;
const GOOGLE_WEB_CLIENT_SECRET = process.env.GOOGLE_WEB_CLIENT_SECRET!;

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      `${req.nextUrl.origin}/admin?oauth_error=${encodeURIComponent(error)}`
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      `${req.nextUrl.origin}/admin?oauth_error=missing_code`
    );
  }

  let stateData: { nonce?: string };
  try {
    stateData = JSON.parse(atob(state));
  } catch {
    return NextResponse.redirect(
      `${req.nextUrl.origin}/admin?oauth_error=invalid_state`
    );
  }

  const storedNonce = (await cookies()).get("goko_oauth_state")?.value;
  if (!storedNonce) {
    return NextResponse.redirect(
      `${req.nextUrl.origin}/admin?oauth_error=expired_state`
    );
  }

  if (stateData.nonce !== storedNonce) {
    return NextResponse.redirect(
      `${req.nextUrl.origin}/admin?oauth_error=expired_state`
    );
  }

  (await cookies()).set("goko_oauth_state", "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/auth/google", maxAge: 0 });

  const redirectUri = `${req.nextUrl.origin}/api/auth/google/callback`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_WEB_CLIENT_ID,
      client_secret: GOOGLE_WEB_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }).toString(),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    console.error("OAuth token exchange failed:", err);
    return NextResponse.redirect(
      `${req.nextUrl.origin}/admin?oauth_error=token_exchange_failed`
    );
  }

  const tokenData = await tokenRes.json();
  const refreshToken = tokenData.refresh_token;

  if (!refreshToken) {
    return NextResponse.redirect(
      `${req.nextUrl.origin}/admin?oauth_error=no_refresh_token`
    );
  }

  await setSetting("google_oauth_refresh_token", refreshToken);
  await setSetting("google_oauth_web_client_id", GOOGLE_WEB_CLIENT_ID);
  await setSetting("google_oauth_web_client_secret", GOOGLE_WEB_CLIENT_SECRET);

  return NextResponse.redirect(
    `${req.nextUrl.origin}/admin?oauth_success=true`
  );
}
