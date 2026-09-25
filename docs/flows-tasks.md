# To Do tasks

Management → To Do is the shared operational work queue. Tasks are assigned to database-backed login users, not payroll employees, but a task may be created unassigned and assigned later. A user with `canViewTasks` sees the shared active queue read-only, can update their own assigned tasks, and sees only their own tasks on Dashboard; unassigned tasks do not appear in any staff member’s Dashboard. `canManageTasks` grants create, edit, assign/reassign/unassign, archive, reopen, all-task management, and the same own-task Dashboard access. Admin bypasses both keys; existing users receive neither key automatically.

## Task lifecycle

New tasks start as `todo`. Staff can move their assigned task to `in_progress`, `blocked`, or `done`, and may update the shared note. Managers can update any task. Reopen changes a completed task back to `todo` and clears completion metadata. Archive is the audited delete behavior; archived tasks are excluded from active lists and retained for task managers.

Tasks require only a title. They also support a description, free-text category, low/normal/high/urgent priority, optional due date, `general` or `purchase` type, and followers selected from active login users; type defaults to `general` and priority defaults to `normal`. New tasks default the creator and assignee as followers unless the manager explicitly chooses another list. Reassigning a task adds the new assignee without removing existing followers. The Dashboard sorts active overdue work first and keeps completed work in a separate section. Management can filter the shared queue by status, assignee, or unassigned tasks.

## Notifications

Assigning a new task, or changing it to a different non-null assignee, sends `task.assigned` to that assignee unless they performed the action. The first transition from a non-done state to `done` sends `task.completed` to the task followers except the actor. Saving an already-completed task, reopening, archiving, notes, attachments, and expense changes do not produce task notifications. Delivery remains best-effort and is filtered by the administrator's `canReceiveTaskNotifications` grant and each device's event preferences; push failure never rolls back the task mutation.

## Purchase tasks

JPEG, PNG, WebP, and PDF files can be attached to any task, with a 10 MB per-file and five-file limit. Files are uploaded to Google Drive and only their metadata/links are stored in the synced task row. Uploads require network access; task text and status still work offline.

A purchase task may be marked done without an expense. It then shows `Expense pending`. A user with `canAddExpense` can record one linked expense with amount, date, category, payment method, account, and optional vendor. The expense reuses the task’s uploaded bill links and the unique `expenses.task_id` relationship prevents duplicates. Reopening the task never reverses an existing expense.

All task mutations, follower and assignment changes, status updates, archives, reopens, and task expense creation are written to the existing audit log. No recurring tasks, checklists, threaded comments, approval workflow, or employee-account mapping is included in this version.
