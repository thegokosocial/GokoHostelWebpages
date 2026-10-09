// Two cron invocations generate one rule/date occurrence and at most one expense.
event eRunSchedule: machine; event eOccurrenceCount: int; event eExpenseCount: int;
machine UnsafeSchedule {
  var occurrences: int; var expenses: int;
  start state Open { on eRunSchedule do (source: machine) { occurrences = occurrences + 1; expenses = expenses + 1; announce eOccurrenceCount, occurrences; announce eExpenseCount, expenses; } }
}
machine UniqueSchedule {
  var created: bool; var occurrences: int; var expenses: int;
  start state Open { on eRunSchedule do (source: machine) { if (!created) { created = true; occurrences = occurrences + 1; expenses = expenses + 1; announce eOccurrenceCount, occurrences; announce eExpenseCount, expenses; } } }
}
machine ScheduleRun { start state Run { entry (store: machine) { send store, eRunSchedule, this; } } }
spec RecurringExpenseCreatedOnce observes eOccurrenceCount, eExpenseCount { start state Watch { on eOccurrenceCount do (count: int) { assert count <= 1, "duplicate cron created recurring occurrences"; } on eExpenseCount do (count: int) { assert count <= 1, "duplicate cron posted recurring expense"; } } }
machine TestUnsafeRecurringExpense { start state Init { entry { var store: UnsafeSchedule; store = new UnsafeSchedule(); new ScheduleRun(store); new ScheduleRun(store); } } }
machine TestUniqueRecurringExpense { start state Init { entry { var store: UniqueSchedule; store = new UniqueSchedule(); new ScheduleRun(store); new ScheduleRun(store); } } }
module UnsafeScheduleModel = { UnsafeSchedule }; module UniqueScheduleModel = { UniqueSchedule }; module ScheduleRunModel = { ScheduleRun };
test tcUniqueRecurringExpense [main=TestUniqueRecurringExpense]: assert RecurringExpenseCreatedOnce in (union UniqueScheduleModel, ScheduleRunModel, { TestUniqueRecurringExpense });
test tcUnsafeRecurringExpense [main=TestUnsafeRecurringExpense]: assert RecurringExpenseCreatedOnce in (union UnsafeScheduleModel, ScheduleRunModel, { TestUnsafeRecurringExpense });
