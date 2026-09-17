import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@/db/schema";

const mocks = vi.hoisted(() => ({ db: null as any }));
vi.mock("@/db", () => ({ getDb: () => mocks.db }));
import { addExpense, archiveTask, createTask, getTaskAssignees, getTaskById, getTaskExpense, getTasks, updateTask } from "@/db/queries";

describe("Tasks SQLite workflows", () => {
  let sqlite: InstanceType<typeof Database>;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    sqlite.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
        display_name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'staff', permissions TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL, created_by TEXT DEFAULT '', is_system INTEGER NOT NULL DEFAULT 0,
        sync_id TEXT, sync_updated_at TEXT DEFAULT '', sync_source TEXT DEFAULT 'cloudflare', deleted_at TEXT
      );
      CREATE TABLE expenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT, amount INTEGER NOT NULL, category TEXT NOT NULL,
        custom_category TEXT DEFAULT '', purpose TEXT NOT NULL DEFAULT '', bill_image_link TEXT DEFAULT '',
        vendor_id INTEGER, account_id INTEGER, payment_method TEXT DEFAULT 'cash', main_category TEXT DEFAULT 'stay_expense',
        sub_category TEXT DEFAULT '', created_by TEXT NOT NULL, updated_by TEXT DEFAULT '', created_at TEXT NOT NULL,
        updated_at TEXT DEFAULT '', expense_date TEXT NOT NULL DEFAULT '', created_month TEXT NOT NULL,
        sync_id TEXT, sync_updated_at TEXT DEFAULT '', sync_source TEXT DEFAULT 'cloudflare', deleted_at TEXT
      );
    `);
    sqlite.exec(readMigration());
    sqlite.exec(`
      INSERT INTO users (username, password_hash, display_name, role, created_at) VALUES
        ('staff', 'hash', 'Staff User', 'staff', '2026-09-17T00:00:00.000Z'),
        ('deleted', 'hash', 'Deleted User', 'staff', '2026-09-17T00:00:00.000Z');
      UPDATE users SET deleted_at = '2026-09-17T01:00:00.000Z' WHERE username = 'deleted';
    `);
    mocks.db = drizzle(sqlite, { schema });
  });

  afterEach(() => sqlite.close());

  it("creates, updates, archives, and filters a task while preserving its assignee", async () => {
    const id = await createTask({ title: "Buy cleaning supplies", taskType: "purchase", assigneeUserId: 1, createdBy: "admin", updatedBy: "admin" });
    expect(id).toBeTypeOf("number");
    expect((await getTaskById(id!))?.tasks.title).toBe("Buy cleaning supplies");
    expect((await getTasks({ assigneeUserId: 1 }))).toHaveLength(1);

    await updateTask(id!, { status: "done", note: "Completed", completedAt: "2026-09-17T02:00:00.000Z", completedBy: "staff", updatedBy: "staff" });
    expect((await getTaskById(id!))?.tasks.status).toBe("done");
    await archiveTask(id!, "admin");
    expect(await getTasks()).toHaveLength(0);
    expect((await getTasks({ includeArchived: true }))[0].tasks.deletedAt).toBeTruthy();
  });

  it("creates an unassigned task that can be assigned later", async () => {
    const id = await createTask({ title: "Review stock list", createdBy: "admin", updatedBy: "admin" });
    expect((await getTaskById(id!))?.tasks.assigneeUserId).toBeNull();
    expect(await getTasks({ assigneeUserId: 1 })).toHaveLength(0);

    await updateTask(id!, { assigneeUserId: 1, updatedBy: "admin" });
    expect((await getTaskById(id!))?.tasks.assigneeUserId).toBe(1);
    await updateTask(id!, { assigneeUserId: null, updatedBy: "admin" });
    expect((await getTaskById(id!))?.tasks.assigneeUserId).toBeNull();
  });

  it("preserves task-linked expenses when the optional-assignee migration rebuilds tasks", async () => {
    const id = await createTask({ title: "Legacy purchase", taskType: "purchase", assigneeUserId: 1, createdBy: "admin", updatedBy: "admin" });
    const expenseId = await addExpense({ amount: 500, category: "Supplies", purpose: "Legacy", expenseDate: "2026-09-17", createdMonth: "2026-09", createdBy: "staff", taskId: id });

    sqlite.exec(readMigration("0056_tasks_optional_assignee.sql"));
    mocks.db = drizzle(sqlite, { schema });

    const task = await getTaskById(id!);
    expect(task?.tasks.assigneeUserId).toBe(1);
    expect(task?.expenses?.id).toBe(expenseId);
  });

  it("links one purchase expense and exposes it with task reads", async () => {
    const id = await createTask({ title: "Buy soap", taskType: "purchase", assigneeUserId: 1, createdBy: "admin", updatedBy: "admin" });
    const expenseId = await addExpense({ amount: 1250, category: "Supplies", purpose: "Soap", expenseDate: "2026-09-17", createdMonth: "2026-09", createdBy: "staff", taskId: id });
    expect(expenseId).toBeTypeOf("number");
    expect((await getTaskExpense(id!))?.amount).toBe(1250);
    expect((await getTaskById(id!))?.expenses?.id).toBe(expenseId);
    expect((await getTasks())[0].expenses?.category).toBe("Supplies");
    await expect(addExpense({ amount: 300, category: "Supplies", purpose: "Duplicate", expenseDate: "2026-09-17", createdMonth: "2026-09", createdBy: "staff", taskId: id })).rejects.toThrow();
  });

  it("only returns active users as task assignees", async () => {
    expect((await getTaskAssignees()).map((user) => user.username)).toEqual(["staff"]);
  });
});

function readMigration(...files: string[]) {
  return (files.length ? files : ["0055_tasks.sql", "0056_tasks_optional_assignee.sql"])
    .map((file) => readFileSync(`migrations/${file}`, "utf8"))
    .join("\n");
}
