import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import * as ts from "typescript";

// Execute the actual callbacks without introducing a DOM/test-renderer dependency.
const source = ts.createSourceFile("PwaInstallBanner.tsx", readFileSync(new URL("../components/admin/PwaInstallBanner.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function settings(action: string, overrides: Record<string, unknown> = {}) {
  let callback: ts.Node | undefined;
  function find(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === action && node.initializer && ts.isCallExpression(node.initializer)) callback = node.initializer.arguments[0];
    ts.forEachChild(node, find);
  }
  find(source);
  if (!callback) throw new Error(`Missing callback ${action}`);
  const unsubscribe = vi.fn().mockResolvedValue(true);
  const getSubscription = vi.fn().mockResolvedValue({ endpoint: "https://push.example/sub", unsubscribe });
  const context = {
    password: "test-only", username: "admin", pushAction: null, subscribing: false, vapidPublicKey: "key",
    isIos: false, isStandalone: true,
    navigator: { serviceWorker: { ready: Promise.resolve() } }, swRegistration: { pushManager: { getSubscription } },
    fetch: vi.fn().mockResolvedValue({ ok: true, json: async () => ({ delivery: { delivered: 1 } }) }),
    setPushAction: vi.fn(), setPushError: vi.fn(), setPushMessage: vi.fn(), setPushSubscribed: vi.fn(),
    setSubscribing: vi.fn(), setNotificationPermission: vi.fn(), setSwRegistration: vi.fn(),
    ...overrides,
  };
  const compiled = ts.transpileModule(`globalThis.handler = ${callback.getText(source)}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const sandbox = { ...context, handler: undefined as unknown as () => Promise<void> };
  runInNewContext(compiled, sandbox);
  return { ...context, unsubscribe, getSubscription, run: sandbox.handler };
}

describe("notification settings workflows", () => {
  it("keeps explicit useful content and event routing in every API push producer", () => {
    const root = resolve(__dirname, "../app/api");
    let count = 0;
    for (const name of readdirSync(root, { recursive: true }) as string[]) {
      if (!name.endsWith("route.ts")) continue;
      const file = ts.createSourceFile(name, readFileSync(resolve(root, name), "utf8"), ts.ScriptTarget.Latest, true);
      function inspect(node: ts.Node) {
        if (ts.isCallExpression(node) && ["dispatchPush", "sendPushToAll", "sendPushToRoles"].includes(node.expression.getText(file))) {
          const payload = node.arguments[0];
          expect(ts.isObjectLiteralExpression(payload), name).toBe(true);
          if (ts.isObjectLiteralExpression(payload)) {
            const fields = new Map(payload.properties.filter(ts.isPropertyAssignment).map((field) => [field.name.getText(file), field.initializer.getText(file)]));
            for (const key of ["title", "body", "url", "category", "eventId"]) expect(fields.get(key), `${name}: ${key}`).toBeTruthy();
            expect(fields.get("url"), name).toMatch(/^['"`]\/admin[?'"]/);
          }
          count++;
        }
        ts.forEachChild(node, inspect);
      }
      inspect(file);
    }
    expect(count).toBeGreaterThan(20);
  });
  it("reports acceptance rather than confirmed display", async () => {
    const ui = settings("handleTestPush");
    await ui.run();
    expect(ui.setPushMessage).toHaveBeenCalledWith(expect.stringContaining("Push service accepted"));
    expect(ui.setPushAction).toHaveBeenLastCalledWith(null);
  });
  it.each(["network", "invalid-json", "zero", "missing"])("handles test failure %s and clears busy state", async (failure) => {
    const fetch = vi.fn().mockImplementation(async () => {
      if (failure === "network") throw new Error("offline");
      return { ok: true, json: async () => {
        if (failure === "invalid-json") throw new Error("bad JSON");
        return failure === "zero" ? { delivery: { delivered: 0 } } : {};
      } };
    });
    const ui = settings("handleTestPush", { fetch });
    await ui.run();
    expect(ui.setPushError.mock.calls.some(([text]) => text.length > 0)).toBe(true);
    expect(ui.setPushAction).toHaveBeenLastCalledWith(null);
    expect(ui.setPushMessage).not.toHaveBeenCalledWith(expect.stringContaining("accepted"));
  });
  it("does not repeat an action while busy", async () => {
    const ui = settings("handleTestPush", { pushAction: "disable" });
    await ui.run();
    expect(ui.fetch).not.toHaveBeenCalled();
  });
  it("disables the subscription after server acceptance", async () => {
    const ui = settings("handleUnsubscribePush");
    await ui.run();
    expect(ui.unsubscribe).toHaveBeenCalled();
    expect(ui.setPushSubscribed).toHaveBeenCalledWith(false);
    expect(ui.setPushAction).toHaveBeenLastCalledWith(null);
  });
  it("preserves the subscription when server deletion fails", async () => {
    const ui = settings("handleUnsubscribePush", { fetch: vi.fn().mockRejectedValue(new Error("offline")) });
    await ui.run();
    expect(ui.unsubscribe).not.toHaveBeenCalled();
    expect(ui.setPushSubscribed).not.toHaveBeenCalledWith(false);
    expect(ui.setPushAction).toHaveBeenLastCalledWith(null);
  });
  it("handles browsers without notification APIs", async () => {
    const ui = settings("handleSubscribePush", { navigator: {} });
    await ui.run();
    expect(ui.setPushError).toHaveBeenCalledWith(expect.stringContaining("not supported"));
    expect(ui.setSubscribing).toHaveBeenLastCalledWith(false);
  });
  it("handles denied permission without creating a subscription", async () => {
    const ui = settings("handleSubscribePush", {
      navigator: { serviceWorker: { ready: Promise.resolve() } },
      Notification: { requestPermission: async () => "denied" },
    });
    await ui.run();
    expect(ui.getSubscription).not.toHaveBeenCalled();
    expect(ui.setNotificationPermission).toHaveBeenCalledWith("denied");
    expect(ui.setSubscribing).toHaveBeenLastCalledWith(false);
  });
  it("blocks enable on iPhone Safari tabs before requesting permission", async () => {
    const ui = settings("handleSubscribePush", {
      isIos: true,
      isStandalone: false,
      Notification: { requestPermission: async () => "granted" },
    });
    await ui.run();
    expect(ui.setPushError).toHaveBeenCalledWith(expect.stringContaining("Home Screen"));
    expect(ui.setNotificationPermission).not.toHaveBeenCalled();
    expect(ui.setSubscribing).toHaveBeenLastCalledWith(false);
  });
});
describe("notification settings install and iOS contracts", () => {
  const uiSource = readFileSync(new URL("../components/admin/PwaInstallBanner.tsx", import.meta.url), "utf8");
  const rootLayout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
  const adminLayout = readFileSync(new URL("../app/admin/layout.tsx", import.meta.url), "utf8");

  it("keeps Install app only in the admin notification dialog, not the public site", () => {
    expect(uiSource).toContain("Install app");
    expect(uiSource).toContain("Install only lives here");
    expect(uiSource).toContain("Add to Home Screen");
    expect(uiSource).toContain("detectIosSafari");
    expect(uiSource).toContain("Copy Admin link for Safari");
    expect(uiSource).not.toMatch(/showInstallSection/);
    expect(rootLayout).not.toContain('manifest: "/manifest.webmanifest"');
    expect(rootLayout).not.toContain("appleWebApp");
    expect(adminLayout).toContain('manifest: "/manifest.webmanifest"');
    expect(adminLayout).toContain("appleWebApp");
    expect(adminLayout).toContain("apple-touch-icon.png");
  });

  it("registers the service worker on iOS Safari tabs before Home Screen install", () => {
    expect(uiSource).toContain("Always register the SW on admin");
    expect(uiSource).toContain("pushBlocked");
    expect(uiSource).toContain("navigator.serviceWorker.ready");
    expect(uiSource).toContain("Push does not work from a normal Safari tab");
  });

  it("blocks iPhone Safari-tab enable and waits for service worker ready before subscribe", () => {
    expect(uiSource).toContain("iosPushBlockedReason");
    expect(uiSource).toContain("iosNeedsHomeScreen");
    expect(uiSource).toContain("navigator.serviceWorker.ready");
  });
});
