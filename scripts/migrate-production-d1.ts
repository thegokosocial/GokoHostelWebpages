import { execFileSync } from "node:child_process";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());
if (!process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_D1_TOKEN) {
  process.env.CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_D1_TOKEN;
}

execFileSync("npx", ["wrangler", "d1", "migrations", "apply", "goko-hostel-db", "--remote"], { stdio: "inherit" });
