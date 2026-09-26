import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth";
import { actionAllowed, type ActionPerm, type UserRole } from "@/lib/actionPermissions";
import {
  addExpense, addAuditEntry, createTask, getTaskAssignees, getTaskById, getTaskExpense,
  getTasks, getUserById, getUserByUsername, updateTask, archiveTask, unlinkExpenseFromTask, deleteTaskHard,
} from "@/db/queries";
import { isValidReconciliationDate } from "@/lib/reconciliation";
import { todayIST } from "@/lib/utils";
import { dispatchPushToUsers } from "@/lib/pushNotify";
import {
  TASK_TYPES,
  appendTaskNoteEntry,
  buildShoppingItemsFromInput,
  canCollaborateOnTask,
  parseShoppingItems,
  parseTaskNotes,
  toggleShoppingItemInList,
} from "@/lib/taskNotesShopping";

const STATUSES = new Set(["todo", "in_progress", "blocked", "done"]);
const PRIORITIES = new Set(["low", "normal", "high", "urgent"]);
const TASK_TYPE_SET = new Set<string>(TASK_TYPES);
const STATUS_LABELS: Record<string, string> = {
  todo: "To do",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
};

function validId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function jsonAttachments(value: string | null | undefined): { name: string; mime: string; link: string; uploadedBy: string; uploadedAt: string }[] {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.link === "string") : [];
  } catch {
    return [];
  }
}

function validDate(value: unknown): value is string {
  return value === "" || (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

type TaskUser = Awaited<ReturnType<typeof getTaskAssignees>>[number];

function jsonUsernames(value: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? [...new Set(parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()))] : [];
  } catch {
    return [];
  }
}

function presentTask(row: Awaited<ReturnType<typeof getTaskById>>, activeUsers: Map<string, TaskUser>) {
  if (!row) return null;
  const task = row.tasks;
  const notes = parseTaskNotes(task.notes);
  const legacyNote = typeof task.note === "string" ? task.note.trim() : "";
  return {
    ...task,
    notes: notes.length > 0 ? notes : (legacyNote ? [{ id: `legacy-${task.id}`, body: legacyNote, authorUsername: task.updatedBy || task.createdBy, createdAt: task.updatedAt || task.createdAt }] : []),
    shoppingItems: parseShoppingItems(task.shoppingItems),
    attachments: jsonAttachments(task.attachments),
    followers: jsonUsernames(task.followerUsernames).map((name) => activeUsers.get(name)).filter(Boolean),
    assignee: row.users ? {
      id: row.users.id,
      username: row.users.username,
      displayName: row.users.displayName,
      role: row.users.role,
    } : null,
    expense: row.expenses ? {
      id: row.expenses.id,
      amount: row.expenses.amount,
      category: row.expenses.category,
      purpose: row.expenses.purpose,
      expenseDate: row.expenses.expenseDate,
    } : null,
  };
}

function taskPushBody(title: string, actorName: string) {
  return `${title} · by ${actorName}`;
}

async function resolveFollowers(value: unknown) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return null;
  const users = await getTaskAssignees();
  const active = new Map(users.map((user) => [user.username, user]));
  const usernames = [...new Set(value.map((item) => item.trim()).filter(Boolean))];
  if (usernames.some((name) => !active.has(name))) return null;
  return usernames;
}

async function notifyTaskAssigned(taskId: number, title: string, actorName: string, usernames: string[]) {
  await dispatchPushToUsers({
    notificationType: "task.assigned",
    title: "Task assigned",
    body: taskPushBody(title, actorName),
    url: "/admin?section=management&tab=tasks",
    eventId: `task-assigned-${taskId}-${usernames.join("-")}`,
  }, usernames);
}

async function notifyTaskCompleted(taskId: number, title: string, actorName: string, usernames: string[]) {
  await dispatchPushToUsers({
    notificationType: "task.completed",
    title: "Task completed",
    body: taskPushBody(title, actorName),
    url: "/admin?section=management&tab=tasks",
    eventId: `task-completed-${taskId}`,
  }, usernames);
}

