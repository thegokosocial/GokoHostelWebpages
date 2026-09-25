import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as ts from "typescript";
import SQLite from "better-sqlite3";
import { NOTIFICATION_CATEGORIES } from "@/lib/notificationCatalog";

const file = "src/components/admin/NotificationPreferences.tsx";
const sourceText = readFileSync(file, "utf8");
const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function callback(name: string, globals: Record<string, unknown>) {
  let initializer: ts.Expression | undefined;
  function find(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) initializer = node.initializer;
    ts.forEachChild(node, find);
  }
  find(source);
  if (!initializer) throw new Error(`Missing ${name}`);
  const context = { ...globals, handler: undefined as unknown as (...args: any[]) => any };
  runInNewContext(ts.transpileModule(`globalThis.handler = ${initializer.getText(source)}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return context.handler;
}

function statefulMuted(initial: string[] = []) {
  let current = new Set(initial);
  const setMuted = vi.fn((update: (value: Set<string>) => Set<string>) => { current = update(current); });
  return { setMuted, value: () => [...current] };
}

describe("notification preference UI workflows", () => {
  const bookings = NOTIFICATION_CATEGORIES.find((category) => category.id === "booking")!;

  it("mutes and enables a whole category from the native tri-state checkbox", () => {
    const first = statefulMuted();
    callback("toggleCategory", { setMuted: first.setMuted })(bookings);
    expect(first.value()).toEqual(bookings.events.map(([id]) => id));

    const partial = statefulMuted([bookings.events[0][0]]);
    callback("toggleCategory", { setMuted: partial.setMuted })(bookings);
    expect(partial.value()).toEqual([]);
  });

  it("toggles one event without changing sibling choices", () => {
    const state = statefulMuted(["booking.new"]);
    const toggle = callback("toggleType", { setMuted: state.setMuted });
    toggle("booking.modified");
    expect(state.value()).toEqual(["booking.new", "booking.modified"]);
    toggle("booking.new");
    expect(state.value()).toEqual(["booking.modified"]);
  });

  it("hides categories outside the server grant and provides save/error states", () => {
    expect(sourceText).toContain("allowed.includes(category.id)");
    expect(sourceText).toContain("has not enabled any notification categories");
    expect(sourceText).toContain("Enable notifications from the bell");
    expect(sourceText).toContain('role="alert"');
    expect(sourceText).toContain('role="status"');
    expect(sourceText).toContain("input.indeterminate");
    expect(sourceText).toContain("Save notification preferences");
    expect(sourceText).toContain('<input type="checkbox" disabled={busy}');
    expect(sourceText).toContain('addEventListener("goko:push-subscription-changed"');
    expect(sourceText).toContain("setAllowed(data.allowedCategories || [])");
  });

  it("exposes admin category grants through the shared permission catalog and cleans up deleted users", () => {
    const catalog = readFileSync("src/lib/permissionCatalog.ts", "utf8");
    const usersUi = readFileSync("src/components/admin/ManagementUsers.tsx", "utf8");
    const usersApi = readFileSync("src/app/api/admin/checkins/route.ts", "utf8");
    for (const category of NOTIFICATION_CATEGORIES) expect(catalog).toContain(category.permission);
    expect(usersUi).toContain("withDefaultNotificationPermissions");
    expect(usersApi).toContain("delete(pushSubscriptions)");
    expect(usersApi).toContain("deletedUser.username");
  });

  it("ships the D1 column, legacy owner normalization, and matching schema field", () => {
    const migration = readFileSync("migrations/0075_push_notification_preferences.sql", "utf8");
    const schema = readFileSync("src/db/schema.ts", "utf8");
    expect(migration).toContain("muted_notification_types TEXT NOT NULL DEFAULT '[]'");
    expect(migration).toContain("SET user_label = 'admin'");
    expect(schema).toContain('mutedNotificationTypes: text("muted_notification_types").notNull().default("[]")');
  });

  it("migrates existing subscriptions to all-enabled and normalizes blank legacy owners", () => {
    const sqlite = new SQLite(":memory:");
    sqlite.exec("CREATE TABLE push_subscriptions (id INTEGER PRIMARY KEY, endpoint TEXT NOT NULL UNIQUE, key_p256dh TEXT NOT NULL, key_auth TEXT NOT NULL, user_label TEXT DEFAULT '', created_at TEXT NOT NULL)");
    sqlite.prepare("INSERT INTO push_subscriptions VALUES (1, 'https://push.example/one', 'p', 'a', '', '2026-09-25')").run();
    sqlite.exec(readFileSync("migrations/0075_push_notification_preferences.sql", "utf8"));
    expect(sqlite.prepare("SELECT user_label, muted_notification_types FROM push_subscriptions").get()).toEqual({ user_label: "admin", muted_notification_types: "[]" });
    sqlite.prepare("INSERT INTO push_subscriptions (id, endpoint, key_p256dh, key_auth, user_label, created_at) VALUES (2, 'https://push.example/two', 'p', 'a', 'staff-a', '2026-09-25')").run();
    expect(sqlite.prepare("SELECT muted_notification_types FROM push_subscriptions WHERE id = 2").get()).toEqual({ muted_notification_types: "[]" });
    sqlite.close();
  });
});
