"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AdminLoading } from "./AdminLoading";
import { useAdminToast } from "./AdminToast";
import { hasPermission, type Role } from "./types";
import { cn } from "@/lib/utils";
import { ArchiveIcon, CheckCircle2Icon, ExternalLinkIcon, FileTextIcon, IndianRupeeIcon, Loader2Icon, PencilIcon, PlusIcon, RotateCcwIcon, UploadIcon, XIcon } from "lucide-react";

type Attachment = { name: string; mime: string; link: string; uploadedBy: string; uploadedAt: string };
type User = { id: number; username: string; displayName: string; role: string };
type TaskExpense = { id: number; amount: number; category: string; purpose: string; expenseDate: string };
type Task = {
  id: number; title: string; description: string; taskType: string; category: string; priority: string;
  dueDate: string; assigneeUserId: number | null; status: string; note: string; attachments: Attachment[];
  completedAt: string; completedBy: string; deletedAt?: string | null; assignee: User | null; followers: User[]; expense: TaskExpense | null;
};

const STATUS_LABELS: Record<string, string> = { todo: "To do", in_progress: "In progress", blocked: "Blocked", done: "Done" };
const PRIORITY_LABELS: Record<string, string> = { low: "Low", normal: "Normal", high: "High", urgent: "Urgent" };
const todayIST = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

function statusClass(status: string) {
  if (status === "done") return "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300";
  if (status === "blocked") return "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300";
  if (status === "in_progress") return "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300";
  return "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300";
}

