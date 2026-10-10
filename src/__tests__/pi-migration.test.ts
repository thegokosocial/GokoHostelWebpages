import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Pi migrations", () => {
  it("keeps internal-transfer columns while omitting Cloudflare-only recurring rules", () => {
    const dbPath = join(tmpdir(), `goko-pi-migrations-${process.pid}-${Date.now()}.db`);
    try {
      execFileSync("node", ["--import", "tsx", "scripts/migrate-pi.ts"], {
        env: { ...process.env, SQLITE_PATH: dbPath },
        stdio: "pipe",
      });
      const columns = execFileSync("sqlite3", [dbPath, "SELECT name FROM pragma_table_info('expenses') WHERE name = 'transfer_id';"], { encoding: "utf8" });
      const recurring = execFileSync("sqlite3", [dbPath, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'recurring_expense_rules';"], { encoding: "utf8" });
      expect(columns.trim()).toBe("transfer_id");
      expect(recurring.trim()).toBe("");
    } finally {
      if (existsSync(dbPath)) rmSync(dbPath);
    }
  });
});
