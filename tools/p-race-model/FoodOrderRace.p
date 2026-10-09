// Bounded model of the guest food-order stock check in src/app/api/food/order.
// One stock unit and two one-unit requests are enough to expose a stale-read race.

type tAttempt = (inventory: machine, quantity: int);
type tReserve = (source: machine, quantity: int);
type tReserveResult = (accepted: bool, stock: int);

event eReadStock: machine;
event eStockSnapshot: int;
event eReserve: tReserve;
event eReserveResult: tReserveResult;
event eStockChanged: int;

machine UnsafeInventory {
  var stock: int;

  start state Serving {
    entry (initialStock: int) {
      stock = initialStock;
      announce eStockChanged, stock;
    }

    on eReadStock do (source: machine) {
      send source, eStockSnapshot, stock;
    }

    // This intentionally mirrors validate-then-unconditional-decrement.
    on eReserve do (request: tReserve) {
      stock = stock - request.quantity;
      announce eStockChanged, stock;
      send request.source, eReserveResult, (accepted = true, stock = stock);
    }
  }
}

machine GuardedInventory {
  var stock: int;

  start state Serving {
    entry (initialStock: int) {
      stock = initialStock;
      announce eStockChanged, stock;
    }

    on eReadStock do (source: machine) {
      send source, eStockSnapshot, stock;
    }

    // The database owns the predicate and decrement in one write.
    on eReserve do (request: tReserve) {
      if (stock >= request.quantity) {
        stock = stock - request.quantity;
        announce eStockChanged, stock;
        send request.source, eReserveResult, (accepted = true, stock = stock);
      } else {
        send request.source, eReserveResult, (accepted = false, stock = stock);
      }
    }
  }
}

machine OrderAttempt {
  var inventory: machine;
  var quantity: int;

  start state CheckingStock {
    entry (input: tAttempt) {
      inventory = input.inventory;
      quantity = input.quantity;
      send inventory, eReadStock, this;
    }

    on eStockSnapshot goto Reserving;
  }

  state Reserving {
    entry {
      send inventory, eReserve, (source = this, quantity = quantity);
    }

    on eReserveResult goto Done;
  }

  state Done {}
}

spec StockNeverNegative observes eStockChanged {
  start state Watching {
    on eStockChanged do (stock: int) {
      assert stock >= 0, "guest inventory must never become negative";
    }
  }
}

machine TestUnsafeReadThenWrite {
  start state Init {
    entry {
      var inventory: UnsafeInventory;
      inventory = new UnsafeInventory(1);
      new OrderAttempt((inventory = inventory, quantity = 1));
      new OrderAttempt((inventory = inventory, quantity = 1));
    }
  }
}

machine TestGuardedReserve {
  start state Init {
    entry {
      var inventory: GuardedInventory;
      inventory = new GuardedInventory(1);
      new OrderAttempt((inventory = inventory, quantity = 1));
      new OrderAttempt((inventory = inventory, quantity = 1));
    }
  }
}

module UnsafeInventoryModel = { UnsafeInventory };
module GuardedInventoryModel = { GuardedInventory };
module OrderAttemptModel = { OrderAttempt };

test tcUnsafeReadThenWrite [main=TestUnsafeReadThenWrite]:
  assert StockNeverNegative in
  (union UnsafeInventoryModel, OrderAttemptModel, { TestUnsafeReadThenWrite });

test tcGuardedReserve [main=TestGuardedReserve]:
  assert StockNeverNegative in
  (union GuardedInventoryModel, OrderAttemptModel, { TestGuardedReserve });
