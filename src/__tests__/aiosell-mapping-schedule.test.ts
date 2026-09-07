import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

const workerSource = readFileSync("worker.ts", "utf8").replace(/import openNextWorker[^\n]+\n/, "");
const compiled = ts.transpileModule(workerSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

describe("mapping-check schedule routing", () => {
  it("dispatches mapping and reconciliation jobs separately and ignores unknown schedules", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("{}"));
    const scope = { exports: {} as { default?: { scheduled: Function } }, openNextWorker: { fetch }, Request, console };
    runInNewContext(compiled, scope);
    const worker = scope.exports.default!;
    const env = { CRON_SECRET: "test-secret" };
    await worker.scheduled({ cron: "30 3 * * *" }, env, {});
    expect(fetch.mock.calls[0][0].url).toBe("https://goko.internal/api/cron/aiosell-mappings");
    expect(fetch.mock.calls[0][0].headers.get("authorization")).toBe("Bearer test-secret");
    await worker.scheduled({ cron: "30 4,6,8,10,12,14,16 * * *" }, env, {});
    expect(fetch.mock.calls[1][0].url).toBe("https://goko.internal/api/cron/reconciliation-reminder");
    await worker.scheduled({ cron: "unknown" }, env, {});
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("fails visibly for missing credentials and unsuccessful job responses", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("private error details", { status: 502 }));
    const scope = { exports: {} as { default?: { scheduled: Function } }, openNextWorker: { fetch }, Request, console };
    runInNewContext(compiled, scope);
    const worker = scope.exports.default!;
    await expect(worker.scheduled({ cron: "30 3 * * *" }, {}, {})).rejects.toThrow("CRON_SECRET is not configured");
    expect(fetch).not.toHaveBeenCalled();
    for (const cron of ["30 3 * * *", "30 4,6,8,10,12,14,16 * * *"]) {
      await expect(worker.scheduled({ cron }, { CRON_SECRET: "test-secret" }, {})).rejects.toThrow("HTTP 502");
    }
  });
  it("keeps both schedules in deployment configuration and connects the dashboard destination", () => {
    const config = readFileSync("wrangler.jsonc", "utf8");
    expect(config).toContain('"30 3 * * *"');
    expect(config).toContain('"30 4,6,8,10,12,14,16 * * *"');
    const dashboard = readFileSync("src/components/admin/AdminDashboard.tsx", "utf8");
    expect(dashboard).toContain('managementTab: "channelManager", channelManagerTab: "sync"');
    expect(readFileSync("src/app/admin/page.tsx", "utf8")).toContain('initialChannelTab={channelManagerTab}');
    expect(readFileSync("src/components/admin/AdminManagement.tsx", "utf8")).toContain('initialTab={initialChannelTab}');
  });
});
