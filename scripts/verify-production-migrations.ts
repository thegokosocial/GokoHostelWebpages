import { execFileSync } from "node:child_process";

const DATABASE = "goko-hostel-db";

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-?]*[ -\/]*[@-~]/g, "");
}

export function parsePendingMigrationOutput(output: string): string[] {
  const clean = stripAnsi(output);
  if (/No migrations to apply!/i.test(clean)) return [];
  if (!/Migrations to be applied:/i.test(clean)) return [];
  return [...clean.matchAll(/│\s*(\d{4}_[^│\r\n]+\.sql)\s*│/g)].map((match) => match[1]);
}

export function verifyProductionMigrations(): void {
  let output = "";
  try {
    output = execFileSync("npx", ["wrangler", "d1", "migrations", "list", DATABASE, "--remote"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to verify production D1 migrations. Refusing the build. ${detail}`);
  }

  const clean = stripAnsi(output);
  const pending = parsePendingMigrationOutput(clean);
  if (/Migrations to be applied:/i.test(clean) && pending.length === 0) {
    throw new Error("Unable to parse Wrangler's pending migration list. Refusing the build instead of risking schema drift.");
  }
  if (pending.length > 0) {
    throw new Error(`Production D1 has unapplied migrations: ${pending.join(", ")}. Run CI=true npm run db:migrate:prod, verify again, then deploy.`);
  }

  console.log(`Production D1 migration check passed: ${DATABASE} has no pending migrations.`);
}

if (process.argv[1]?.endsWith("/verify-production-migrations.ts")) {
  try {
    verifyProductionMigrations();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