async function notifyTaskStatusChanged(taskId: number, title: string, actorName: string, fromStatus: string, toStatus: string, usernames: string[]) {
  await dispatchPushToUsers({
    notificationType: "task.status_changed",
    title: "Task status changed",
    body: `${title} · ${STATUS_LABELS[fromStatus] || fromStatus} → ${STATUS_LABELS[toStatus] || toStatus} · by ${actorName}`,
    url: "/admin?section=management&tab=tasks",
    eventId: `task-status-${taskId}-${toStatus}-${Date.now()}`,
  }, usernames);
}

async function notifyStatusTransition(opts: {
  taskId: number;
  title: string;
  actorName: string;
  actorUsername?: string | null;
  followerUsernames: string[];
  fromStatus: string;
  toStatus: string;
}) {
  if (opts.fromStatus === opts.toStatus) return;
  const recipients = opts.followerUsernames.filter((name) => name !== opts.actorUsername);
  if (recipients.length === 0) return;
  if (opts.fromStatus !== "done" && opts.toStatus === "done") {
    await notifyTaskCompleted(opts.taskId, opts.title, opts.actorName, recipients);
    return;
  }
  await notifyTaskStatusChanged(opts.taskId, opts.title, opts.actorName, opts.fromStatus, opts.toStatus, recipients);
}

async function getActorUser(username: string | undefined) {
  return username ? getUserByUsername(username) : null;
}

