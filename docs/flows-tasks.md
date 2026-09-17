# To Do tasks

Management → To Do is the shared operational work queue. Tasks are assigned to database-backed login users, not payroll employees, but a task may be created unassigned and assigned later. A user with `canViewTasks` sees the shared active queue read-only, can update their own assigned tasks, and sees only their own tasks on Dashboard; unassigned tasks do not appear in any staff member’s Dashboard. `canManageTasks` grants create, edit, assign/reassign/unassign, archive, reopen, all-task management, and the same own-task Dashboard access. Admin bypasses both keys; existing users receive neither key automatically.

## Task lifecycle

New tasks start as `todo`. Staff can move their assigned task to `in_progress`, `blocked`, or `done`, and may update the shared note. Managers can update any task. Reopen changes a completed task back to `todo` and clears completion metadata. Archive is the audited delete behavior; archived tasks are excluded from active lists and retained for task managers.

Tasks require only a title. They also support a description, free-text category, low/normal/high/urgent priority, optional due date, and `general` or `purchase` type; type defaults to `general` and priority defaults to `normal`. The Dashboard sorts active overdue work first and keeps completed work in a separate section. Management can filter the shared queue by status, assignee, or unassigned tasks.

## Purchase tasks

JPEG, PNG, WebP, and PDF files can be attached to any task, with a 10 MB per-file and five-file limit. Files are uploaded to Google Drive and only their metadata/links are stored in the synced task row. Uploads require network access; task text and status still work offline.

A purchase task may be marked done without an expense. It then shows `Expense pending`. A user with `canAddExpense` can record one linked expense with amount, date, category, payment method, account, and optional vendor. The expense reuses the task’s uploaded bill links and the unique `expenses.task_id` relationship prevents duplicates. Reopening the task never reverses an existing expense.

All task mutations, assignment changes, status updates, archives, reopens, and task expense creation are written to the existing audit log. No recurring tasks, checklists, threaded comments, approval workflow, push notification, or employee-account mapping is included in this version.
