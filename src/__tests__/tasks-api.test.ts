import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: { role: "staff", displayName: "Staff", permissions: { canViewTasks: true } } as any,
  actor: { id: 1, username: "staff", displayName: "Staff", role: "staff", deletedAt: null },
  task: {
    tasks: {
      id: 10, title: "Buy soap", description: "", taskType: "purchase", category: "Supplies", priority: "normal", dueDate: "",
      assigneeUserId: 1, status: "todo", note: "", notes: "[]", shoppingItems: "[]", attachments: "[]",
      followerUsernames: '["staff","manager"]', completedAt: "", completedBy: "", createdBy: "admin", updatedBy: "admin",
      createdAt: "2026-09-17", updatedAt: "2026-09-17", deletedAt: null,
    },
    users: { id: 1, username: "staff", displayName: "Staff", role: "staff" },
    expenses: null,
  } as any,
  getTasks: vi.fn(), getTaskById: vi.fn(), getTaskAssignees: vi.fn(), getTaskExpense: vi.fn(), getUserById: vi.fn(), getUserByUsername: vi.fn(),
  createTask: vi.fn(), updateTask: vi.fn(), archiveTask: vi.fn(), unlinkExpenseFromTask: vi.fn(), deleteTaskHard: vi.fn(),
  addExpense: vi.fn(), addAuditEntry: vi.fn(), dispatchPushToUsers: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ authenticateUser: vi.fn(async () => mocks.auth) }));
