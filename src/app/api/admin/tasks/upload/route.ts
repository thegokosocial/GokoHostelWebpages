import { NextRequest, NextResponse } from "next/server";
import { driveGetOrCreateFolder, driveUploadFile } from "@/lib/googleApiFetch";
import { authenticateUser } from "@/lib/auth";
import { actionAllowed } from "@/lib/actionPermissions";
import { addAuditEntry, getMonthKey, getTaskById, getUserByUsername, updateTask } from "@/db/queries";
import { isOfflineMode } from "@/lib/runtime";

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const MAX_FILE_BYTES = 10 * 1024 * 1024;

function jsonAttachments(value: string | null | undefined): { name: string; mime: string; link: string; uploadedBy: string; uploadedAt: string }[] {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.link === "string") : [];
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const password = String(form.get("password") || "");
    const username = String(form.get("username") || "");
    const taskId = Number(form.get("taskId"));
    const file = form.get("file");
    const auth = await authenticateUser(password, username);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const canView = auth.role === "admin" || actionAllowed(auth.role, auth.permissions, "canViewTasks") === "allowed";
    const canManage = auth.role === "admin" || actionAllowed(auth.role, auth.permissions, "canManageTasks") === "allowed";
    if (!canView && !canManage) {
      return NextResponse.json({ error: "You don't have permission to upload task files" }, { status: 403 });
    }
    if (!Number.isInteger(taskId) || taskId <= 0 || !(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "A valid task and file are required" }, { status: 400 });
    }
    if (!ALLOWED_MIME.has(file.type)) return NextResponse.json({ error: "Only JPEG, PNG, WebP, and PDF files are supported" }, { status: 400 });
    if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: "Files must be 10 MB or smaller" }, { status: 400 });
    if (isOfflineMode()) return NextResponse.json({ error: "Bill uploads require internet connection" }, { status: 503 });

    const row = await getTaskById(taskId);
    if (!row || row.tasks.deletedAt) return NextResponse.json({ error: "Task not found" }, { status: 404 });
    const actorName = username || auth.displayName || auth.role;
    const actorUser = username ? await getUserByUsername(username) : null;
    if (!canManage && (!actorUser || actorUser.id !== row.tasks.assigneeUserId)) {
      return NextResponse.json({ error: "Only the assigned user can upload to this task" }, { status: 403 });
    }
    const existing = jsonAttachments(row.tasks.attachments);
    if (existing.length >= 5) return NextResponse.json({ error: "A task can have at most five files" }, { status: 400 });
    const rootFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    if (!rootFolderId) return NextResponse.json({ error: "Google Drive folder is not configured" }, { status: 503 });
    const taskFolder = await driveGetOrCreateFolder(rootFolderId, "Goko Task Bills");
    const monthFolder = await driveGetOrCreateFolder(taskFolder, getMonthKey());
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "attachment";
    const link = await driveUploadFile(`task_${taskId}_${Date.now()}_${safeName}`, file.type, await file.arrayBuffer(), monthFolder);
    const attachment = { name: file.name, mime: file.type, link, uploadedBy: actorName, uploadedAt: new Date().toISOString() };
    await updateTask(taskId, { attachments: JSON.stringify([...existing, attachment]), updatedBy: actorName });
    await addAuditEntry({ username: actorName, action: "task_updated", target: `task:${taskId}`, details: JSON.stringify({ attachment: file.name }) });
    return NextResponse.json({ success: true, attachment });
  } catch (error: unknown) {
    console.error("Task upload error:", error);
    return NextResponse.json({ error: "Task file upload failed" }, { status: 500 });
  }
}
