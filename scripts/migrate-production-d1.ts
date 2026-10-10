import { execFileSync } from "node:child_process";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());
if (!process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_D1_TOKEN) {
  process.env.CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_D1_TOKEN;
}

const DATABASE = "goko-hostel-db";

type WranglerResult = Array<{ results?: Array<{ booking_ref: string; ids: string }> }>;

export function duplicateBookingRefs(output: string): Array<{ bookingRef: string; ids: string }> {
  const parsed = JSON.parse(output) as WranglerResult;
  return (parsed.flatMap((item) => item.results || [])).map((row) => ({ bookingRef: row.booking_ref, ids: row.ids }));
}

export function assertNoDuplicateBookingRefs(): void {
  const output = execFileSync("npx", ["wrangler", "d1", "execute", DATABASE, "--remote", "--json", "--command",
    "SELECT booking_ref, group_concat(id) AS ids FROM bookings WHERE booking_ref <> '' GROUP BY booking_ref HAVING count(*) > 1"], { encoding: "utf8" });
  const duplicates = duplicateBookingRefs(output);
  if (duplicates.length) throw new Error(`Refusing booking-reference migration; manually reconcile duplicate booking_ref rows: ${duplicates.map((row) => `${row.bookingRef} (ids ${row.ids})`).join(", ")}`);
}

if (process.argv[1]?.endsWith("/migrate-production-d1.ts")) {
  assertNoDuplicateBookingRefs();
  execFileSync("npx", ["wrangler", "d1", "migrations", "apply", DATABASE, "--remote"], { stdio: "inherit" });
}
