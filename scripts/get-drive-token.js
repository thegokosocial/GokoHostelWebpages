/**
 * One-time script to get a Google OAuth2 refresh token for Drive uploads.
 *
 * Prerequisites:
 *   1. Create OAuth 2.0 "Desktop app" credentials in Google Cloud Console
 *   2. Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in .env.local
 *
 * Usage:
 *   node scripts/get-drive-token.js
 *
 * It will print a URL -- open it in your browser, sign in with the Gmail account
 * that owns the Drive folder, grant permission, then paste the code back here.
 * The script will output a refresh token to add to .env.local.
 */

const { google } = require("googleapis");
const readline = require("readline");
const fs = require("fs");
const path = require("path");

const envPath = path.join(__dirname, "..", ".env.local");
let envContent = "";
try {
  envContent = fs.readFileSync(envPath, "utf-8");
} catch {}

function getEnvVar(name) {
  const match = envContent.match(new RegExp(`^${name}=(.*)$`, "m"));
  return match ? match[1].trim() : process.env[name];
}

const CLIENT_ID = getEnvVar("GOOGLE_OAUTH_CLIENT_ID");
const CLIENT_SECRET = getEnvVar("GOOGLE_OAUTH_CLIENT_SECRET");

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("\nERROR: Add these to .env.local first:");
  console.error("  GOOGLE_OAUTH_CLIENT_ID=your_client_id");
  console.error("  GOOGLE_OAUTH_CLIENT_SECRET=your_client_secret\n");
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  "urn:ietf:wg:oauth:2.0:oob"
);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  scope: ["https://www.googleapis.com/auth/drive.file"],
  prompt: "consent",
});

console.log("\n=== Google Drive OAuth Setup ===\n");
console.log("1. Open this URL in your browser:\n");
console.log(authUrl);
console.log("\n2. Sign in with: thegokosocial@gmail.com");
console.log("3. Grant permission to access Google Drive");
console.log("4. Copy the authorization code and paste it below:\n");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question("Authorization code: ", async (code) => {
  try {
    const { tokens } = await oauth2Client.getToken(code.trim());
    console.log("\n✓ Success! Add this to your .env.local:\n");
    console.log(`GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}\n`);
    console.log("Then restart the dev server.\n");
  } catch (err) {
    console.error("\nERROR:", err.message);
  }
  rl.close();
});
