// Aiosell can deliver a sale after local online capacity is already exhausted.
// The guarded path must close the affected OTA room-night before another sale can use it.
event eInboundBooking: machine; event eCapacityBreach: int;

machine UnsafeOtaCapacityStore {
  var localOnline: int;
  var otaAvailable: int;
  start state Open {
    entry { localOnline = 1; otaAvailable = 1; }
    on eInboundBooking do (source: machine) {
      if (localOnline > 0) { localOnline = localOnline - 1; }
      else { announce eCapacityBreach, otaAvailable; }
    }
  }
}

machine FencedOtaCapacityStore {
  var localOnline: int;
  var otaAvailable: int;
  start state Open {
    entry { localOnline = 1; otaAvailable = 1; }
    on eInboundBooking do (source: machine) {
      if (localOnline > 0) { localOnline = localOnline - 1; }
      else { otaAvailable = 0; announce eCapacityBreach, otaAvailable; }
    }
  }
}

machine OtaBookingDelivery {
  start state Deliver { entry (store: machine) { send store, eInboundBooking, this; } }
}

spec CapacityBreachIsFenced observes eCapacityBreach {
  start state Watch {
    on eCapacityBreach do (otaAvailable: int) {
      assert otaAvailable == 0, "unassignable OTA booking left sellable availability after the breach";
    }
  }
}

machine TestUnsafeCapacityBreach {
  start state Init {
    entry {
      var store: UnsafeOtaCapacityStore;
      store = new UnsafeOtaCapacityStore();
      new OtaBookingDelivery(store);
      new OtaBookingDelivery(store);
    }
  }
}

machine TestFencedCapacityBreach {
  start state Init {
    entry {
      var store: FencedOtaCapacityStore;
      store = new FencedOtaCapacityStore();
      new OtaBookingDelivery(store);
      new OtaBookingDelivery(store);
    }
  }
}

module UnsafeOtaCapacityModel = { UnsafeOtaCapacityStore };
module FencedOtaCapacityModel = { FencedOtaCapacityStore };
module OtaBookingDeliveryModel = { OtaBookingDelivery };

test tcFencedCapacityBreach [main=TestFencedCapacityBreach]: assert CapacityBreachIsFenced in (union FencedOtaCapacityModel, OtaBookingDeliveryModel, { TestFencedCapacityBreach });
test tcUnsafeCapacityBreach [main=TestUnsafeCapacityBreach]: assert CapacityBreachIsFenced in (union UnsafeOtaCapacityModel, OtaBookingDeliveryModel, { TestUnsafeCapacityBreach });
