"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useAdminToast } from "./AdminToast";
import { cn } from "@/lib/utils";
import { CheckCircle2Icon, FileTextIcon, Loader2Icon, UploadIcon } from "lucide-react";

type Attachment = { name: string; mime: string; link: string };
type TaskExpense = { id: number; amount: number; category: string; purpose: string; expenseDate: string };
export type MyTask = { id: number; title: string; description: string; dueDate: string; status: string; priority: string; taskType: string; note: string; attachments: Attachment[]; expense: TaskExpense | null };

const labels: Record<string, string> = { todo: "To do", in_progress: "In progress", blocked: "Blocked", done: "Done" };
const todayIST = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

function statusClass(status: string) {
  return status === "done" ? "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300" : status === "blocked" ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300" : status === "in_progress" ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300" : "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300";
}

export function AdminMyTasks({ tasks, password, username, onUpdated }: { tasks: MyTask[]; password: string; username?: string; onUpdated: () => void }) {
  const { showError } = useAdminToast();
  const [saving, setSaving] = useState(false);
  const [noteTaskId, setNoteTaskId] = useState<number | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [uploading, setUploading] = useState(false);
  const today = todayIST();

  const update = async (task: MyTask, status: string, note = task.note) => {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password, username, action: "updateAssignedTask", taskId: task.id, status, note }) });
      if (!res.ok) { showError("Could not update task", (await res.json().catch(() => ({}))).error); return; }
      setNoteTaskId(null); onUpdated();
    } finally { setSaving(false); }
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
    return <div key={task.id} className={cn("rounded-xl border bg-white p-4 dark:bg-zinc-900", overdue ? "border-red-200 dark:border-red-900" : "border-brand-mist dark:border-zinc-800")}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className={cn("rounded px-2 py-1 text-[11px] font-semibold", statusClass(task.status))}>{labels[task.status] || task.status}</span>{task.taskType === "purchase" && <span className="rounded bg-violet-50 px-2 py-1 text-[11px] font-semibold text-violet-700 dark:bg-violet-950 dark:text-violet-300">Purchase</span>}</div><h4 className="mt-2 font-semibold text-brand-green-dark dark:text-zinc-100">{task.title}</h4><p className="mt-1 text-sm text-muted-foreground">{task.description || "No description"}</p></div>{task.dueDate && <span className={cn("shrink-0 text-xs", overdue ? "font-semibold text-red-600" : "text-muted-foreground")}>{overdue ? "Overdue · " : "Due · "}{task.dueDate}</span>}</div>
      <div className="mt-3 flex flex-wrap gap-2"><select value={task.status} disabled={saving || task.status === "done"} onChange={(e) => void update(task, e.target.value)} className="rounded-md border border-input bg-background px-2 py-1.5 text-xs"><option value="todo">To do</option><option value="in_progress">In progress</option><option value="blocked">Blocked</option><option value="done">Done</option></select><Button size="sm" variant="outline" onClick={() => { setNoteTaskId(task.id); setNotes((current) => ({ ...current, [task.id]: task.note })); }}>Note</Button><label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-input px-2 py-1.5 text-xs"><UploadIcon className="h-3.5 w-3.5" /> File<input type="file" className="hidden" accept="image/jpeg,image/png,image/webp,application/pdf" multiple onChange={(e) => void upload(task, e.target.files)} disabled={uploading || task.attachments.length >= 5} /></label></div>
      {task.taskType === "purchase" && task.status === "done" && !task.expense && <p className="mt-2 text-xs font-semibold text-amber-700 dark:text-amber-300">Expense is still pending.</p>}{task.expense && <p className="mt-2 text-xs text-green-700 dark:text-green-300">Expense recorded · ₹{(task.expense.amount / 100).toFixed(2)}</p>}
      {noteTaskId === task.id && <div className="mt-3 flex gap-2"><textarea value={notes[task.id] || ""} maxLength={5000} onChange={(e) => setNotes((current) => ({ ...current, [task.id]: e.target.value }))} className="min-h-16 flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm" placeholder="Add a note or completion detail" /><Button size="sm" onClick={() => void update(task, task.status, notes[task.id] || "")} disabled={saving}>{saving ? <Loader2Icon className="h-4 w-4 animate-spin" /> : "Save"}</Button></div>}
      {task.attachments.length > 0 && <div className="mt-3 flex flex-wrap gap-2 text-xs">{task.attachments.map((file) => <a key={file.link} href={file.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded bg-brand-sand/60 px-2 py-1 hover:underline"><FileTextIcon className="h-3 w-3" />{file.name}</a>)}</div>}
    </div>;
  };

  return <section className="mt-6"><div className="flex items-center justify-between"><div><h3 className="font-display text-lg font-bold text-brand-green-dark dark:text-zinc-100">My Tasks</h3><p className="mt-1 text-xs text-muted-foreground">{active.length} active · {completed.length} completed</p></div><CheckCircle2Icon className="h-5 w-5 text-brand-green" /></div><div className="mt-3 space-y-3">{active.map(renderTask)}</div>{completed.length > 0 && <details className="mt-3 rounded-xl border border-brand-mist bg-white p-3 dark:bg-card"><summary className="cursor-pointer text-sm font-semibold">Completed tasks ({completed.length})</summary><div className="mt-3 space-y-3">{completed.map(renderTask)}</div></details>}</section>;
}
