// Two website checkouts contend for one physical bed hold.
type tHold = (source: machine, quantity: int); event eAcquireHold: tHold; event eHoldCount: int;
machine UnsafeHoldStore { var held: int; start state Open { on eAcquireHold do (request: tHold) { held = held + request.quantity; announce eHoldCount, held; } } }
machine GuardedHoldStore { var held: int; start state Open { on eAcquireHold do (request: tHold) { if (held + request.quantity <= 1) { held = held + request.quantity; announce eHoldCount, held; } } } }
machine HoldRequester { start state Request { entry (store: machine) { send store, eAcquireHold, (source = this, quantity = 1); } } }
spec BedHeldAtMostOnce observes eHoldCount { start state Watch { on eHoldCount do (count: int) { assert count <= 1, "one physical bed has overlapping holds"; } } }
machine TestUnsafeHold { start state Init { entry { var store: UnsafeHoldStore; store = new UnsafeHoldStore(); new HoldRequester(store); new HoldRequester(store); } } }
machine TestGuardedHold { start state Init { entry { var store: GuardedHoldStore; store = new GuardedHoldStore(); new HoldRequester(store); new HoldRequester(store); } } }
module UnsafeHoldModel = { UnsafeHoldStore }; module GuardedHoldModel = { GuardedHoldStore }; module HoldRequesterModel = { HoldRequester };
test tcGuardedHold [main=TestGuardedHold]: assert BedHeldAtMostOnce in (union GuardedHoldModel, HoldRequesterModel, { TestGuardedHold });
test tcUnsafeHold [main=TestUnsafeHold]: assert BedHeldAtMostOnce in (union UnsafeHoldModel, HoldRequesterModel, { TestUnsafeHold });
