import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@/db/schema";

const mocks = vi.hoisted(() => ({ db: null as any }));
vi.mock("@/db", () => ({ getDb: () => mocks.db }));
import { addExpense, archiveTask, createTask, deleteTaskHard, getTaskAssignees, getTaskById, getTaskExpense, getTasks, unlinkExpenseFromTask, updateTask } from "@/db/queries";

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
        idempotency_key TEXT,
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

    sqlite.exec(readMigration("0056_tasks_optional_assignee.sql", "0076_task_followers_and_notifications.sql", "0082_task_notes_and_shopping.sql"));
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

  it("stores follower usernames on the synced task row", async () => {
    const id = await createTask({ title: "Inspect room", followerUsernames: '["staff"]', createdBy: "admin", updatedBy: "admin" });
    expect((await getTaskById(id!))?.tasks.followerUsernames).toBe('["staff"]');
    await updateTask(id!, { followerUsernames: "[]", updatedBy: "admin" });
    expect((await getTaskById(id!))?.tasks.followerUsernames).toBe("[]");
  });

  it("stores notes journal and shopping items on the synced task row", async () => {
    const id = await createTask({
      title: "Market run",
      taskType: "shopping",
      notes: JSON.stringify([{ id: "n1", body: "Start early", authorUsername: "admin", createdAt: "2026-09-17T00:00:00.000Z" }]),
      shoppingItems: JSON.stringify([{ id: "i1", label: "Milk", bought: false }]),
      createdBy: "admin",
      updatedBy: "admin",
    });
    const row = await getTaskById(id!);
    expect(JSON.parse(row!.tasks.notes)).toHaveLength(1);
    expect(JSON.parse(row!.tasks.shoppingItems)[0].label).toBe("Milk");
  });

  it("hard-deletes a task after unlinking its expense", async () => {
    const id = await createTask({ title: "Buy soap", taskType: "purchase", assigneeUserId: 1, createdBy: "admin", updatedBy: "admin" });
    await addExpense({ amount: 1250, category: "Supplies", purpose: "Soap", expenseDate: "2026-09-17", createdMonth: "2026-09", createdBy: "staff", taskId: id });
    await unlinkExpenseFromTask(id!);
    expect((await getTaskExpense(id!))).toBeNull();
    const expenseStillThere = sqlite.prepare("SELECT id, task_id FROM expenses WHERE id = 1").get() as { id: number; task_id: number | null };
    expect(expenseStillThere.task_id).toBeNull();
    await deleteTaskHard(id!);
    expect(await getTaskById(id!)).toBeNull();
  });

  it("adds notes and shopping_items columns via 0082", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE tasks (
        id INTEGER PRIMARY KEY, title TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
        follower_usernames TEXT NOT NULL DEFAULT '[]'
      );
      INSERT INTO tasks VALUES (1, 'x', 'old', '[]');
    `);
    db.exec(readMigration("0082_task_notes_and_shopping.sql"));
    const row = db.prepare("SELECT notes, shopping_items, note FROM tasks WHERE id = 1").get() as {
      notes: string; shopping_items: string; note: string;
    };
    expect(row.notes).toBe("[]");
    expect(row.shopping_items).toBe("[]");
    expect(row.note).toBe("old");
    db.close();
  });

  it("backfills active task followers and enables the new notification category", () => {
    const legacy = new Database(":memory:");
    legacy.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL, permissions TEXT NOT NULL DEFAULT '{}', deleted_at TEXT);
      CREATE TABLE tasks (id INTEGER PRIMARY KEY, assignee_user_id INTEGER, created_by TEXT NOT NULL, deleted_at TEXT);
      INSERT INTO users VALUES (1, 'staff', '{"canViewTasks":true}', NULL), (2, 'manager', '{}', NULL), (3, 'deleted', '{}', '2026-09-17');
      INSERT INTO tasks VALUES (10, 1, 'manager', NULL), (11, 3, 'deleted', NULL);
    `);
    legacy.exec(readMigration("0076_task_followers_and_notifications.sql"));
    expect(JSON.parse((legacy.prepare("SELECT follower_usernames value FROM tasks WHERE id = 10").get() as { value: string }).value).sort()).toEqual(["manager", "staff"]);
    expect(JSON.parse((legacy.prepare("SELECT follower_usernames value FROM tasks WHERE id = 11").get() as { value: string }).value)).toEqual([]);
    expect(JSON.parse((legacy.prepare("SELECT permissions value FROM users WHERE id = 1").get() as { value: string }).value).canReceiveTaskNotifications).toBe(true);
    legacy.close();
  });
});

function readMigration(...files: string[]) {
  return (files.length ? files : ["0055_tasks.sql", "0056_tasks_optional_assignee.sql", "0076_task_followers_and_notifications.sql", "0082_task_notes_and_shopping.sql"])
    .map((file) => readFileSync(`migrations/${file}`, "utf8"))
    .join("\n");
}
