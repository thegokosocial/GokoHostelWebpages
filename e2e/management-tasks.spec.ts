import { expect, test, type Page, type Route } from "@playwright/test";

type User = { id: number; username: string; displayName: string; role: string };
type Note = { id: string; body: string; authorUsername: string; createdAt: string };
type ShoppingItem = { id: string; label: string; bought: boolean; boughtAt?: string; boughtBy?: string };
type TaskRow = {
  id: number;
  title: string;
  description: string;
  taskType: string;
  category: string;
  priority: string;
  dueDate: string;
  assigneeUserId: number | null;
  status: string;
  note: string;
  notes: Note[];
  shoppingItems: ShoppingItem[];
  attachments: unknown[];
  followerUsernames: string[];
  completedAt: string;
  completedBy: string;
  deletedAt: string | null;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  expense: { id: number; amount: number; category: string; purpose: string; expenseDate: string } | null;
};

type Call = { action: string; body: Record<string, unknown> };

const USERS: User[] = [
  { id: 1, username: "e2e-admin", displayName: "E2E Admin", role: "admin" },
  { id: 2, username: "staff", displayName: "Staff User", role: "staff" },
  { id: 3, username: "manager", displayName: "Manager User", role: "manager" },
];

function serializeTask(task: TaskRow) {
  const assignee = USERS.find((user) => user.id === task.assigneeUserId) || null;
  const followers = USERS.filter((user) => task.followerUsernames.includes(user.username));
  return {
    ...task,
    assignee: assignee ? { id: assignee.id, username: assignee.username, displayName: assignee.displayName, role: assignee.role } : null,
    followers,
  };
}

