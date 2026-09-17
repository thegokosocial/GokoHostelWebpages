import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { actionAllowed, type ActionPerm } from "@/lib/actionPermissions";
import { ALL_PERMISSION_KEYS } from "@/lib/permissionCatalog";

const TASK_PERMISSIONS: Record<string, ActionPerm> = {
  listTasks: ["canViewTasks", "canManageTasks"],
  getTaskAssignees: "canManageTasks",
  createTask: "canManageTasks",
  updateTask: "canManageTasks",
  updateAssignedTask: ["canViewTasks", "canManageTasks"],
  archiveTask: "canManageTasks",
  reopenTask: "canManageTasks",
  createTaskExpense: "canAddExpense",
};

describe("Tasks permissions", () => {
  it("publishes separate view and management permissions", () => {
    expect(ALL_PERMISSION_KEYS).toEqual(expect.arrayContaining(["canViewTasks", "canManageTasks"]));
    expect(actionAllowed("staff", {}, TASK_PERMISSIONS.listTasks)).toBe("forbidden");
    expect(actionAllowed("staff", { canViewTasks: true }, TASK_PERMISSIONS.listTasks)).toBe("allowed");
    expect(actionAllowed("staff", { canViewTasks: true }, TASK_PERMISSIONS.updateAssignedTask)).toBe("allowed");
    expect(actionAllowed("staff", { canViewTasks: true }, TASK_PERMISSIONS.createTask)).toBe("forbidden");
    expect(actionAllowed("staff", { canManageTasks: true }, TASK_PERMISSIONS.listTasks)).toBe("allowed");
    expect(actionAllowed("staff", { canManageTasks: true }, TASK_PERMISSIONS.archiveTask)).toBe("allowed");
    expect(actionAllowed("staff", { canManageTasks: true }, TASK_PERMISSIONS.createTaskExpense)).toBe("forbidden");
    expect(actionAllowed("staff", { canAddExpense: true }, TASK_PERMISSIONS.createTaskExpense)).toBe("allowed");
    expect(actionAllowed("admin", {}, TASK_PERMISSIONS.createTask)).toBe("allowed");
  });
});

describe("Tasks implementation wiring", () => {
  it("keeps the task API ownership and lifecycle guards server-side", () => {
    const route = readFileSync("src/app/api/admin/tasks/route.ts", "utf8");
    expect(route).toContain('updateAssignedTask: ["canViewTasks", "canManageTasks"]');
    expect(route).toContain('createTaskExpense: "canAddExpense"');
    expect(route).toContain("actorUser.id !== task.assigneeUserId");
    expect(route).toContain("Archived tasks cannot be updated");
    expect(route).toContain("Only a task manager can reopen a completed task");
    expect(route).toContain("This task already has a linked expense");
  });

  it("limits bill uploads and requires assignment or task management access", () => {
    const route = readFileSync("src/app/api/admin/tasks/upload/route.ts", "utf8");
    expect(route).toContain("image/jpeg");
    expect(route).toContain("application/pdf");
    expect(route).toContain("10 * 1024 * 1024");
    expect(route).toContain("existing.length >= 5");
    expect(route).toContain("Only the assigned user can upload to this task");
  });

  it("wires tasks into schema, migration, dashboard, management UI, and sync", () => {
    const schema = readFileSync("src/db/schema.ts", "utf8");
    const migration = readFileSync("migrations/0055_tasks.sql", "utf8");
    const sync = readFileSync("src/lib/syncEngine.ts", "utf8");
    const dashboard = readFileSync("src/app/api/admin/checkins/route.ts", "utf8");
    const management = readFileSync("src/components/admin/AdminManagement.tsx", "utf8");
    expect(schema).toContain('export const tasks = sqliteTable("tasks"');
    expect(schema).toContain('taskId: integer("task_id")');
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS tasks");
    expect(migration).toContain("ALTER TABLE expenses ADD COLUMN task_id");
    expect(sync).toContain('tasks: schema.tasks');
    expect(sync).toContain('tasks: { assigneeUserId: "users" }');
    expect(dashboard).toContain("myTasks");
    expect(management).toContain('id: "tasks"');
    expect(management).toContain("canViewTasks");
    expect(management).toContain("canManageTasks");
  });
});
