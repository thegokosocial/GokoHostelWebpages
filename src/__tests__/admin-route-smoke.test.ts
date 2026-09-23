import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * This is deliberately a route-level smoke matrix, not a replacement for
 * domain tests. Every action is sent through the real handler with no session
 * and must stop at the authentication boundary. It catches the class of
 * regressions where a new admin action is added without auth, or a route is
 * accidentally made dependent on database state before authentication.
 *
 * The action list is read from the route source so a newly-added action is
 * automatically included in this gate instead of being silently omitted from
 * the test suite.
 */

const auth = vi.hoisted(() => ({
  authenticateUser: vi.fn(),
  authenticateSimple: vi.fn(),
  authenticateKitchen: vi.fn(),
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
}));

vi.mock("@/lib/auth", () => auth);

type RouteHandler = (request: NextRequest) => Promise<Response> | Response;
type RouteModule = { POST?: RouteHandler; GET?: RouteHandler };

const root = process.cwd();
const adminApiRoot = join(root, "src/app/api/admin");

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(file);
    return entry.name === "route.ts" ? [file] : [];
  });
}

function actionsIn(source: string): string[] {
  const actions = [...source.matchAll(/(?:case\s+|action\s*===\s*|literal\()"([A-Za-z0-9_]+)"/g)]
    .map((match) => match[1])
    .filter((action) => action !== "string");
  return [...new Set(actions)];
}

const postRoutes = routeFiles(adminApiRoot)
  .filter((file) => readFileSync(file, "utf8").includes("export async function POST"))
  .map((file) => ({
    file,
    importPath: `@/${relative(join(root, "src"), file).replace(/\\/g, "/").replace(/\.ts$/, "")}`,
    actions: actionsIn(readFileSync(file, "utf8")),
  }));

function requestFor(route: string, action: string): NextRequest {
  if (route.endsWith("tasks/upload/route.ts") || route.endsWith("admin/upload/route.ts") || route.endsWith("website/upload/route.ts")) {
    return new NextRequest("http://localhost/api/admin/route", { method: "POST", body: new FormData() });
  }

  const body: Record<string, unknown> = { action, password: "" };
  if (route.endsWith("booking-payments/route.ts")) {
    const id = "00000000-0000-4000-8000-000000000001";
    if (["createTestAttempt", "getTestRequest"].includes(action)) body.requestKey = id;
    if (["getTestAttempt", "claimTestCheckout", "reconcileTestAttempt", "refundTestPayment", "verifyTestCallback"].includes(action)) body.attemptId = id;
    if (action === "verifyTestCallback") Object.assign(body, { paymentId: "pay_test123", orderId: "order_test123", signature: "0".repeat(64) });
    if (action === "refundTestPayment") body.paymentId = "pay_test123";
    if (action === "retryTestWebhook") body.eventId = "event-test-1";
  }
  return new NextRequest("http://localhost/api/admin/route", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Admin API authentication smoke matrix", () => {
  beforeAll(() => {
    auth.authenticateUser.mockResolvedValue(null);
    auth.authenticateSimple.mockResolvedValue(null);
    auth.authenticateKitchen.mockResolvedValue(null);
  });

  it("discovers every POST admin route and action", () => {
    expect(postRoutes.length).toBeGreaterThan(20);
    expect(postRoutes.flatMap((route) => route.actions).length).toBeGreaterThan(150);
    expect(postRoutes.every((route) => route.actions.length > 0 || route.file.includes("upload/route.ts") || route.file.endsWith("import/route.ts") || route.file.endsWith("analytics/route.ts"))).toBe(true);
  });

  for (const route of postRoutes) {
    describe(relative(adminApiRoot, route.file), () => {
      let handler: RouteHandler;

      beforeAll(async () => {
        const routeModule = await import(route.importPath) as RouteModule;
        if (!routeModule.POST) throw new Error(`Missing POST handler for ${route.file}`);
        handler = routeModule.POST;
      });

      for (const action of route.actions.length > 0 ? route.actions : ["__route_smoke__"]) {
        it(`rejects unauthenticated ${action}`, async () => {
          const response = await handler(requestFor(route.file, action));
          expect(response.status, `${route.file} action ${action}`).toBe(401);
        });
      }
    });
  }
});