function newId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function mockTasksShell(page: Page) {
  const calls: Call[] = [];
  const tasks = new Map<number, TaskRow>();
  let nextId = 10;
  let nextExpenseId = 100;

  await page.route("**/api/**", async (route: Route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/auth/login") {
      await route.fulfill({ json: { role: "admin", username: "e2e-admin", permissions: {} } });
      return;
    }
    if (url.pathname === "/api/auth/session") {
      await route.fulfill({ status: 401, json: { authenticated: false } });
      return;
    }
    if (url.pathname === "/api/auth/logout") {
      await route.fulfill({ json: { success: true } });
      return;
    }
    if (url.pathname === "/api/admin/tasks/upload") {
      await route.fulfill({ json: { success: true } });
      return;
    }
    if (!url.pathname.startsWith("/api/admin/")) {
      await route.fulfill({ json: {} });
      return;
    }

    const body = JSON.parse(route.request().postData() || "{}") as Record<string, unknown>;
    const action = String(body.action || "");
    if (action === "auth") {
      await route.fulfill({ json: { role: "admin", permissions: {} } });
      return;
    }

    if (url.pathname === "/api/admin/expenses" && action === "getExpenseCategories") {
      await route.fulfill({ json: { categories: ["Supplies", "Maintenance"] } });
      return;
    }
    if (url.pathname === "/api/admin/account-settings" && action === "listAccounts") {
      await route.fulfill({ json: { accounts: [{ id: 1, name: "Cash", nickname: "Cash" }] } });
      return;
    }
    if (url.pathname === "/api/admin/account-settings" && action === "listVendors") {
      await route.fulfill({ json: { vendors: [{ id: 1, name: "Local Mart" }] } });
      return;
    }

    if (url.pathname !== "/api/admin/tasks") {
      await route.fulfill({ json: {} });
      return;
    }

    calls.push({ action, body });

    if (action === "listTasks") {
      const includeArchived = Boolean(body.includeArchived);
      const list = [...tasks.values()]
        .filter((task) => includeArchived || !task.deletedAt)
        .map(serializeTask);
      await route.fulfill({ json: { tasks: list } });
      return;
    }

    if (action === "getTaskAssignees") {
      await route.fulfill({ json: { users: USERS } });
      return;
    }

    if (action === "createTask") {
      const id = nextId++;
      const followerUsernames = Array.isArray(body.followerUsernames)
        ? (body.followerUsernames as string[])
        : [];
      const shoppingRaw = Array.isArray(body.shoppingItems) ? body.shoppingItems : [];
      const shoppingItems: ShoppingItem[] = shoppingRaw.map((raw, index) => {
        if (typeof raw === "string") return { id: `s-${id}-${index}`, label: raw, bought: false };
        const row = raw as { id?: string; label?: string };
        return { id: row.id || `s-${id}-${index}`, label: String(row.label || ""), bought: false };
      }).filter((item) => item.label.trim());
      const assigneeUserId = body.assigneeUserId == null || body.assigneeUserId === ""
        ? null
        : Number(body.assigneeUserId);
      const task: TaskRow = {
        id,
        title: String(body.title || ""),
        description: String(body.description || ""),
        taskType: String(body.taskType || "general"),
        category: String(body.category || ""),
        priority: String(body.priority || "normal"),
        dueDate: String(body.dueDate || ""),
        assigneeUserId: Number.isFinite(assigneeUserId as number) ? assigneeUserId : null,
        status: "todo",
        note: "",
        notes: [],
        shoppingItems,
        attachments: [],
        followerUsernames,
        completedAt: "",
        completedBy: "",
        deletedAt: null,
        createdBy: "e2e-admin",
        updatedBy: "e2e-admin",
        createdAt: "2026-09-26T00:00:00.000Z",
        updatedAt: "2026-09-26T00:00:00.000Z",
        expense: null,
      };
      tasks.set(id, task);
      await route.fulfill({ json: { success: true, id } });
      return;
    }

    if (action === "updateTask") {
      const taskId = Number(body.taskId);
      const current = tasks.get(taskId);
      if (!current) {
        await route.fulfill({ status: 404, json: { error: "Task not found" } });
        return;
      }
      const next: TaskRow = { ...current };
      if (body.title !== undefined) next.title = String(body.title);
      if (body.description !== undefined) next.description = String(body.description);
      if (body.taskType !== undefined) next.taskType = String(body.taskType);
      if (body.category !== undefined) next.category = String(body.category);
      if (body.priority !== undefined) next.priority = String(body.priority);
      if (body.dueDate !== undefined) next.dueDate = String(body.dueDate);
      if (body.status !== undefined) {
        next.status = String(body.status);
        if (next.status === "done") {
          next.completedAt = "2026-09-26T12:00:00.000Z";
          next.completedBy = "e2e-admin";
        } else {
          next.completedAt = "";
          next.completedBy = "";
        }
      }
      if (body.assigneeUserId !== undefined) {
        next.assigneeUserId = body.assigneeUserId == null || body.assigneeUserId === ""
          ? null
          : Number(body.assigneeUserId);
      }
      if (Array.isArray(body.followerUsernames)) next.followerUsernames = body.followerUsernames as string[];
      if (Array.isArray(body.shoppingItems)) {
        next.shoppingItems = (body.shoppingItems as Array<string | { id?: string; label?: string }>).map((raw, index) => {
          if (typeof raw === "string") {
            const prev = current.shoppingItems[index];
            return prev ? { ...prev, label: raw } : { id: `s-${taskId}-${index}`, label: raw, bought: false };
          }
          const prev = current.shoppingItems.find((item) => item.id === raw.id) || current.shoppingItems[index];
          return {
            id: raw.id || prev?.id || `s-${taskId}-${index}`,
            label: String(raw.label || ""),
            bought: prev?.bought || false,
            boughtAt: prev?.boughtAt,
            boughtBy: prev?.boughtBy,
          };
        }).filter((item) => item.label.trim());
      }
      next.updatedBy = "e2e-admin";
      tasks.set(taskId, next);
      await route.fulfill({ json: { success: true } });
      return;
    }

    if (action === "addTaskNote") {
      const taskId = Number(body.taskId);
      const current = tasks.get(taskId);
      if (!current) {
        await route.fulfill({ status: 404, json: { error: "Task not found" } });
        return;
      }
      const notes = [
        ...current.notes,
        {
          id: newId("n"),
          body: String(body.body || ""),
          authorUsername: "e2e-admin",
          createdAt: "2026-09-26T12:30:00.000Z",
        },
      ];
      tasks.set(taskId, { ...current, notes });
      await route.fulfill({ json: { success: true, notes } });
      return;
    }

    if (action === "toggleShoppingItem") {
      const taskId = Number(body.taskId);
      const current = tasks.get(taskId);
      if (!current) {
        await route.fulfill({ status: 404, json: { error: "Task not found" } });
        return;
      }
      const shoppingItems = current.shoppingItems.map((item) => {
        if (item.id !== body.itemId) return item;
        if (item.bought) return { id: item.id, label: item.label, bought: false };
        return { ...item, bought: true, boughtAt: "2026-09-26T13:00:00.000Z", boughtBy: "e2e-admin" };
      });
      const allBought = shoppingItems.length > 0 && shoppingItems.every((item) => item.bought);
      const anyOpen = shoppingItems.some((item) => !item.bought);
      let status = current.status;
      let completedAt = current.completedAt;
      let completedBy = current.completedBy;
      if (allBought && status !== "done") {
        status = "done";
        completedAt = "2026-09-26T13:00:00.000Z";
        completedBy = "e2e-admin";
      } else if (anyOpen && status === "done") {
        status = "in_progress";
        completedAt = "";
        completedBy = "";
      }
      tasks.set(taskId, { ...current, shoppingItems, status, completedAt, completedBy });
      await route.fulfill({ json: { success: true, shoppingItems, status } });
      return;
    }

    if (action === "updateAssignedTask") {
      const taskId = Number(body.taskId);
      const current = tasks.get(taskId);
      if (!current) {
        await route.fulfill({ status: 404, json: { error: "Task not found" } });
        return;
      }
      const status = String(body.status || current.status);
      tasks.set(taskId, {
        ...current,
        status,
        completedAt: status === "done" ? "2026-09-26T14:00:00.000Z" : "",
        completedBy: status === "done" ? "e2e-admin" : "",
      });
      await route.fulfill({ json: { success: true } });
      return;
    }

    if (action === "reopenTask") {
      const taskId = Number(body.taskId);
      const current = tasks.get(taskId);
      if (!current) {
        await route.fulfill({ status: 404, json: { error: "Task not found" } });
        return;
      }
      tasks.set(taskId, { ...current, status: "todo", completedAt: "", completedBy: "", deletedAt: null });
      await route.fulfill({ json: { success: true } });
      return;
    }

    if (action === "archiveTask") {
      const taskId = Number(body.taskId);
      const current = tasks.get(taskId);
      if (!current) {
        await route.fulfill({ status: 404, json: { error: "Task not found" } });
        return;
      }
      tasks.set(taskId, { ...current, deletedAt: "2026-09-26T15:00:00.000Z" });
      await route.fulfill({ json: { success: true } });
      return;
    }

    if (action === "deleteArchivedTask") {
      const taskId = Number(body.taskId);
      tasks.delete(taskId);
      await route.fulfill({ json: { success: true } });
      return;
    }

    if (action === "createTaskExpense") {
      const taskId = Number(body.taskId);
      const current = tasks.get(taskId);
      if (!current) {
        await route.fulfill({ status: 404, json: { error: "Task not found" } });
        return;
      }
      const expense = {
        id: nextExpenseId++,
        amount: Number(body.amount),
        category: String(body.category || "Supplies"),
        purpose: String(body.purpose || current.title),
        expenseDate: String(body.expenseDate || "2026-09-26"),
      };
      tasks.set(taskId, { ...current, expense });
      await route.fulfill({ json: { success: true, expenseId: expense.id } });
      return;
    }

    await route.fulfill({ json: { success: true } });
  });

  return {
    calls,
    last(action: string) {
      return [...calls].reverse().find((call) => call.action === action);
    },
    of(action: string) {
      return calls.filter((call) => call.action === action);
    },
  };
}