export function ManagementTasks({ password, username, role, permissions = {} }: { password: string; username?: string; role: Role; permissions?: Record<string, boolean> }) {
  const { showError, showSuccess } = useAdminToast();
  const canManage = hasPermission(role, permissions, "canManageTasks");
  const canAddExpense = hasPermission(role, permissions, "canAddExpense");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Task | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showExpense, setShowExpense] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [form, setForm] = useState({ title: "", description: "", taskType: "general", category: "", priority: "normal", dueDate: "", assigneeUserId: "", followerUsernames: [] as string[] });
  const [note, setNote] = useState("");
  const [uploading, setUploading] = useState(false);
  const [expense, setExpense] = useState({ amount: "", category: "", purpose: "", expenseDate: todayIST(), paymentMethod: "cash", accountId: "", vendorId: "" });
  const [expenseCategories, setExpenseCategories] = useState<string[]>([]);
  const [accounts, setAccounts] = useState<{ id: number; name: string; nickname: string }[]>([]);
  const [vendors, setVendors] = useState<{ id: number; name: string }[]>([]);

  const apiCall = useCallback(async (body: Record<string, unknown>) => {
    const payload: Record<string, unknown> = { password, username, ...body };
    return fetch("/api/admin/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  }, [password, username]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [taskRes, userRes] = await Promise.all([
        apiCall({ action: "listTasks", includeArchived }),
        canManage ? apiCall({ action: "getTaskAssignees" }) : Promise.resolve(null),
      ]);
      if (taskRes.ok) setTasks((await taskRes.json()).tasks || []);
      else showError("Could not load tasks", (await taskRes.json().catch(() => ({}))).error);
      if (userRes?.ok) setUsers((await userRes.json()).users || []);
    } finally { setLoading(false); }
  }, [apiCall, canManage, includeArchived, showError]);

  useEffect(() => { void load(); }, [load]);

  const visibleTasks = useMemo(() => tasks.filter((task) => {
    if (!includeArchived && task.deletedAt) return false;
    if (statusFilter !== "all" && task.status !== statusFilter) return false;
    if (assigneeFilter === "unassigned" && task.assigneeUserId !== null) return false;
    if (assigneeFilter !== "all" && assigneeFilter !== "unassigned" && String(task.assigneeUserId) !== assigneeFilter) return false;
    return true;
  }), [assigneeFilter, includeArchived, statusFilter, tasks]);

  const openCreate = () => {
    setSelected(null); setForm({ title: "", description: "", taskType: "general", category: "", priority: "normal", dueDate: "", assigneeUserId: "", followerUsernames: username && users.some((user) => user.username === username) ? [username] : [] }); setShowForm(true);
  };
  const openEdit = (task: Task) => {
    setSelected(task); setForm({ title: task.title, description: task.description, taskType: task.taskType, category: task.category, priority: task.priority, dueDate: task.dueDate || "", assigneeUserId: task.assigneeUserId === null ? "" : String(task.assigneeUserId), followerUsernames: task.followers.map((follower) => follower.username) }); setShowForm(true);
  };

  const setAssignee = (assigneeUserId: string) => {
    const assignee = users.find((user) => String(user.id) === assigneeUserId);
    setForm((current) => ({
      ...current,
      assigneeUserId,
      followerUsernames: assignee && !current.followerUsernames.includes(assignee.username)
        ? [...current.followerUsernames, assignee.username]
        : current.followerUsernames,
    }));
  };

  const saveTask = async () => {
    if (!form.title.trim()) { showError("Title is required"); return; }
    setSaving(true);
    try {
      const res = await apiCall({ action: selected ? "updateTask" : "createTask", ...(selected ? { taskId: selected.id } : {}), ...form, assigneeUserId: form.assigneeUserId || null });
      if (!res.ok) { showError("Could not save task", (await res.json().catch(() => ({}))).error); return; }
      setShowForm(false); showSuccess(selected ? "Task updated" : "Task created"); await load();
    } finally { setSaving(false); }
  };

  const updateOwnTask = async (task: Task, status: string, nextNote = task.note) => {
    setSaving(true);
    try {
      const res = await apiCall({ action: "updateAssignedTask", taskId: task.id, status, note: nextNote });
      if (!res.ok) { showError("Could not update task", (await res.json().catch(() => ({}))).error); return; }
      await load();
      setSelected((current) => current?.id === task.id ? { ...current, status, note: nextNote, completedAt: status === "done" ? new Date().toISOString() : "", completedBy: status === "done" ? username || "" : "" } : current);
    } finally { setSaving(false); }
  };

  const archive = async (task: Task) => {
    if (!confirm(`Archive “${task.title}”?`)) return;
    const res = await apiCall({ action: "archiveTask", taskId: task.id });
    if (!res.ok) showError("Could not archive task", (await res.json().catch(() => ({}))).error);
    else { setSelected(null); showSuccess("Task archived"); await load(); }
  };

  const reopen = async (task: Task) => {
    const res = await apiCall({ action: "reopenTask", taskId: task.id });
    if (!res.ok) showError("Could not reopen task", (await res.json().catch(() => ({}))).error);
    else { showSuccess("Task reopened"); await load(); }
  };

  const upload = async (task: Task, files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData(); fd.append("password", password); fd.append("username", username || ""); fd.append("taskId", String(task.id)); fd.append("file", file);
        const res = await fetch("/api/admin/tasks/upload", { method: "POST", body: fd });
        if (!res.ok) { showError("Could not upload file", (await res.json().catch(() => ({}))).error); break; }
      }
      await load();
      const refreshRes = await apiCall({ action: "listTasks", includeArchived });
      const refreshed = refreshRes.ok ? (await refreshRes.json()).tasks?.find((item: Task) => item.id === task.id) : null;
      if (refreshed) setSelected(refreshed);
    } finally { setUploading(false); }
  };

  const loadExpenseData = async () => {
    const [categoryRes, accountRes, vendorRes] = await Promise.all([
      fetch("/api/admin/expenses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password, username, action: "getExpenseCategories" }) }),
      fetch("/api/admin/account-settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password, username, action: "listAccounts" }) }),
      fetch("/api/admin/account-settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password, username, action: "listVendors" }) }),
    ]);
    if (categoryRes.ok) setExpenseCategories((await categoryRes.json()).categories || []);
    if (accountRes.ok) setAccounts((await accountRes.json()).accounts || []);
    if (vendorRes.ok) setVendors((await vendorRes.json()).vendors || []);
  };

  const createExpense = async () => {
    if (!selected) return;
    const amount = Math.round(parseFloat(expense.amount) * 100);
    if (!amount || !expense.category) { showError("Amount and category are required"); return; }
    setSaving(true);
    try {
      const res = await apiCall({ action: "createTaskExpense", taskId: selected.id, ...expense, amount, accountId: expense.accountId ? Number(expense.accountId) : undefined, vendorId: expense.vendorId ? Number(expense.vendorId) : undefined });
      if (!res.ok) { showError("Could not create expense", (await res.json().catch(() => ({}))).error); return; }
      setShowExpense(false); showSuccess("Expense recorded"); await load();
    } finally { setSaving(false); }
  };

  if (loading) return <AdminLoading message="Loading tasks..." />;
  const today = todayIST();

  return <div className="space-y-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div><h3 className="text-lg font-semibold text-brand-green-dark dark:text-zinc-100">To Do</h3><p className="text-xs text-muted-foreground">Shared work queue · {visibleTasks.length} task{visibleTasks.length === 1 ? "" : "s"}</p></div>
      {canManage && <Button type="button" variant="cta" onClick={openCreate}><PlusIcon className="mr-1 h-4 w-4" /> New task</Button>}
    </div>
    <div className="grid gap-2 rounded-xl border border-brand-mist bg-white p-3 dark:bg-card sm:grid-cols-3">
      <label className="text-xs">Status<select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2"><option value="all">All active statuses</option>{Object.entries(STATUS_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label className="text-xs">Assignee<select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2"><option value="all">Everyone</option><option value="unassigned">Unassigned</option>{users.map((user) => <option key={user.id} value={user.id}>{user.displayName}</option>)}</select></label>
      <label className="flex items-end gap-2 text-xs"><input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} disabled={!canManage} /> Include archived</label>
    </div>
    <div className="space-y-3">
      {visibleTasks.map((task) => {
        const overdue = !!task.dueDate && task.dueDate < today && task.status !== "done" && !task.deletedAt;
        const isMine = !!username && task.assignee?.username === username;
        return <div key={task.id} className={cn("rounded-xl border bg-white p-4 dark:bg-card", overdue ? "border-red-200 dark:border-red-900" : "border-brand-mist", task.deletedAt && "opacity-60")}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <button type="button" className="min-w-0 text-left" onClick={() => { setSelected(task); setNote(task.note); }}><div className="flex flex-wrap items-center gap-2"><span className={cn("rounded px-2 py-1 text-[11px] font-semibold", statusClass(task.status))}>{STATUS_LABELS[task.status] || task.status}</span><span className="text-[11px] font-medium text-muted-foreground">{PRIORITY_LABELS[task.priority] || task.priority}</span>{task.taskType === "purchase" && <span className="rounded bg-violet-50 px-2 py-1 text-[11px] font-semibold text-violet-700 dark:bg-violet-950 dark:text-violet-300">Purchase</span>}{task.deletedAt && <span className="text-[11px] text-muted-foreground">Archived</span>}</div><h4 className="mt-2 truncate font-semibold text-brand-green-dark dark:text-zinc-100">{task.title}</h4><p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{task.description || "No description"}</p></button>
            <div className="flex shrink-0 items-center gap-2"><span className={cn("text-xs", overdue ? "font-semibold text-red-600" : "text-muted-foreground")}>{task.dueDate ? `${overdue ? "Overdue · " : "Due · "}${task.dueDate}` : "No due date"}</span>{canManage && !task.deletedAt && <button type="button" aria-label="Edit task" onClick={() => openEdit(task)} className="rounded-md p-1.5 text-muted-foreground hover:bg-brand-sand"><PencilIcon className="h-4 w-4" /></button>}</div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>Assigned to <strong className="text-brand-green-dark dark:text-zinc-200">{task.assignee?.displayName || "Unassigned"}</strong></span>{task.followers.length > 0 && <span>· {task.followers.length} follower{task.followers.length === 1 ? "" : "s"}</span>}{task.category && <span>· {task.category}</span>}{task.attachments.length > 0 && <span>· {task.attachments.length} file{task.attachments.length === 1 ? "" : "s"}</span>}{task.taskType === "purchase" && task.status === "done" && !task.expense && <span className="rounded bg-amber-50 px-2 py-1 font-semibold text-amber-700 dark:bg-amber-950 dark:text-amber-300">Expense pending</span>}{task.expense && <span className="rounded bg-green-50 px-2 py-1 font-semibold text-green-700 dark:bg-green-950 dark:text-green-300">Expense recorded · ₹{(task.expense.amount / 100).toFixed(2)}</span>}</div>
          {isMine && !task.deletedAt && <div className="mt-3 flex flex-wrap gap-2 border-t border-brand-mist pt-3"><select value={task.status} disabled={saving} onChange={(e) => void updateOwnTask(task, e.target.value)} className="rounded-md border border-input bg-background px-2 py-1.5 text-xs"><option value="todo">To do</option><option value="in_progress">In progress</option><option value="blocked">Blocked</option><option value="done">Done</option></select><button type="button" onClick={() => { setSelected(task); setNote(task.note); }} className="rounded-md border border-input px-2 py-1.5 text-xs hover:bg-brand-sand">Update note</button><label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-input px-2 py-1.5 text-xs hover:bg-brand-sand"><UploadIcon className="h-3.5 w-3.5" /> Bill/file<input type="file" className="hidden" accept="image/jpeg,image/png,image/webp,application/pdf" multiple onChange={(e) => void upload(task, e.target.files)} disabled={uploading || task.attachments.length >= 5} /></label></div>}
        </div>;
      })}
      {visibleTasks.length === 0 && <p className="rounded-xl border border-dashed border-brand-mist py-12 text-center text-sm text-muted-foreground">No tasks match these filters.</p>}
    </div>

    {showForm && <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain bg-black/40 p-4 sm:items-center"><div className="max-h-[min(90dvh,100%)] w-full max-w-lg overflow-y-auto overscroll-contain rounded-2xl bg-white p-5 shadow-xl dark:bg-card"><div className="flex items-center justify-between"><h4 className="font-display text-lg font-bold">{selected ? "Edit task" : "New task"}</h4><button type="button" onClick={() => setShowForm(false)}><XIcon className="h-5 w-5" /></button></div><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-xs sm:col-span-2">Title *<Input value={form.title} maxLength={200} onChange={(e) => setForm({ ...form, title: e.target.value })} className="mt-1" /></label><label className="text-xs sm:col-span-2">Description<textarea value={form.description} maxLength={5000} onChange={(e) => setForm({ ...form, description: e.target.value })} className="mt-1 min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /></label><label className="text-xs">Assignee (optional)<select value={form.assigneeUserId} onChange={(e) => setAssignee(e.target.value)} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2"><option value="">Unassigned</option>{users.map((user) => <option key={user.id} value={user.id}>{user.displayName} · {user.role}</option>)}</select></label><label className="text-xs">Type<select value={form.taskType} onChange={(e) => setForm({ ...form, taskType: e.target.value })} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2"><option value="general">General</option><option value="purchase">Purchase</option></select></label><label className="text-xs">Category<Input value={form.category} maxLength={100} onChange={(e) => setForm({ ...form, category: e.target.value })} className="mt-1" placeholder="Bug, maintenance, housekeeping..." /></label><label className="text-xs">Priority<select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2">{Object.entries(PRIORITY_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><label className="text-xs">Due date<Input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className="mt-1" /></label><fieldset className="sm:col-span-2"><legend className="text-xs">Followers</legend><p className="mb-2 text-[11px] text-muted-foreground">Followers receive a notification when this task is completed.</p><div className="grid max-h-36 gap-2 overflow-y-auto rounded-md border border-input p-3 sm:grid-cols-2">{users.map((user) => { const newlyAssigned = Boolean(selected && String(selected.assigneeUserId ?? "") !== form.assigneeUserId && String(user.id) === form.assigneeUserId); return <label key={user.id} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.followerUsernames.includes(user.username)} disabled={newlyAssigned} onChange={(e) => setForm((current) => ({ ...current, followerUsernames: e.target.checked ? [...new Set([...current.followerUsernames, user.username])] : current.followerUsernames.filter((name) => name !== user.username) }))} />{user.displayName} · {user.role}</label>; })}</div></fieldset></div><div className="mt-5 flex gap-2"><Button type="button" onClick={() => void saveTask()} disabled={saving}>{saving ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <CheckCircle2Icon className="h-4 w-4" />} Save</Button><Button type="button" variant="ghost" onClick={() => setShowForm(false)} disabled={saving}>Cancel</Button></div></div></div>}

    {selected && !showForm && <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain bg-black/40 p-4 sm:items-center" onClick={() => setSelected(null)}><div className="max-h-[min(90dvh,100%)] w-full max-w-lg overflow-y-auto overscroll-contain rounded-2xl bg-white p-5 shadow-xl dark:bg-card" onClick={(e) => e.stopPropagation()}><div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><span className={cn("rounded px-2 py-1 text-[11px] font-semibold", statusClass(selected.status))}>{STATUS_LABELS[selected.status] || selected.status}</span>{selected.taskType === "purchase" && <span className="rounded bg-violet-50 px-2 py-1 text-[11px] font-semibold text-violet-700">Purchase</span>}</div><h4 className="mt-2 font-display text-lg font-bold">{selected.title}</h4></div><button type="button" onClick={() => setSelected(null)}><XIcon className="h-5 w-5" /></button></div><p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">{selected.description || "No description"}</p><div className="mt-4 grid gap-2 rounded-lg bg-brand-sand/50 p-3 text-xs"><span>Assigned to <strong>{selected.assignee?.displayName || "Unassigned"}</strong></span><span>Followers: <strong>{selected.followers.map((follower) => follower.displayName).join(", ") || "None"}</strong></span><span>Status: <strong>{STATUS_LABELS[selected.status] || selected.status}</strong> · Priority: <strong>{PRIORITY_LABELS[selected.priority] || selected.priority}</strong></span>{selected.dueDate && <span>Due: <strong>{selected.dueDate}</strong></span>}{selected.expense && <span>Expense: <strong>₹{(selected.expense.amount / 100).toFixed(2)} · {selected.expense.category} · {selected.expense.expenseDate}</strong></span>}{selected.taskType === "purchase" && selected.status === "done" && !selected.expense && <span className="font-semibold text-amber-700">Expense is still pending</span>}</div><label className="mt-4 block text-xs">Shared note<textarea value={note} maxLength={5000} onChange={(e) => setNote(e.target.value)} className="mt-1 min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /></label><div className="mt-3 flex flex-wrap gap-2">{username && selected.assignee?.username === username && !selected.deletedAt && <Button size="sm" onClick={() => void updateOwnTask(selected, selected.status, note)} disabled={saving}>Save note</Button>}{username && selected.assignee?.username === username && !selected.deletedAt && <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-input px-3 py-1.5 text-xs"><UploadIcon className="h-3.5 w-3.5" /> Upload<input type="file" className="hidden" accept="image/jpeg,image/png,image/webp,application/pdf" multiple onChange={(e) => void upload(selected, e.target.files)} disabled={uploading || selected.attachments.length >= 5} /></label>}{canManage && !selected.deletedAt && <><Button size="sm" variant="outline" onClick={() => openEdit(selected)}><PencilIcon className="mr-1 h-3.5 w-3.5" /> Edit</Button><Button size="sm" variant="outline" onClick={() => void archive(selected)}><ArchiveIcon className="mr-1 h-3.5 w-3.5" /> Archive</Button></>}{canManage && selected.status === "done" && !selected.deletedAt && <Button size="sm" variant="outline" onClick={() => void reopen(selected)}><RotateCcwIcon className="mr-1 h-3.5 w-3.5" /> Reopen</Button>}{selected.taskType === "purchase" && canAddExpense && !selected.deletedAt && !selected.expense && <Button size="sm" variant="outline" onClick={() => { setExpense({ amount: "", category: expenseCategories[0] || "", purpose: selected.title, expenseDate: todayIST(), paymentMethod: "cash", accountId: "", vendorId: "" }); setShowExpense(true); void loadExpenseData(); }}><IndianRupeeIcon className="mr-1 h-3.5 w-3.5" /> Record expense</Button>}</div><div className="mt-5"><h5 className="text-sm font-semibold">Files</h5>{selected.attachments.length ? <div className="mt-2 space-y-2">{selected.attachments.map((file) => <a key={file.link} href={file.link} target="_blank" rel="noreferrer" className="flex items-center justify-between rounded-lg border border-brand-mist px-3 py-2 text-xs hover:bg-brand-sand/50"><span className="flex min-w-0 items-center gap-2"><FileTextIcon className="h-4 w-4 shrink-0" /><span className="truncate">{file.name}</span></span><ExternalLinkIcon className="h-3.5 w-3.5 shrink-0" /></a>)}</div> : <p className="mt-2 text-xs text-muted-foreground">No files attached.</p>}</div></div></div>}

    {showExpense && selected && <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto overscroll-contain bg-black/40 p-4 sm:items-center"><div className="max-h-[min(90dvh,100%)] w-full max-w-md overflow-y-auto overscroll-contain rounded-2xl bg-white p-5 shadow-xl dark:bg-card"><div className="flex items-center justify-between"><h4 className="font-display text-lg font-bold">Record purchase expense</h4><button type="button" onClick={() => setShowExpense(false)}><XIcon className="h-5 w-5" /></button></div><p className="mt-1 text-xs text-muted-foreground">Linked to: {selected.title}</p><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-xs">Amount (₹) *<Input type="number" min="0" step="0.01" value={expense.amount} onChange={(e) => setExpense({ ...expense, amount: e.target.value })} className="mt-1" /></label><label className="text-xs">Expense date<Input type="date" max={todayIST()} value={expense.expenseDate} onChange={(e) => setExpense({ ...expense, expenseDate: e.target.value })} className="mt-1" /></label><label className="text-xs sm:col-span-2">Category *<select value={expense.category} onChange={(e) => setExpense({ ...expense, category: e.target.value })} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2">{expenseCategories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label><label className="text-xs sm:col-span-2">Purpose<Input value={expense.purpose} onChange={(e) => setExpense({ ...expense, purpose: e.target.value })} className="mt-1" /></label><label className="text-xs">Payment method<select value={expense.paymentMethod} onChange={(e) => setExpense({ ...expense, paymentMethod: e.target.value, accountId: e.target.value === "cash" ? "" : expense.accountId })} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2"><option value="cash">Cash</option><option value="online">Online</option></select></label>{expense.paymentMethod === "online" && <label className="text-xs">Online account<select value={expense.accountId} onChange={(e) => setExpense({ ...expense, accountId: e.target.value })} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2"><option value="">Select account</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name || account.nickname}</option>)}</select></label>}<label className="text-xs sm:col-span-2">Vendor (optional)<select value={expense.vendorId} onChange={(e) => setExpense({ ...expense, vendorId: e.target.value })} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2"><option value="">None</option>{vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}</select></label></div><div className="mt-5 flex gap-2"><Button type="button" onClick={() => void createExpense()} disabled={saving}>{saving ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <CheckCircle2Icon className="h-4 w-4" />} Record expense</Button><Button type="button" variant="ghost" onClick={() => setShowExpense(false)} disabled={saving}>Cancel</Button></div></div></div>}
  </div>;
}
