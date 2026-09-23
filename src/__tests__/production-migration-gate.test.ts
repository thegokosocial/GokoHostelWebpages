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
    expect(scripts["cf:build"]).toContain("db:verify:prod");
    expect(scripts["deploy:cf"]).toContain("db:verify:prod");
  });
});
