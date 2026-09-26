# To Do tasks

Management → To Do is the shared operational work queue. Tasks are assigned to database-backed login users, not payroll employees, but a task may be created unassigned and assigned later. A user with `canViewTasks` sees the shared active queue read-only, can update their own assigned tasks, and sees only their own tasks on Dashboard; unassigned tasks do not appear in any staff member’s Dashboard. `canManageTasks` grants create, edit, assign/reassign/unassign, archive, reopen, shopping-list edits, all-task management, and the same own-task Dashboard access. Admin bypasses both keys and may permanently delete **archived** tasks. Existing users receive neither key automatically.

## Task lifecycle

New tasks start as `todo`. Staff can move their assigned task to `in_progress`, `blocked`, or `done`, and may append notes when they are the assignee or a follower. Managers can update any task. Reopen changes a completed task back to `todo` and clears completion metadata. Archive is the soft-delete behavior; archived tasks are excluded from active lists and retained for task managers. Admin **Delete permanently** hard-deletes an archived task row after clearing `expenses.task_id` so any linked purchase expense remains in Accounts.

Tasks require only a title. They also support a description, free-text category, low/normal/high/urgent priority, optional due date, type `general` / `purchase` / `shopping`, and followers selected from active login users; type defaults to `general` and priority defaults to `normal`. New tasks default the creator and assignee as followers unless the manager explicitly chooses another list. Reassigning a task adds the new assignee without removing existing followers. The Dashboard sorts active overdue work first and keeps completed work in a separate section. Management can filter the shared queue by status, assignee, or unassigned tasks.

### Notes journal

Each task stores an append-only `notes` JSON journal (`id`, `body`, `authorUsername`, `createdAt`). Managers, the assignee, and followers can add notes; notes cannot be edited or deleted. Cards and detail views show the full journal (scroll-capped on phone) plus an inline Add composer — opening Edit is not required to read or append. Legacy `note` is left in place for older rows and is presented as a single journal entry when `notes` is empty.

### Shopping list type

`taskType: shopping` is separate from Purchase (no expense linking). Managers set the item list (`label` strings; optional qty belongs in the label). Managers, assignee, and followers can mark items bought/unbought. Progress shows as `bought/total` on the card. When every item is bought the task auto-moves to `done` (first-completion notify). Unbuying any item while done reopens to `in_progress` and sends a status-changed notify. Notes still work on shopping tasks.

Task managers open active tasks directly in one combined editor containing task fields, status, notes journal, shopping list (when type is shopping), files/upload, archive/reopen, and permitted purchase-expense actions. Saving, cancelling, or closing returns to the queue without opening a second details dialog. View-only users and archived tasks retain the non-editable details dialog; collaborators can still append notes and toggle shopping items there.

## Notifications

Assigning a new task, or changing it to a different non-null assignee, sends `task.assigned` to that assignee unless they performed the action. The first transition from a non-done state to `done` (manual or shopping auto-complete) sends `task.completed` to the task followers except the actor. Every other status change — including todo→in_progress, blocked, and reopen — sends `task.status_changed` to followers except the actor. Saving an already-completed task as done again, archiving, notes, attachments, shopping item toggles that do not change status, and expense changes do not produce task notifications. Delivery remains best-effort and is filtered by the administrator's `canReceiveTaskNotifications` grant and each device's event preferences; push failure never rolls back the task mutation.

## Purchase tasks

JPEG, PNG, WebP, and PDF files can be attached to any task, with a 10 MB per-file and five-file limit. Files are uploaded to Google Drive and only their metadata/links are stored in the synced task row. Uploads require network access; task text and status still work offline.

A purchase task may be marked done without an expense. It then shows `Expense pending`. A user with `canAddExpense` can record one linked expense with amount, date, category, payment method, account, and optional vendor. The expense reuses the task’s uploaded bill links and the unique `expenses.task_id` relationship prevents duplicates. Reopening the task never reverses an existing expense. Shopping-list tasks never create linked expenses.

All task mutations, follower and assignment changes, status updates, archives, reopens, hard deletes, note appends, shopping toggles, and task expense creation are written to the existing audit log. No recurring tasks, threaded comment edits, approval workflow, or employee-account mapping is included in this version. Browser coverage lives in `e2e/management-tasks.spec.ts` (mocked Management → To Do journeys for general / purchase / shopping).