function taskError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function isManager(auth: { role: UserRole; permissions: Record<string, boolean> }) {
  return auth.role === "admin" || actionAllowed(auth.role, auth.permissions, "canManageTasks") === "allowed";
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { password, username, action, ...rest } = body;
    const auth = await authenticateUser(password, username);
    if (!auth) return taskError("Unauthorized", 401);

    const ACTION_PERMISSIONS: Record<string, ActionPerm> = {
      listTasks: ["canViewTasks", "canManageTasks"],
      getTaskAssignees: "canManageTasks",
      createTask: "canManageTasks",
      updateTask: "canManageTasks",
      updateAssignedTask: ["canViewTasks", "canManageTasks"],
      addTaskNote: ["canViewTasks", "canManageTasks"],
      setShoppingItems: "canManageTasks",
      toggleShoppingItem: ["canViewTasks", "canManageTasks"],
      archiveTask: "canManageTasks",
      reopenTask: "canManageTasks",
      deleteArchivedTask: "admin_only",
      createTaskExpense: "canAddExpense",
    };
    const gate = actionAllowed(auth.role, auth.permissions, ACTION_PERMISSIONS[action]);
    if (gate === "admin_required") return taskError("Admin access required", 403);
    if (gate === "forbidden") return taskError("You don't have permission to perform this action", 403);

    const actorName = auth.username || username || auth.displayName || auth.role;
    const actorUser = await getActorUser(auth.username || username);
    const actorUsername = actorUser?.username || auth.username || username;
    const canManage = isManager(auth);

    if (action === "listTasks") {
      const includeArchived = Boolean(rest.includeArchived && (auth.role === "admin" || auth.permissions.canManageTasks));
      const [rows, activeUserRows] = await Promise.all([getTasks({ includeArchived }), getTaskAssignees()]);
      const activeUsers = new Map(activeUserRows.map((user) => [user.username, user]));
      return NextResponse.json({ tasks: rows.map((row) => presentTask(row, activeUsers)).filter(Boolean), role: auth.role });
    }

    if (action === "getTaskAssignees") {
      return NextResponse.json({ users: await getTaskAssignees() });
    }

    if (action === "createTask") {
      const title = typeof rest.title === "string" ? rest.title.trim() : "";
      const hasAssignee = rest.assigneeUserId !== undefined && rest.assigneeUserId !== null && String(rest.assigneeUserId).trim() !== "";
      const assigneeUserId = hasAssignee ? Number(rest.assigneeUserId) : null;
      const taskType = rest.taskType || "general";
      if (!title || title.length > 200) return taskError("A title between 1 and 200 characters is required");
      if (hasAssignee && !validId(assigneeUserId)) return taskError("Assignee must be a valid user");
      if (!TASK_TYPE_SET.has(taskType)) return taskError("Invalid task type");
      if (!PRIORITIES.has(rest.priority || "normal")) return taskError("Invalid priority");
      if (!validDate(rest.dueDate || "")) return taskError("dueDate must be YYYY-MM-DD");
      const assignee = assigneeUserId ? await getUserById(assigneeUserId) : null;
      if (hasAssignee && (!assignee || assignee.deletedAt)) return taskError("Assignee is not available", 404);
      const resolvedFollowers = rest.followerUsernames === undefined ? null : await resolveFollowers(rest.followerUsernames);
      if (rest.followerUsernames !== undefined && !resolvedFollowers) return taskError("Followers must be active users");
      const followerUsernames = resolvedFollowers || [...new Set([actorUser && !actorUser.deletedAt ? actorUser.username : null, assignee?.username].filter((name): name is string => Boolean(name)))];
      let shoppingItems = "[]";
      if (taskType === "shopping") {
        const built = buildShoppingItemsFromInput(rest.shoppingItems ?? []);
        if (!built.ok) return taskError(built.error);
        shoppingItems = built.json;
      }
      const id = await createTask({
        title,
        description: typeof rest.description === "string" ? rest.description.trim().slice(0, 5000) : "",
        taskType,
        category: typeof rest.category === "string" ? rest.category.trim().slice(0, 100) : "",
        priority: rest.priority || "normal",
        dueDate: rest.dueDate || "",
        assigneeUserId,
        followerUsernames: JSON.stringify(followerUsernames),
        notes: "[]",
        shoppingItems,
        createdBy: actorName,
        updatedBy: actorName,
      });
      await addAuditEntry({ username: actorName, action: "task_created", target: `task:${id}`, details: `${title} → ${assignee?.displayName || "Unassigned"}` });
      if (id && assignee?.username && assignee.username !== actorUsername) await notifyTaskAssigned(id, title, actorName, [assignee.username]);
      return NextResponse.json({ success: true, id });
    }

    const taskId = Number(rest.taskId);
    if (!validId(taskId)) return taskError("A valid task ID is required");
    const row = await getTaskById(taskId);
    if (!row) return taskError("Task not found", 404);
    const task = row.tasks;

    const collaborator = canCollaborateOnTask({
      canManage,
      actorUserId: actorUser?.id,
      actorUsername,
      assigneeUserId: task.assigneeUserId,
      followerUsernamesJson: task.followerUsernames,
    });

    if (action === "addTaskNote") {
      if (task.deletedAt) return taskError("Archived tasks cannot receive notes", 409);
      if (!collaborator) return taskError("Only managers, the assignee, or followers can add notes", 403);
      if (!actorUsername) return taskError("A signed-in username is required to add notes", 403);
      const appended = appendTaskNoteEntry(task.notes, typeof rest.body === "string" ? rest.body : "", actorUsername);
      if (!appended.ok) return taskError(appended.error);
      await updateTask(taskId, { notes: appended.json, updatedBy: actorName });
      await addAuditEntry({ username: actorName, action: "task_note_added", target: `task:${taskId}`, details: appended.notes[appended.notes.length - 1]?.id || "" });
      return NextResponse.json({ success: true, notes: appended.notes });
    }

    if (action === "setShoppingItems") {
      if (task.deletedAt) return taskError("Archived tasks cannot be updated", 409);
      if (task.taskType !== "shopping" && rest.taskType !== "shopping") return taskError("Only shopping list tasks have shopping items");
      const built = buildShoppingItemsFromInput(rest.shoppingItems ?? [], task.shoppingItems);
      if (!built.ok) return taskError(built.error);
      const data: Parameters<typeof updateTask>[1] = { shoppingItems: built.json, updatedBy: actorName };
      if (task.taskType !== "shopping") data.taskType = "shopping";
      const allBought = built.items.length > 0 && built.items.every((item) => item.bought);
      const fromStatus = task.status;
      let toStatus = fromStatus;
      if (allBought && fromStatus !== "done") {
        data.status = "done";
        data.completedAt = new Date().toISOString();
        data.completedBy = actorName;
        toStatus = "done";
      } else if (!allBought && fromStatus === "done" && built.items.some((item) => !item.bought)) {
        data.status = "in_progress";
        data.completedAt = "";
        data.completedBy = "";
        toStatus = "in_progress";
      }
      await updateTask(taskId, data);
      await addAuditEntry({ username: actorName, action: "task_shopping_set", target: `task:${taskId}`, details: `${built.items.length} items` });
      await notifyStatusTransition({
        taskId,
        title: task.title,
        actorName,
        actorUsername,
        followerUsernames: jsonUsernames(task.followerUsernames),
        fromStatus,
        toStatus,
      });
      return NextResponse.json({ success: true, shoppingItems: built.items, status: toStatus });
    }

    if (action === "toggleShoppingItem") {
      if (task.deletedAt) return taskError("Archived tasks cannot be updated", 409);
      if (task.taskType !== "shopping") return taskError("Only shopping list tasks have shopping items");
      if (!collaborator) return taskError("Only managers, the assignee, or followers can update shopping items", 403);
      if (!actorUsername) return taskError("A signed-in username is required", 403);
      const itemId = typeof rest.itemId === "string" ? rest.itemId : "";
      const toggled = toggleShoppingItemInList(task.shoppingItems, itemId, actorUsername);
      if (!toggled.ok) return taskError(toggled.error);
      const fromStatus = task.status;
      let toStatus = fromStatus;
      const data: Parameters<typeof updateTask>[1] = { shoppingItems: toggled.json, updatedBy: actorName };
      if (toggled.allBought && fromStatus !== "done") {
        data.status = "done";
        data.completedAt = new Date().toISOString();
        data.completedBy = actorName;
        toStatus = "done";
      } else if (toggled.anyOpen && fromStatus === "done") {
        data.status = "in_progress";
        data.completedAt = "";
        data.completedBy = "";
        toStatus = "in_progress";
      }
      await updateTask(taskId, data);
      await addAuditEntry({ username: actorName, action: "task_shopping_toggled", target: `task:${taskId}`, details: itemId });
      await notifyStatusTransition({
        taskId,
        title: task.title,
        actorName,
        actorUsername,
        followerUsernames: jsonUsernames(task.followerUsernames),
        fromStatus,
        toStatus,
      });
      return NextResponse.json({ success: true, shoppingItems: toggled.items, status: toStatus });
    }

    if (action === "updateAssignedTask") {
      if (task.deletedAt) return taskError("Archived tasks cannot be updated", 409);
      if (!actorUser || actorUser.id !== task.assigneeUserId) return taskError("Only the assigned user can update this task", 403);
      const status = rest.status;
      if (status !== undefined && !STATUSES.has(status)) return taskError("Invalid task status");
      if (task.status === "done" && status !== undefined && status !== "done" && !canManage) {
        return taskError("Only a task manager can reopen a completed task", 403);
      }
      const data: Parameters<typeof updateTask>[1] = { updatedBy: actorName };
      if (status !== undefined) data.status = status;
      if (status === "done") {
        data.completedAt = new Date().toISOString();
        data.completedBy = actorName;
      } else if (status && status !== "done") {
        data.completedAt = "";
        data.completedBy = "";
      }
      await updateTask(taskId, data);
      await addAuditEntry({ username: actorName, action: "task_updated", target: `task:${taskId}`, details: JSON.stringify({ status: status || task.status }) });
      if (status !== undefined) {
        await notifyStatusTransition({
          taskId,
          title: task.title,
          actorName,
          actorUsername,
          followerUsernames: jsonUsernames(task.followerUsernames),
          fromStatus: task.status,
          toStatus: status,
        });
      }
      return NextResponse.json({ success: true });
    }

    if (action === "updateTask") {
      if (task.deletedAt) return taskError("Archived tasks cannot be updated", 409);
      const data: Parameters<typeof updateTask>[1] = { updatedBy: actorName };
      let nextAssignee = row.users;
      let assigneeChanged = false;
      let followerUsernames = jsonUsernames(task.followerUsernames);
      if (rest.followerUsernames !== undefined) {
        const resolved = await resolveFollowers(rest.followerUsernames);
        if (!resolved) return taskError("Followers must be active users");
        followerUsernames = resolved;
        data.followerUsernames = JSON.stringify(followerUsernames);
      }
      if (typeof rest.title === "string") {
        const title = rest.title.trim();
        if (!title || title.length > 200) return taskError("A title between 1 and 200 characters is required");
        data.title = title;
      }
      if (typeof rest.description === "string") data.description = rest.description.trim().slice(0, 5000);
      if (typeof rest.category === "string") data.category = rest.category.trim().slice(0, 100);
      const nextType = rest.taskType !== undefined ? rest.taskType : task.taskType;
      if (rest.taskType !== undefined) {
        if (!TASK_TYPE_SET.has(rest.taskType)) return taskError("Invalid task type");
        if (rest.taskType === "general" && task.taskType === "purchase" && row.expenses) {
          return taskError("A purchase task with a recorded expense cannot become a general task", 409);
        }
        data.taskType = rest.taskType;
        if (rest.taskType !== "shopping") data.shoppingItems = "[]";
      }
      if (rest.shoppingItems !== undefined || (rest.taskType === "shopping" && rest.shoppingItems === undefined && task.taskType !== "shopping")) {
        if (nextType !== "shopping") return taskError("Only shopping list tasks have shopping items");
        const built = buildShoppingItemsFromInput(rest.shoppingItems ?? [], task.shoppingItems);
        if (!built.ok) return taskError(built.error);
        data.shoppingItems = built.json;
      }
      if (rest.priority !== undefined) {
        if (!PRIORITIES.has(rest.priority)) return taskError("Invalid priority");
        data.priority = rest.priority;
      }
      if (rest.dueDate !== undefined) {
        if (!validDate(rest.dueDate)) return taskError("dueDate must be YYYY-MM-DD");
        data.dueDate = rest.dueDate;
      }
      if (rest.assigneeUserId !== undefined) {
        const hasAssignee = rest.assigneeUserId !== null && String(rest.assigneeUserId).trim() !== "";
        if (!hasAssignee) {
          data.assigneeUserId = null;
          nextAssignee = null;
          assigneeChanged = task.assigneeUserId !== null;
        } else {
          const assigneeUserId = Number(rest.assigneeUserId);
          const assignee = validId(assigneeUserId) ? await getUserById(assigneeUserId) : null;
          if (!assignee || assignee.deletedAt) return taskError("Assignee is not available", 404);
          data.assigneeUserId = assigneeUserId;
          nextAssignee = assignee;
          assigneeChanged = task.assigneeUserId !== assigneeUserId;
          if (assigneeChanged && !followerUsernames.includes(assignee.username)) {
            followerUsernames = [...followerUsernames, assignee.username];
            data.followerUsernames = JSON.stringify(followerUsernames);
          }
        }
      }
      if (rest.status !== undefined) {
        if (!STATUSES.has(rest.status)) return taskError("Invalid task status");
        data.status = rest.status;
        if (rest.status === "done") {
          data.completedAt = new Date().toISOString();
          data.completedBy = actorName;
        } else {
          data.completedAt = "";
          data.completedBy = "";
        }
      }
      await updateTask(taskId, data);
      await addAuditEntry({ username: actorName, action: "task_updated", target: `task:${taskId}`, details: JSON.stringify({ ...rest, note: undefined }) });
      if (assigneeChanged && nextAssignee?.username && nextAssignee.username !== actorUsername) {
        await notifyTaskAssigned(taskId, data.title || task.title, actorName, [nextAssignee.username]);
      }
      if (rest.status !== undefined) {
        await notifyStatusTransition({
          taskId,
          title: data.title || task.title,
          actorName,
          actorUsername,
          followerUsernames,
          fromStatus: task.status,
          toStatus: rest.status,
        });
      }
      return NextResponse.json({ success: true });
    }

    if (action === "archiveTask") {
      if (task.deletedAt) return NextResponse.json({ success: true });
      await archiveTask(taskId, actorName);
      await addAuditEntry({ username: actorName, action: "task_archived", target: `task:${taskId}`, details: task.title });
      return NextResponse.json({ success: true });
    }

    if (action === "reopenTask") {
      if (task.deletedAt) return taskError("Archived tasks cannot be reopened", 409);
      const fromStatus = task.status;
      await updateTask(taskId, { status: "todo", completedAt: "", completedBy: "", updatedBy: actorName });
      await addAuditEntry({ username: actorName, action: "task_reopened", target: `task:${taskId}`, details: task.title });
      await notifyStatusTransition({
        taskId,
        title: task.title,
        actorName,
        actorUsername,
        followerUsernames: jsonUsernames(task.followerUsernames),
        fromStatus,
        toStatus: "todo",
      });
      return NextResponse.json({ success: true });
    }

    if (action === "deleteArchivedTask") {
      if (!task.deletedAt) return taskError("Only archived tasks can be permanently deleted", 409);
      await unlinkExpenseFromTask(taskId);
      await deleteTaskHard(taskId);
      await addAuditEntry({ username: actorName, action: "task_hard_deleted", target: `task:${taskId}`, details: task.title });
      return NextResponse.json({ success: true });
    }

    if (action === "createTaskExpense") {
      if (task.deletedAt) return taskError("Archived tasks cannot receive an expense", 409);
      if (task.taskType !== "purchase") return taskError("Only purchase tasks can create linked expenses");
      if (await getTaskExpense(taskId)) return taskError("This task already has a linked expense", 409);
      const amount = Number(rest.amount);
      const category = typeof rest.category === "string" ? rest.category.trim() : "";
      const expenseDate = rest.expenseDate || todayIST();
      const paymentMethod = rest.paymentMethod || "cash";
      if (!Number.isInteger(amount) || amount <= 0) return taskError("amount must be a positive integer in paise");
      if (!category) return taskError("category is required");
      if (!isValidReconciliationDate(expenseDate, todayIST())) return taskError("expenseDate must be a valid non-future date (YYYY-MM-DD)");
      if (!["cash", "online"].includes(paymentMethod)) return taskError("Invalid payment method");
      if (paymentMethod === "online" && !validId(Number(rest.accountId))) return taskError("An online account is required");
      const attachments = jsonAttachments(task.attachments);
      const billImageLink = attachments.map((attachment) => attachment.link).filter(Boolean).join(",");
      try {
        const expenseId = await addExpense({
          amount,
          category,
          customCategory: typeof rest.customCategory === "string" ? rest.customCategory.trim() : "",
          purpose: typeof rest.purpose === "string" && rest.purpose.trim() ? rest.purpose.trim() : category,
          billImageLink,
          createdBy: actorName,
          expenseDate,
          createdMonth: expenseDate.slice(0, 7),
          vendorId: validId(Number(rest.vendorId)) ? Number(rest.vendorId) : null,
          accountId: paymentMethod === "online" ? Number(rest.accountId) : null,
          paymentMethod,
          mainCategory: rest.mainCategory || "stay_expense",
          subCategory: rest.subCategory || category,
          taskId,
        });
        await addAuditEntry({ username: actorName, action: "task_expense_added", target: `task:${taskId}`, details: `expense:${expenseId}` });
        return NextResponse.json({ success: true, expenseId });
      } catch (error: unknown) {
        if (/unique|constraint/i.test(error instanceof Error ? error.message : String(error))) return taskError("This task already has a linked expense", 409);
        throw error;
      }
    }

    return taskError("Unknown task action", 400);
  } catch (error: unknown) {
    console.error("Task API error:", error);
    return taskError("Task operation failed", 500);
  }
}
