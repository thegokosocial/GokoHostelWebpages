/** Shared task note journal + shopping checklist helpers (synced JSON on tasks row). */

export type TaskNoteEntry = {
  id: string;
  body: string;
  authorUsername: string;
  createdAt: string;
};

export type ShoppingItemEntry = {
  id: string;
  label: string;
  bought: boolean;
  boughtAt?: string;
  boughtBy?: string;
};

export const TASK_NOTE_MAX = 5000;
export const TASK_NOTES_CAP = 50;
export const SHOPPING_ITEM_LABEL_MAX = 200;
export const SHOPPING_ITEMS_CAP = 100;
export const TASK_TYPES = ["general", "purchase", "shopping"] as const;
export type TaskTypeValue = (typeof TASK_TYPES)[number];

export function parseTaskNotes(value: string | null | undefined): TaskNoteEntry[] {
  try {
    const parsed = JSON.parse(value || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .map((item) => ({
        id: typeof item.id === "string" ? item.id : "",
        body: typeof item.body === "string" ? item.body : "",
        authorUsername: typeof item.authorUsername === "string" ? item.authorUsername : "",
        createdAt: typeof item.createdAt === "string" ? item.createdAt : "",
      }))
      .filter((item) => item.id && item.body);
  } catch {
    return [];
  }
}

export function parseShoppingItems(value: string | null | undefined): ShoppingItemEntry[] {
  try {
    const parsed = JSON.parse(value || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .map((item) => ({
        id: typeof item.id === "string" ? item.id : "",
        label: typeof item.label === "string" ? item.label.trim() : "",
        bought: Boolean(item.bought),
        boughtAt: typeof item.boughtAt === "string" ? item.boughtAt : undefined,
        boughtBy: typeof item.boughtBy === "string" ? item.boughtBy : undefined,
      }))
      .filter((item) => item.id && item.label);
  } catch {
    return [];
  }
}

export function newTaskEntityId(): string {
  return globalThis.crypto?.randomUUID?.() || `t-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function appendTaskNoteEntry(
  existingJson: string | null | undefined,
  body: string,
  authorUsername: string,
  createdAt = new Date().toISOString(),
): { ok: true; notes: TaskNoteEntry[]; json: string } | { ok: false; error: string } {
  const trimmed = body.trim();
  if (!trimmed) return { ok: false, error: "Note cannot be empty" };
  if (trimmed.length > TASK_NOTE_MAX) return { ok: false, error: `Note must be at most ${TASK_NOTE_MAX} characters` };
  const notes = parseTaskNotes(existingJson);
  if (notes.length >= TASK_NOTES_CAP) return { ok: false, error: `At most ${TASK_NOTES_CAP} notes per task` };
  notes.push({ id: newTaskEntityId(), body: trimmed, authorUsername, createdAt });
  return { ok: true, notes, json: JSON.stringify(notes) };
}

/** Merge legacy free-text `note` into the journal for display and before append. */
export function presentTaskNotes(
  notesJson: string | null | undefined,
  legacyNote: string | null | undefined,
  meta: { taskId: number | string; authorUsername: string; createdAt: string },
): TaskNoteEntry[] {
  const notes = parseTaskNotes(notesJson);
  const trimmed = typeof legacyNote === "string" ? legacyNote.trim() : "";
  if (!trimmed) return notes;
  const legacyId = `legacy-${meta.taskId}`;
  if (notes.some((entry) => entry.id === legacyId || entry.body === trimmed)) return notes;
  const legacyEntry: TaskNoteEntry = {
    id: legacyId,
    body: trimmed.slice(0, TASK_NOTE_MAX),
    authorUsername: meta.authorUsername || "unknown",
    createdAt: meta.createdAt || "",
  };
  return [legacyEntry, ...notes];
}

/** Seed journal JSON from legacy `note` when the journal is empty (before append). */
export function notesJsonWithLegacySeed(
  notesJson: string | null | undefined,
  legacyNote: string | null | undefined,
  meta: { taskId: number | string; authorUsername: string; createdAt: string },
): string {
  return JSON.stringify(presentTaskNotes(notesJson, legacyNote, meta));
}

/** Build shopping items from manager-provided labels; preserve bought state by id when present. */
export function buildShoppingItemsFromInput(
  input: unknown,
  previousJson: string | null | undefined = "[]",
): { ok: true; items: ShoppingItemEntry[]; json: string } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: false, error: "shoppingItems must be an array" };
  if (input.length > SHOPPING_ITEMS_CAP) return { ok: false, error: `At most ${SHOPPING_ITEMS_CAP} shopping items` };
  const previous = new Map(parseShoppingItems(previousJson).map((item) => [item.id, item]));
  const items: ShoppingItemEntry[] = [];
  for (const raw of input) {
    if (typeof raw === "string") {
      const label = raw.trim().slice(0, SHOPPING_ITEM_LABEL_MAX);
      if (!label) continue;
      items.push({ id: newTaskEntityId(), label, bought: false });
      continue;
    }
    if (!raw || typeof raw !== "object") return { ok: false, error: "Invalid shopping item" };
    const row = raw as Record<string, unknown>;
    const label = typeof row.label === "string" ? row.label.trim().slice(0, SHOPPING_ITEM_LABEL_MAX) : "";
    if (!label) continue;
    const id = typeof row.id === "string" && row.id ? row.id : newTaskEntityId();
    const prev = previous.get(id);
    items.push({
      id,
      label,
      bought: prev ? prev.bought : Boolean(row.bought),
      boughtAt: prev?.boughtAt,
      boughtBy: prev?.boughtBy,
    });
  }
  return { ok: true, items, json: JSON.stringify(items) };
}

export function toggleShoppingItemInList(
  existingJson: string | null | undefined,
  itemId: string,
  actorUsername: string,
  boughtAt = new Date().toISOString(),
): { ok: true; items: ShoppingItemEntry[]; json: string; allBought: boolean; anyOpen: boolean } | { ok: false; error: string } {
  const items = parseShoppingItems(existingJson);
  const index = items.findIndex((item) => item.id === itemId);
  if (index < 0) return { ok: false, error: "Shopping item not found" };
  const current = items[index];
  const bought = !current.bought;
  items[index] = bought
    ? { ...current, bought: true, boughtAt, boughtBy: actorUsername }
    : { id: current.id, label: current.label, bought: false };
  const allBought = items.length > 0 && items.every((item) => item.bought);
  const anyOpen = items.some((item) => !item.bought);
  return { ok: true, items, json: JSON.stringify(items), allBought, anyOpen };
}

export function canCollaborateOnTask(opts: {
  canManage: boolean;
  actorUserId?: number | null;
  actorUsername?: string | null;
  assigneeUserId?: number | null;
  followerUsernamesJson?: string | null;
}): boolean {
  if (opts.canManage) return true;
  if (opts.actorUserId && opts.assigneeUserId && opts.actorUserId === opts.assigneeUserId) return true;
  if (opts.actorUsername) {
    try {
      const parsed = JSON.parse(opts.followerUsernamesJson || "[]");
      if (Array.isArray(parsed) && parsed.includes(opts.actorUsername)) return true;
    } catch { /* ignore */ }
  }
  return false;
}

export function shoppingProgress(items: ShoppingItemEntry[]): { bought: number; total: number } {
  return { bought: items.filter((item) => item.bought).length, total: items.length };
}

export function sortShoppingItemsForDisplay(items: ShoppingItemEntry[]): ShoppingItemEntry[] {
  return [...items].sort((a, b) => Number(a.bought) - Number(b.bought));
}
