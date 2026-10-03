import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parsePendingMigrationOutput } from "../../scripts/verify-production-migrations";

describe("production migration release gate", () => {
  it("recognizes a clean Wrangler migration check", () => {
    expect(parsePendingMigrationOutput("✅ No migrations to apply!\n")).toEqual([]);
  });

  it("extracts every pending migration from Wrangler output", () => {
    expect(parsePendingMigrationOutput([
      "Migrations to be applied:",
      "┌──────────────────────────────────────────────┐",
      "│ Name                                         │",
      "├──────────────────────────────────────────────┤",
      "│ 0072_food_order_edit_batches_and_refunds.sql │",
      "│ 0073_future_change.sql                       │",
      "└──────────────────────────────────────────────┘",
    ].join("\n"))).toEqual([
      "0072_food_order_edit_batches_and_refunds.sql",
      "0073_future_change.sql",
    ]);
  });

  it("wires both Cloudflare release paths through the production gate", () => {
    const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts as Record<string, string>;
    expect(scripts["db:verify:prod"]).toContain("verify-production-migrations.ts");
    expect(scripts["db:migrate:prod"]).toContain("migrate-production-d1.ts");
    expect(scripts["cf:build"]).toContain("db:verify:prod");
    expect(scripts["deploy:cf"]).toContain("db:verify:prod");
  });

  it("maps the documented D1 token to Wrangler's credential variable", () => {
    for (const file of ["scripts/migrate-production-d1.ts", "scripts/verify-production-migrations.ts"]) {
      const source = readFileSync(file, "utf8");
      expect(source).toContain("loadEnvConfig(process.cwd())");
      expect(source).toContain("CLOUDFLARE_D1_TOKEN");
      expect(source).toContain("CLOUDFLARE_API_TOKEN");
    }
  });
});