vi.mock("@/db/queries", () => ({
  addExpense: mocks.addExpense, addAuditEntry: mocks.addAuditEntry, createTask: mocks.createTask,
  getTaskAssignees: mocks.getTaskAssignees, getTaskById: mocks.getTaskById, getTaskExpense: mocks.getTaskExpense,
  getTasks: mocks.getTasks, getUserById: mocks.getUserById, getUserByUsername: mocks.getUserByUsername,
  updateTask: mocks.updateTask, archiveTask: mocks.archiveTask,
  unlinkExpenseFromTask: mocks.unlinkExpenseFromTask, deleteTaskHard: mocks.deleteTaskHard,
}));
vi.mock("@/lib/reconciliation", () => ({ isValidReconciliationDate: vi.fn(() => true) }));
vi.mock("@/lib/utils", () => ({ todayIST: () => "2026-09-17" }));
vi.mock("@/lib/pushNotify", () => ({ dispatchPushToUsers: mocks.dispatchPushToUsers }));

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
  mocks.task.tasks.taskType = "purchase";
  mocks.task.tasks.notes = "[]";
  mocks.task.tasks.shoppingItems = "[]";
  mocks.task.tasks.followerUsernames = '["staff","manager"]';
  mocks.task.expenses = null;
  mocks.getTaskById.mockResolvedValue(mocks.task);
  mocks.getTaskExpense.mockResolvedValue(null);
  mocks.getUserByUsername.mockResolvedValue(mocks.actor);
  mocks.getUserById.mockResolvedValue(mocks.actor);
  mocks.getTaskAssignees.mockResolvedValue([
    { id: 1, username: "staff", displayName: "Staff", role: "staff" },
    { id: 3, username: "manager", displayName: "Manager", role: "manager" },
    { id: 4, username: "other", displayName: "Other", role: "staff" },
  ]);
  mocks.createTask.mockResolvedValue(22);
  mocks.addExpense.mockResolvedValue(31);
  mocks.updateTask.mockResolvedValue(undefined);
  mocks.archiveTask.mockResolvedValue(undefined);
  mocks.unlinkExpenseFromTask.mockResolvedValue(undefined);
  mocks.deleteTaskHard.mockResolvedValue(undefined);
  mocks.addAuditEntry.mockResolvedValue(undefined);
  mocks.dispatchPushToUsers.mockResolvedValue(undefined);
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

  it("lets the assigned user complete a task and notifies followers", async () => {
    const response = await POST(request({ action: "updateAssignedTask", taskId: 10, status: "done" }));
    expect(response.status).toBe(200);
    expect(mocks.updateTask).toHaveBeenCalledWith(10, expect.objectContaining({ status: "done", completedBy: "staff" }));
    expect(mocks.dispatchPushToUsers).toHaveBeenCalledWith(expect.objectContaining({ notificationType: "task.completed" }), ["manager"]);
  });

  it("notifies followers on non-done status changes", async () => {
    const response = await POST(request({ action: "updateAssignedTask", taskId: 10, status: "in_progress" }));
    expect(response.status).toBe(200);
    expect(mocks.dispatchPushToUsers).toHaveBeenCalledWith(expect.objectContaining({ notificationType: "task.status_changed" }), ["manager"]);
  });

  it("does not notify followers when an already-complete task is saved as done again", async () => {
    mocks.task.tasks.status = "done";
    const response = await POST(request({ action: "updateAssignedTask", taskId: 10, status: "done" }));
    expect(response.status).toBe(200);
    expect(mocks.dispatchPushToUsers).not.toHaveBeenCalled();
  });

  it("appends a note for assignee without push", async () => {
    const response = await POST(request({ action: "addTaskNote", taskId: 10, body: "Bought half" }));
    expect(response.status).toBe(200);
    expect(mocks.updateTask).toHaveBeenCalledWith(10, expect.objectContaining({ notes: expect.stringContaining("Bought half") }));
    expect(mocks.dispatchPushToUsers).not.toHaveBeenCalled();
  });

  it("rejects note add from a non-collaborator", async () => {
    mocks.actor = { id: 99, username: "stranger", displayName: "Stranger", role: "staff", deletedAt: null };
    mocks.getUserByUsername.mockResolvedValue(mocks.actor);
    mocks.task.tasks.assigneeUserId = 1;
    mocks.task.tasks.followerUsernames = '["manager"]';
    const response = await POST(request({ action: "addTaskNote", taskId: 10, body: "Nope" }, "stranger"));
    expect(response.status).toBe(403);
  });

  it("lets a follower add a note", async () => {
    mocks.auth = { role: "manager", displayName: "Manager", permissions: { canViewTasks: true } };
    mocks.actor = { id: 3, username: "manager", displayName: "Manager", role: "manager", deletedAt: null };
    mocks.getUserByUsername.mockResolvedValue(mocks.actor);
    mocks.task.tasks.assigneeUserId = 1;
    const response = await POST(request({ action: "addTaskNote", taskId: 10, body: "Following up" }, "manager"));
    expect(response.status).toBe(200);
    expect(mocks.updateTask).toHaveBeenCalled();
  });

  it("creates a shopping list task with items", async () => {
    mocks.auth = { role: "manager", displayName: "Manager", permissions: { canManageTasks: true } };
    mocks.actor = { id: 3, username: "manager", displayName: "Manager", role: "manager", deletedAt: null };
    mocks.getUserByUsername.mockResolvedValue(mocks.actor);
    const response = await POST(request({ action: "createTask", title: "Market run", taskType: "shopping", shoppingItems: ["Milk", "Eggs"] }, "manager"));
    expect(response.status).toBe(200);
    expect(mocks.createTask).toHaveBeenCalledWith(expect.objectContaining({
      taskType: "shopping",
      shoppingItems: expect.stringContaining("Milk"),
    }));
  });

  it("auto-completes a shopping task when the last item is bought", async () => {
    mocks.task.tasks.taskType = "shopping";
    mocks.task.tasks.shoppingItems = JSON.stringify([
      { id: "a", label: "Milk", bought: true, boughtAt: "t", boughtBy: "staff" },
      { id: "b", label: "Eggs", bought: false },
    ]);
    const response = await POST(request({ action: "toggleShoppingItem", taskId: 10, itemId: "b" }));
    expect(response.status).toBe(200);
    expect(mocks.updateTask).toHaveBeenCalledWith(10, expect.objectContaining({ status: "done", shoppingItems: expect.stringContaining('"bought":true') }));
    expect(mocks.dispatchPushToUsers).toHaveBeenCalledWith(expect.objectContaining({ notificationType: "task.completed" }), ["manager"]);
  });

  it("reopens to in_progress when an item is unbought after done", async () => {
    mocks.task.tasks.taskType = "shopping";
    mocks.task.tasks.status = "done";
    mocks.task.tasks.shoppingItems = JSON.stringify([
      { id: "a", label: "Milk", bought: true, boughtAt: "t", boughtBy: "staff" },
    ]);
    const response = await POST(request({ action: "toggleShoppingItem", taskId: 10, itemId: "a" }));
    expect(response.status).toBe(200);
    expect(mocks.updateTask).toHaveBeenCalledWith(10, expect.objectContaining({ status: "in_progress", completedAt: "", completedBy: "" }));
    expect(mocks.dispatchPushToUsers).toHaveBeenCalledWith(expect.objectContaining({ notificationType: "task.status_changed" }), ["manager"]);
  });

  it("rejects shopping toggle on purchase tasks", async () => {
    const response = await POST(request({ action: "toggleShoppingItem", taskId: 10, itemId: "x" }));
    expect(response.status).toBe(400);
  });

  it("lets a manager replace the shopping item list", async () => {
    mocks.auth = { role: "manager", displayName: "Manager", permissions: { canManageTasks: true } };
    mocks.actor = { id: 3, username: "manager", displayName: "Manager", role: "manager", deletedAt: null };
    mocks.getUserByUsername.mockResolvedValue(mocks.actor);
    mocks.task.tasks.taskType = "shopping";
    mocks.task.tasks.shoppingItems = JSON.stringify([{ id: "a", label: "Milk", bought: true, boughtAt: "t", boughtBy: "staff" }]);
    const response = await POST(request({ action: "setShoppingItems", taskId: 10, shoppingItems: [{ id: "a", label: "Milk 2L" }, "Bread"] }, "manager"));
    expect(response.status).toBe(200);
    expect(mocks.updateTask).toHaveBeenCalledWith(10, expect.objectContaining({
      shoppingItems: expect.stringContaining("Milk 2L"),
    }));
    const payload = mocks.updateTask.mock.calls[0][1] as { shoppingItems: string };
    expect(JSON.parse(payload.shoppingItems).find((item: { label: string }) => item.label === "Milk 2L")?.bought).toBe(true);
  });

  it("surfaces a legacy free-text note as a journal entry when notes is empty", async () => {
    mocks.getTasks.mockResolvedValue([{
      ...mocks.task,
      tasks: { ...mocks.task.tasks, notes: "[]", note: "Old paper note" },
    }]);
    const response = await POST(request({ action: "listTasks" }));
    expect(response.status).toBe(200);
    const notes = (await response.json()).tasks[0].notes;
    expect(notes).toHaveLength(1);
    expect(notes[0].body).toBe("Old paper note");
    expect(notes[0].id).toMatch(/^legacy-/);
  });

  it("allows a task manager to create and archive a task", async () => {
    mocks.auth = { role: "manager", displayName: "Manager", permissions: { canManageTasks: true } };
    mocks.actor = { id: 3, username: "manager", displayName: "Manager", role: "manager", deletedAt: null };
    mocks.getUserByUsername.mockResolvedValue(mocks.actor);
    const createResponse = await POST(request({ action: "createTask", title: "Fix tap", assigneeUserId: 1, taskType: "general", priority: "high" }, "manager"));
    expect(createResponse.status).toBe(200);
    expect(mocks.createTask).toHaveBeenCalledWith(expect.objectContaining({ title: "Fix tap", assigneeUserId: 1, priority: "high" }));
    expect(mocks.createTask).toHaveBeenCalledWith(expect.objectContaining({ followerUsernames: '["manager","staff"]' }));
    expect(mocks.dispatchPushToUsers).toHaveBeenCalledWith(expect.objectContaining({ notificationType: "task.assigned" }), ["staff"]);
    const archiveResponse = await POST(request({ action: "archiveTask", taskId: 10 }, "manager"));
    expect(archiveResponse.status).toBe(200);
    expect(mocks.archiveTask).toHaveBeenCalledWith(10, "manager");
  });

  it("honors an explicit follower list and rejects inactive follower names", async () => {
    mocks.auth = { role: "manager", displayName: "Manager", permissions: { canManageTasks: true } };
    mocks.actor = { id: 3, username: "manager", displayName: "Manager", role: "manager", deletedAt: null };
    mocks.getUserByUsername.mockResolvedValue(mocks.actor);
    mocks.getUserById.mockResolvedValue({ id: 1, username: "staff", displayName: "Staff", role: "staff", deletedAt: null });

    const response = await POST(request({ action: "createTask", title: "Fix tap", assigneeUserId: 1, followerUsernames: [] }, "manager"));
    expect(response.status).toBe(200);
    expect(mocks.createTask).toHaveBeenCalledWith(expect.objectContaining({ followerUsernames: "[]" }));

    const invalid = await POST(request({ action: "createTask", title: "Fix tap", followerUsernames: ["deleted-user"] }, "manager"));
    expect(invalid.status).toBe(400);
  });

  it("adds and notifies a new assignee while preserving existing followers", async () => {
    mocks.auth = { role: "manager", displayName: "Manager", permissions: { canManageTasks: true } };
    mocks.getUserById.mockResolvedValue({ id: 4, username: "other", displayName: "Other", role: "staff", deletedAt: null });
    const response = await POST(request({ action: "updateTask", taskId: 10, assigneeUserId: 4 }, "staff"));
    expect(response.status).toBe(200);
    expect(mocks.updateTask).toHaveBeenCalledWith(10, expect.objectContaining({ assigneeUserId: 4, followerUsernames: '["staff","manager","other"]' }));
    expect(mocks.dispatchPushToUsers).toHaveBeenCalledWith(expect.objectContaining({ notificationType: "task.assigned" }), ["other"]);
  });

  it("notifies final followers except the actor only on the first manager completion", async () => {
    mocks.auth = { role: "manager", displayName: "Manager", permissions: { canManageTasks: true } };
    mocks.actor = { id: 3, username: "manager", displayName: "Manager", role: "manager", deletedAt: null };
    mocks.getUserByUsername.mockResolvedValue(mocks.actor);
    const response = await POST(request({ action: "updateTask", taskId: 10, status: "done", followerUsernames: ["staff", "manager"] }, "manager"));
    expect(response.status).toBe(200);
    expect(mocks.dispatchPushToUsers).toHaveBeenCalledWith(expect.objectContaining({ notificationType: "task.completed" }), ["staff"]);
  });

  it("notifies status_changed on reopen", async () => {
    mocks.auth = { role: "manager", displayName: "Manager", permissions: { canManageTasks: true } };
    mocks.actor = { id: 3, username: "manager", displayName: "Manager", role: "manager", deletedAt: null };
    mocks.getUserByUsername.mockResolvedValue(mocks.actor);
    mocks.task.tasks.status = "done";
    const response = await POST(request({ action: "reopenTask", taskId: 10 }, "manager"));
    expect(response.status).toBe(200);
    expect(mocks.dispatchPushToUsers).toHaveBeenCalledWith(expect.objectContaining({ notificationType: "task.status_changed" }), ["staff"]);
  });

  it("allows a task manager to create a title-only unassigned task", async () => {
    mocks.auth = { role: "manager", displayName: "Manager", permissions: { canManageTasks: true } };
    mocks.actor = { id: 3, username: "manager", displayName: "Manager", role: "manager", deletedAt: null };
    mocks.getUserByUsername.mockResolvedValue(mocks.actor);

    const response = await POST(request({ action: "createTask", title: "Review stock list" }, "manager"));
    expect(response.status).toBe(200);
    expect(mocks.createTask).toHaveBeenCalledWith(expect.objectContaining({
      title: "Review stock list", assigneeUserId: null, taskType: "general", priority: "normal", dueDate: "",
    }));
    expect(mocks.getUserById).not.toHaveBeenCalled();
    expect(mocks.addAuditEntry).toHaveBeenCalledWith(expect.objectContaining({ details: "Review stock list → Unassigned" }));
  });

  it("returns only active follower summaries in task lists", async () => {
    mocks.getTasks.mockResolvedValue([mocks.task]);
    const response = await POST(request({ action: "listTasks" }));
    expect(response.status).toBe(200);
    expect((await response.json()).tasks[0].followers.map((follower: { username: string }) => follower.username)).toEqual(["staff", "manager"]);
  });

  it("allows a task manager to clear an existing assignment", async () => {
    mocks.auth = { role: "manager", displayName: "Manager", permissions: { canManageTasks: true } };
    const response = await POST(request({ action: "updateTask", taskId: 10, assigneeUserId: "" }, "manager"));
    expect(response.status).toBe(200);
    expect(mocks.updateTask).toHaveBeenCalledWith(10, expect.objectContaining({ assigneeUserId: null }));
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

  it("lets admin hard-delete an archived task and unlink its expense", async () => {
    mocks.auth = { role: "admin", displayName: "Admin", permissions: {} };
    mocks.actor = { id: 9, username: "admin", displayName: "Admin", role: "admin", deletedAt: null };
    mocks.getUserByUsername.mockResolvedValue(mocks.actor);
    mocks.task.tasks.deletedAt = "2026-09-20T00:00:00.000Z";
    const response = await POST(request({ action: "deleteArchivedTask", taskId: 10 }, "admin"));
    expect(response.status).toBe(200);
    expect(mocks.unlinkExpenseFromTask).toHaveBeenCalledWith(10);
    expect(mocks.deleteTaskHard).toHaveBeenCalledWith(10);
  });

  it("rejects hard-delete for non-admin and for active tasks", async () => {
    mocks.auth = { role: "manager", displayName: "Manager", permissions: { canManageTasks: true } };
    const forbidden = await POST(request({ action: "deleteArchivedTask", taskId: 10 }, "manager"));
    expect(forbidden.status).toBe(403);

    mocks.auth = { role: "admin", displayName: "Admin", permissions: {} };
    mocks.actor = { id: 9, username: "admin", displayName: "Admin", role: "admin", deletedAt: null };
    mocks.getUserByUsername.mockResolvedValue(mocks.actor);
    mocks.task.tasks.deletedAt = null;
    const active = await POST(request({ action: "deleteArchivedTask", taskId: 10 }, "admin"));
    expect(active.status).toBe(409);
  });
});
