"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useAdminToast } from "./AdminToast";
import { cn } from "@/lib/utils";
import { shoppingProgress, sortShoppingItemsForDisplay, type ShoppingItemEntry, type TaskNoteEntry } from "@/lib/taskNotesShopping";
import { CheckCircle2Icon, FileTextIcon, Loader2Icon, UploadIcon } from "lucide-react";

type Attachment = { name: string; mime: string; link: string };
type TaskExpense = { id: number; amount: number; category: string; purpose: string; expenseDate: string };
export type MyTask = {
  id: number; title: string; description: string; dueDate: string; status: string; priority: string; taskType: string;
  note: string; notes?: TaskNoteEntry[]; shoppingItems?: ShoppingItemEntry[];
  attachments: Attachment[]; expense: TaskExpense | null;
};

const labels: Record<string, string> = { todo: "To do", in_progress: "In progress", blocked: "Blocked", done: "Done" };
const todayIST = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

function statusClass(status: string) {
  return status === "done" ? "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300" : status === "blocked" ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300" : status === "in_progress" ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300" : "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300";
}

function formatNoteTime(value: string) {
  if (!value) return "";
  try { return new Date(value).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); }
  catch { return value; }
}

export function AdminMyTasks({ tasks, password, username, onUpdated }: { tasks: MyTask[]; password: string; username?: string; onUpdated: () => void }) {
  const { showError, showSuccess } = useAdminToast();
  const [saving, setSaving] = useState(false);
  const [noteDraft, setNoteDraft] = useState<Record<number, string>>({});
  const [uploading, setUploading] = useState(false);
  const today = todayIST();

  const update = async (task: MyTask, status: string) => {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password, username, action: "updateAssignedTask", taskId: task.id, status }) });
      if (!res.ok) { showError("Could not update task", (await res.json().catch(() => ({}))).error); return; }
      onUpdated();
    } finally { setSaving(false); }
  };

  const addNote = async (task: MyTask) => {
    const body = (noteDraft[task.id] || "").trim();
    if (!body) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password, username, action: "addTaskNote", taskId: task.id, body }) });
      if (!res.ok) { showError("Could not add note", (await res.json().catch(() => ({}))).error); return; }
      setNoteDraft((current) => ({ ...current, [task.id]: "" }));
      showSuccess("Note added");
      onUpdated();
    } finally { setSaving(false); }
  };

  const toggleItem = async (task: MyTask, itemId: string) => {
    const res = await fetch("/api/admin/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password, username, action: "toggleShoppingItem", taskId: task.id, itemId }) });
    if (!res.ok) { showError("Could not update item", (await res.json().catch(() => ({}))).error); return; }
    onUpdated();
  };

  const upload = async (task: MyTask, files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData(); fd.append("password", password); fd.append("username", username || ""); fd.append("taskId", String(task.id)); fd.append("file", file);
        const res = await fetch("/api/admin/tasks/upload", { method: "POST", body: fd });
        if (!res.ok) { showError("Could not upload file", (await res.json().catch(() => ({}))).error); break; }
      }
      onUpdated();
    } finally { setUploading(false); }
  };

  if (tasks.length === 0) return null;
  const active = tasks.filter((task) => task.status !== "done");
  const completed = tasks.filter((task) => task.status === "done");
  const renderTask = (task: MyTask) => {
    const overdue = !!task.dueDate && task.dueDate < today && task.status !== "done";
    const notes = task.notes || [];
    const shoppingItems = task.shoppingItems || [];
    const progress = shoppingProgress(shoppingItems);
    return <div key={task.id} className={cn("rounded-xl border bg-white p-4 dark:bg-zinc-900", overdue ? "border-red-200 dark:border-red-900" : "border-brand-mist dark:border-zinc-800")}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className={cn("rounded px-2 py-1 text-[11px] font-semibold", statusClass(task.status))}>{labels[task.status] || task.status}</span>{task.taskType === "purchase" && <span className="rounded bg-violet-50 px-2 py-1 text-[11px] font-semibold text-violet-700 dark:bg-violet-950 dark:text-violet-300">Purchase</span>}{task.taskType === "shopping" && <span className="rounded bg-teal-50 px-2 py-1 text-[11px] font-semibold text-teal-700 dark:bg-teal-950 dark:text-teal-300">Shopping list</span>}</div><h4 className="mt-2 font-semibold text-brand-green-dark dark:text-zinc-100">{task.title}</h4><p className="mt-1 text-sm text-muted-foreground">{task.description || "No description"}</p></div>{task.dueDate && <span className={cn("shrink-0 text-xs", overdue ? "font-semibold text-red-600" : "text-muted-foreground")}>{overdue ? "Overdue · " : "Due · "}{task.dueDate}</span>}</div>
      {shoppingItems.length > 0 && <div className="mt-3 rounded-lg border border-brand-mist/80 p-2"><div className="mb-1 text-[11px] font-semibold text-brand-green-dark/70">{progress.bought}/{progress.total} bought</div><ul className="max-h-40 space-y-1 overflow-y-auto">{sortShoppingItemsForDisplay(shoppingItems).map((item) => <li key={item.id}><label className={cn("flex items-start gap-2 text-xs", item.bought && "text-muted-foreground")}><input type="checkbox" className="mt-0.5" checked={item.bought} onChange={() => void toggleItem(task, item.id)} /><span className={cn(item.bought && "line-through")}>{item.label}</span></label></li>)}</ul></div>}
      {notes.length > 0 && <div className="mt-3 max-h-36 space-y-1.5 overflow-y-auto rounded-lg bg-brand-sand/40 p-2">{notes.map((entry) => <div key={entry.id} className="rounded bg-white/80 px-2 py-1 text-xs dark:bg-card/80"><div className="text-[10px] text-muted-foreground">{entry.authorUsername} · {formatNoteTime(entry.createdAt)}</div><p className="whitespace-pre-wrap break-words">{entry.body}</p></div>)}</div>}
      <div className="mt-3 flex flex-wrap gap-2"><select value={task.status} disabled={saving || task.status === "done"} onChange={(e) => void update(task, e.target.value)} className="rounded-md border border-input bg-background px-2 py-1.5 text-xs"><option value="todo">To do</option><option value="in_progress">In progress</option><option value="blocked">Blocked</option><option value="done">Done</option></select><label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-input px-2 py-1.5 text-xs"><UploadIcon className="h-3.5 w-3.5" /> File<input type="file" className="hidden" accept="image/jpeg,image/png,image/webp,application/pdf" multiple onChange={(e) => void upload(task, e.target.files)} disabled={uploading || task.attachments.length >= 5} /></label></div>
      <div className="mt-2 flex gap-2"><textarea value={noteDraft[task.id] || ""} maxLength={5000} onChange={(e) => setNoteDraft((current) => ({ ...current, [task.id]: e.target.value }))} className="min-h-14 flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm" placeholder="Add a note" /><Button size="sm" onClick={() => void addNote(task)} disabled={saving || !(noteDraft[task.id] || "").trim()}>{saving ? <Loader2Icon className="h-4 w-4 animate-spin" /> : "Add"}</Button></div>
      {task.taskType === "purchase" && task.status === "done" && !task.expense && <p className="mt-2 text-xs font-semibold text-amber-700 dark:text-amber-300">Expense is still pending.</p>}{task.expense && <p className="mt-2 text-xs text-green-700 dark:text-green-300">Expense recorded · ₹{(task.expense.amount / 100).toFixed(2)}</p>}
      {task.attachments.length > 0 && <div className="mt-3 flex flex-wrap gap-2 text-xs">{task.attachments.map((file) => <a key={file.link} href={file.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded bg-brand-sand/60 px-2 py-1 hover:underline"><FileTextIcon className="h-3 w-3" />{file.name}</a>)}</div>}
    </div>;
  };

  return <section className="mt-6"><div className="flex items-center justify-between"><div><h3 className="font-display text-lg font-bold text-brand-green-dark dark:text-zinc-100">My Tasks</h3><p className="mt-1 text-xs text-muted-foreground">{active.length} active · {completed.length} completed</p></div><CheckCircle2Icon className="h-5 w-5 text-brand-green" /></div><div className="mt-3 space-y-3">{active.map(renderTask)}</div>{completed.length > 0 && <details className="mt-3 rounded-xl border border-brand-mist bg-white p-3 dark:bg-card"><summary className="cursor-pointer text-sm font-semibold">Completed tasks ({completed.length})</summary><div className="mt-3 space-y-3">{completed.map(renderTask)}</div></details>}</section>;
}