async function signInToTasks(page: Page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/admin?section=management&tab=tasks");
  await page.locator("#admin-user").fill("e2e-admin");
  await page.locator("#admin-pw").fill("e2e-only-password");
  await page.getByRole("button", { name: "Login" }).click();
  await expect(page.getByRole("heading", { name: "To Do" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: /New task/i })).toBeVisible();
}

async function openNewTask(page: Page) {
  await page.getByRole("button", { name: /New task/i }).click();
  await expect(page.getByRole("heading", { name: "New task" })).toBeVisible();
}

async function fillCoreFields(page: Page, opts: {
  title: string;
  description: string;
  type: "general" | "purchase" | "shopping";
  assignStaff?: boolean;
  followManager?: boolean;
}) {
  const dialog = page.locator(".fixed.inset-0").filter({ has: page.getByRole("heading", { name: /New task|Edit task/ }) });
  await dialog.getByLabel(/Title/i).fill(opts.title);
  await dialog.locator("label").filter({ hasText: "Description" }).locator("textarea").fill(opts.description);
  await dialog.locator("label").filter({ hasText: "Type" }).locator("select").selectOption(opts.type);
  if (opts.assignStaff) {
    await dialog.locator("label").filter({ hasText: "Assignee" }).locator("select").selectOption("2");
  }
  if (opts.followManager) {
    await dialog.locator("fieldset").filter({ hasText: "Followers" }).getByText("Manager User · manager").click();
  }
}

