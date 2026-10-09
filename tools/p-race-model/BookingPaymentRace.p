// Two staff payment requests read the same booking balance before committing.
type tSnapshot = (ledger: machine, version: int);
type tCommit = (source: machine, expectedVersion: int, amount: int);
event eReadBooking: machine; event eBookingSnapshot: tSnapshot; event eCommitBooking: tCommit; event eBookingCollected: int;
machine UnsafeBookingLedger {
  var version: int; var collected: int;
  start state Open {
    on eReadBooking do (source: machine) { send source, eBookingSnapshot, (ledger = this, version = version); }
    on eCommitBooking do (commit: tCommit) { collected = collected + commit.amount; version = version + 1; announce eBookingCollected, collected; }
  }
}
machine CasBookingLedger {
  var version: int; var collected: int;
  start state Open {
    on eReadBooking do (source: machine) { send source, eBookingSnapshot, (ledger = this, version = version); }
    on eCommitBooking do (commit: tCommit) { if (commit.expectedVersion == version && collected + commit.amount <= 100) { collected = collected + commit.amount; version = version + 1; announce eBookingCollected, collected; } }
  }
}
machine BookingCollector {
  var ledger: machine; var version: int;
  start state Read { entry (input: machine) { ledger = input; send ledger, eReadBooking, this; } on eBookingSnapshot goto Commit with (snapshot: tSnapshot) { version = snapshot.version; } }
  state Commit { entry { send ledger, eCommitBooking, (source = this, expectedVersion = version, amount = 100); } }
}
spec BookingNeverOverCollected observes eBookingCollected { start state Watch { on eBookingCollected do (amount: int) { assert amount <= 100, "booking payment committed from a stale snapshot"; } } }
machine TestUnsafeBookingPayment { start state Init { entry { var ledger: UnsafeBookingLedger; ledger = new UnsafeBookingLedger(); new BookingCollector(ledger); new BookingCollector(ledger); } } }
machine TestCasBookingPayment { start state Init { entry { var ledger: CasBookingLedger; ledger = new CasBookingLedger(); new BookingCollector(ledger); new BookingCollector(ledger); } } }
module UnsafeBookingLedgerModel = { UnsafeBookingLedger }; module CasBookingLedgerModel = { CasBookingLedger }; module BookingCollectorModel = { BookingCollector };
test tcCasBookingPayment [main=TestCasBookingPayment]: assert BookingNeverOverCollected in (union CasBookingLedgerModel, BookingCollectorModel, { TestCasBookingPayment });
test tcUnsafeBookingPayment [main=TestUnsafeBookingPayment]: assert BookingNeverOverCollected in (union UnsafeBookingLedgerModel, BookingCollectorModel, { TestUnsafeBookingPayment });
