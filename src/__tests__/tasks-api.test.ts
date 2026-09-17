import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: { role: "staff", displayName: "Staff", permissions: { canViewTasks: true } } as any,
  actor: { id: 1, username: "staff", displayName: "Staff", role: "staff", deletedAt: null },
  task: {
    tasks: { id: 10, title: "Buy soap", description: "", taskType: "purchase", category: "Supplies", priority: "normal", dueDate: "", assigneeUserId: 1, status: "todo", note: "", attachments: "[]", completedAt: "", completedBy: "", createdBy: "admin", updatedBy: "admin", createdAt: "2026-09-17", updatedAt: "2026-09-17", deletedAt: null },
    users: { id: 1, username: "staff", displayName: "Staff", role: "staff" },
    expenses: null,
  } as any,
  getTasks: vi.fn(), getTaskById: vi.fn(), getTaskAssignees: vi.fn(), getTaskExpense: vi.fn(), getUserById: vi.fn(), getUserByUsername: vi.fn(),
  createTask: vi.fn(), updateTask: vi.fn(), archiveTask: vi.fn(), addExpense: vi.fn(), addAuditEntry: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ authenticateUser: vi.fn(async () => mocks.auth) }));
vi.mock("@/db/queries", () => ({
  addExpense: mocks.addExpense, addAuditEntry: mocks.addAuditEntry, createTask: mocks.createTask,
  getTaskAssignees: mocks.getTaskAssignees, getTaskById: mocks.getTaskById, getTaskExpense: mocks.getTaskExpense,
  getTasks: mocks.getTasks, getUserById: mocks.getUserById, getUserByUsername: mocks.getUserByUsername,
  updateTask: mocks.updateTask, archiveTask: mocks.archiveTask,
}));
vi.mock("@/lib/reconciliation", () => ({ isValidReconciliationDate: vi.fn(() => true) }));
vi.mock("@/lib/utils", () => ({ todayIST: () => "2026-09-17" }));

import { POST } from "@/app/api/admin/tasks/route";

function request(body: Record<string, unknown>, username = "staff") {
  return new NextRequest("http://localhost/api/admin/tasks", { method: "POST", body: JSON.stringify({ password: "pw", username, ...body }), headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  mocks.auth = { role: "staff", displayName: "Staff", permissions: { canViewTasks: true } };
  mocks.actor = { id: 1, username: "staff", displayName: "Staff", role: "staff", deletedAt: null };
  mocks.task.tasks.assigneeUserId = 1;
  mocks.task.tasks.status = "todo";
  mocks.task.tasks.deletedAt = null;
  mocks.task.expenses = null;
  mocks.getTaskById.mockResolvedValue(mocks.task);
  mocks.getTaskExpense.mockResolvedValue(null);
  mocks.getUserByUsername.mockResolvedValue(mocks.actor);
  mocks.getUserById.mockResolvedValue(mocks.actor);
  mocks.createTask.mockResolvedValue(22);
  mocks.addExpense.mockResolvedValue(31);
  mocks.updateTask.mockResolvedValue(undefined);
  mocks.archiveTask.mockResolvedValue(undefined);
  mocks.addAuditEntry.mockResolvedValue(undefined);
  vi.clearAllMocks();
});

describe("Tasks API mock workflows", () => {
  it("rejects an assigned-task update from a different user", async () => {
    mocks.actor.id = 2;
    const response = await POST(request({ action: "updateAssignedTask", taskId: 10, status: "done" }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "Only the assigned user can update this task" });
    expect(mocks.updateTask).not.toHaveBeenCalled();
  });

  it("lets the assigned user complete a task and records completion metadata", async () => {
    const response = await POST(request({ action: "updateAssignedTask", taskId: 10, status: "done", note: "Bought and delivered" }));
    expect(response.status).toBe(200);
    expect(mocks.updateTask).toHaveBeenCalledWith(10, expect.objectContaining({ status: "done", note: "Bought and delivered", completedBy: "staff" }));
    expect(mocks.addAuditEntry).toHaveBeenCalledWith(expect.objectContaining({ action: "task_updated", target: "task:10" }));
  });

  it("allows a task manager to create and archive a task", async () => {
    mocks.auth = { role: "manager", displayName: "Manager", permissions: { canManageTasks: true } };
    mocks.actor = { id: 3, username: "manager", displayName: "Manager", role: "manager", deletedAt: null };
    mocks.getUserByUsername.mockResolvedValue(mocks.actor);
    const createResponse = await POST(request({ action: "createTask", title: "Fix tap", assigneeUserId: 1, taskType: "general", priority: "high" }, "manager"));
    expect(createResponse.status).toBe(200);
    expect(mocks.createTask).toHaveBeenCalledWith(expect.objectContaining({ title: "Fix tap", assigneeUserId: 1, priority: "high" }));
    const archiveResponse = await POST(request({ action: "archiveTask", taskId: 10 }, "manager"));
    expect(archiveResponse.status).toBe(200);
    expect(mocks.archiveTask).toHaveBeenCalledWith(10, "manager");
  });

  it("records one linked purchase expense and rejects a duplicate", async () => {
    mocks.auth = { role: "staff", displayName: "Staff", permissions: { canAddExpense: true } };
    const response = await POST(request({ action: "createTaskExpense", taskId: 10, amount: 1250, category: "Supplies", paymentMethod: "cash" }));
    expect(response.status).toBe(200);
    expect(mocks.addExpense).toHaveBeenCalledWith(expect.objectContaining({ taskId: 10, amount: 1250 }));

    mocks.getTaskExpense.mockResolvedValue({ id: 31 });
    const duplicate = await POST(request({ action: "createTaskExpense", taskId: 10, amount: 1250, category: "Supplies", paymentMethod: "cash" }));
    expect(duplicate.status).toBe(409);
  });
});