test.describe.configure({ mode: "serial", timeout: 90_000 });

test("general task: create → followers → note → edit → done (status notify path)", async ({ page }) => {
  const api = await mockTasksShell(page);
  await signInToTasks(page);
  await openNewTask(page);
  await fillCoreFields(page, {
    title: "Fix lobby light",
    description: "Replace bulb near reception",
    type: "general",
    assignStaff: true,
    followManager: true,
  });
  await page.getByRole("button", { name: /^Save$/ }).click();
  await expect(page.getByText("Task created")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fix lobby light" })).toBeVisible();

  const create = api.last("createTask");
  expect(create?.body).toMatchObject({
    title: "Fix lobby light",
    taskType: "general",
    assigneeUserId: "2",
  });
  expect(create?.body.followerUsernames).toEqual(expect.arrayContaining(["staff", "manager"]));

  const card = page.locator("div.rounded-xl", { has: page.getByRole("heading", { name: "Fix lobby light" }) });
  await expect(card.getByText(/\d+ followers?/)).toBeVisible();
  await card.getByPlaceholder("Add a note").fill("Checked wiring first");
  await card.getByRole("button", { name: /^Add$/ }).click();
  await expect(page.getByText("Note added")).toBeVisible();
  await expect(card.getByText("Checked wiring first")).toBeVisible();
  expect(api.last("addTaskNote")?.body.body).toBe("Checked wiring first");

  await card.getByRole("button", { name: "Edit task" }).click();
  await expect(page.getByRole("heading", { name: "Edit task" })).toBeVisible();
  const editDialog = page.locator(".fixed.inset-0").filter({ has: page.getByRole("heading", { name: "Edit task" }) });
  await editDialog.getByLabel(/Title/i).fill("Fix lobby light ASAP");
  await editDialog.locator("label").filter({ hasText: "Status" }).locator("select").selectOption("done");
  await editDialog.getByRole("button", { name: /^Save$/ }).click();
  await expect(page.getByText("Task updated")).toBeVisible();

  const update = api.last("updateTask");
  expect(update?.body).toMatchObject({
    title: "Fix lobby light ASAP",
    status: "done",
  });
  // Followers on the done transition are the notification recipients server-side.
  expect(update?.body.followerUsernames).toEqual(expect.arrayContaining(["staff", "manager"]));
  await expect(page.getByRole("heading", { name: "Fix lobby light ASAP" })).toBeVisible();
  await expect(page.locator("div.rounded-xl", { has: page.getByRole("heading", { name: "Fix lobby light ASAP" }) }).getByText("Done", { exact: true })).toBeVisible();
});

test("purchase task: create → edit → note → done → expense pending → record expense", async ({ page }) => {
  const api = await mockTasksShell(page);
  await signInToTasks(page);
  await openNewTask(page);
  await fillCoreFields(page, {
    title: "Buy mop heads",
    description: "Need 4 replacements",
    type: "purchase",
    assignStaff: true,
    followManager: true,
  });
  await page.locator("label", { hasText: /^Category$/ }).locator("input").fill("Supplies");
  await page.getByRole("button", { name: /^Save$/ }).click();
  await expect(page.getByText("Task created")).toBeVisible();
  expect(api.last("createTask")?.body).toMatchObject({ taskType: "purchase", title: "Buy mop heads" });

  const card = page.locator("div.rounded-xl", { has: page.getByRole("heading", { name: "Buy mop heads" }) });
  await expect(card.getByText("Purchase")).toBeVisible();
  await card.getByRole("button", { name: "Edit task" }).click();
  const editDialog = page.locator(".fixed.inset-0").filter({ has: page.getByRole("heading", { name: "Edit task" }) });
  await editDialog.getByLabel(/Title/i).fill("Buy mop heads (xl)");
  await editDialog.getByRole("button", { name: /^Save$/ }).click();
  await expect(page.getByText("Task updated")).toBeVisible();

  const edited = page.locator("div.rounded-xl", { has: page.getByRole("heading", { name: "Buy mop heads (xl)" }) });
  await edited.getByPlaceholder("Add a note").fill("Got quote from Local Mart");
  await edited.getByRole("button", { name: /^Add$/ }).click();
  await expect(edited.getByText("Got quote from Local Mart")).toBeVisible();

  await edited.getByRole("button", { name: "Edit task" }).click();
  const doneDialog = page.locator(".fixed.inset-0").filter({ has: page.getByRole("heading", { name: "Edit task" }) });
  await doneDialog.locator("label").filter({ hasText: "Status" }).locator("select").selectOption("done");
  await doneDialog.getByRole("button", { name: /^Save$/ }).click();
  await expect(page.getByText("Task updated")).toBeVisible();
  await expect(page.getByText("Expense pending")).toBeVisible();
  expect(api.last("updateTask")?.body.status).toBe("done");

  await page.locator("div.rounded-xl", { has: page.getByRole("heading", { name: "Buy mop heads (xl)" }) }).getByRole("button", { name: "Edit task" }).click();
  const expenseDialogHost = page.locator(".fixed.inset-0").filter({ has: page.getByRole("heading", { name: "Edit task" }) });
  await expenseDialogHost.getByRole("button", { name: /Record expense/i }).click();
  const expenseModal = page.locator(".fixed").filter({ has: page.getByRole("heading", { name: "Record purchase expense" }) });
  await expect(expenseModal.getByRole("heading", { name: "Record purchase expense" })).toBeVisible();
  await expenseModal.getByLabel(/Amount/i).fill("450");
  await expect(expenseModal.locator("label").filter({ hasText: "Category" }).locator("select option", { hasText: "Supplies" })).toHaveCount(1, { timeout: 10_000 });
  await expenseModal.locator("label").filter({ hasText: "Category" }).locator("select").selectOption("Supplies");
  await expenseModal.getByRole("button", { name: /^Record expense$/i }).click();
  await expect(page.getByText("Expense recorded")).toBeVisible();
  expect(api.last("createTaskExpense")?.body).toMatchObject({ amount: 45000, category: "Supplies" });
  await expect(page.getByText(/Expense recorded · ₹450/)).toBeVisible();
});

test("shopping task: create items → note → toggle all to done → unbuy reopens → archive → hard delete", async ({ page }) => {
  const api = await mockTasksShell(page);
  await signInToTasks(page);
  await openNewTask(page);
  await fillCoreFields(page, {
    title: "Sunday market run",
    description: "Weekly kitchen restock",
    type: "shopping",
    assignStaff: true,
    followManager: true,
  });
  await expect(page.getByPlaceholder("Item 1")).toBeVisible();
  await page.getByPlaceholder("Item 1").fill("Milk");
  await page.getByRole("button", { name: /Add item/i }).click();
  await page.getByPlaceholder("Item 2").fill("Eggs");
  await page.getByRole("button", { name: /^Save$/ }).click();
  await expect(page.getByText("Task created")).toBeVisible();

  const create = api.last("createTask");
  expect(create?.body.taskType).toBe("shopping");
  expect(create?.body.shoppingItems).toEqual(expect.arrayContaining(["Milk", "Eggs"]));

  const card = page.locator("div.rounded-xl", { has: page.getByRole("heading", { name: "Sunday market run" }) });
  await expect(card.getByText("Shopping list", { exact: true }).first()).toBeVisible();
  await expect(card.getByText("0/2 bought")).toBeVisible();
  await card.getByPlaceholder("Add a note").fill("Budget ₹800");
  await card.getByRole("button", { name: /^Add$/ }).click();
  await expect(card.getByText("Budget ₹800")).toBeVisible();

  await card.getByText("Milk", { exact: true }).click();
  await expect.poll(() => api.of("toggleShoppingItem").length).toBeGreaterThanOrEqual(1);
  await expect(card.getByText("1/2 bought")).toBeVisible();
  await expect(card.getByText("Done", { exact: true })).toHaveCount(0);

  await card.getByText("Eggs", { exact: true }).click();
  await expect.poll(() => api.of("toggleShoppingItem").length).toBeGreaterThanOrEqual(2);
  await expect(card.getByText("Done", { exact: true })).toBeVisible();
  await expect(card.getByText("2/2 bought")).toBeVisible();
  expect(api.last("toggleShoppingItem")?.body.itemId).toBeTruthy();

  // Unbuying reopens to in_progress (status_changed notify path server-side).
  await card.getByText("Milk", { exact: true }).click();
  await expect(card.getByText("In progress", { exact: true })).toBeVisible();
  await expect(card.getByText("1/2 bought")).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await card.getByRole("button", { name: "Edit task" }).click();
  await page.getByRole("button", { name: /Archive/i }).click();
  await expect(page.getByText("Task archived")).toBeVisible();
  expect(api.last("archiveTask")?.body.taskId).toBeTruthy();

  await page.getByLabel(/Include archived/i).check();
  const archived = page.locator("div.rounded-xl", { has: page.getByRole("heading", { name: "Sunday market run" }) });
  await expect(archived.getByText("Archived")).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await archived.getByRole("button", { name: /Delete permanently/i }).click();
  await expect(page.getByText("Task deleted")).toBeVisible();
  expect(api.last("deleteArchivedTask")?.body.taskId).toBeTruthy();
  await expect(page.getByRole("heading", { name: "Sunday market run" })).toHaveCount(0);
});

test("assignee card status select marks general task done without opening editor", async ({ page }) => {
  const api = await mockTasksShell(page);
  await signInToTasks(page);
  await openNewTask(page);
  await fillCoreFields(page, {
    title: "Self-assigned sweep",
    description: "Quick floor check",
    type: "general",
  });
  const createDialog = page.locator(".fixed.inset-0").filter({ has: page.getByRole("heading", { name: "New task" }) });
  await createDialog.locator("label").filter({ hasText: "Assignee" }).locator("select").selectOption("1");
  await createDialog.getByRole("button", { name: /^Save$/ }).click();
  await expect(page.getByText("Task created")).toBeVisible();

  const card = page.locator("div.rounded-xl", { has: page.getByRole("heading", { name: "Self-assigned sweep" }) });
  await card.locator("select").selectOption("done");
  await expect.poll(() => api.of("updateAssignedTask").length).toBe(1);
  expect(api.last("updateAssignedTask")?.body).toMatchObject({ status: "done" });
  await expect(card.locator("span").filter({ hasText: /^Done$/ })).toBeVisible();
});
