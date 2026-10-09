// QR capture and desk payment compete to settle one food bill.
type tFoodPay = (source: machine, amount: int);
event eDeskPay: tFoodPay;
event eQrCapture: tFoodPay;
event eFoodCollected: int;

machine UnsafeFoodSettlement {
  var collected: int;
  start state Open {
    on eDeskPay do (payment: tFoodPay) { collected = collected + payment.amount; announce eFoodCollected, collected; }
    on eQrCapture do (payment: tFoodPay) { collected = collected + payment.amount; announce eFoodCollected, collected; }
  }
}

machine ClaimedFoodSettlement {
  var settled: bool;
  var collected: int;
  start state Open {
    on eDeskPay do (payment: tFoodPay) { Apply(payment); }
    on eQrCapture do (payment: tFoodPay) { Apply(payment); }
  }
  fun Apply(payment: tFoodPay) {
    if (!settled) { settled = true; collected = collected + payment.amount; announce eFoodCollected, collected; }
  }
}

machine FoodPayer {
  start state Pay {
    entry (input: (ledger: machine, qr: bool)) {
      if (input.qr) send input.ledger, eQrCapture, (source = this, amount = 100);
      else send input.ledger, eDeskPay, (source = this, amount = 100);
    }
  }
}

spec FoodBillNeverOverCollected observes eFoodCollected {
  start state Watch { on eFoodCollected do (amount: int) { assert amount <= 100, "food bill settled more than once"; } }
}

machine TestUnsafeFoodSettlement {
  start state Init { entry {
    var ledger: UnsafeFoodSettlement; ledger = new UnsafeFoodSettlement();
    new FoodPayer((ledger = ledger, qr = true)); new FoodPayer((ledger = ledger, qr = false));
  }}
}
machine TestClaimedFoodSettlement {
  start state Init { entry {
    var ledger: ClaimedFoodSettlement; ledger = new ClaimedFoodSettlement();
    new FoodPayer((ledger = ledger, qr = true)); new FoodPayer((ledger = ledger, qr = false));
  }}
}
module UnsafeFoodSettlementModel = { UnsafeFoodSettlement };
module ClaimedFoodSettlementModel = { ClaimedFoodSettlement };
module FoodPayerModel = { FoodPayer };
test tcClaimedFoodSettlement [main=TestClaimedFoodSettlement]: assert FoodBillNeverOverCollected in (union ClaimedFoodSettlementModel, FoodPayerModel, { TestClaimedFoodSettlement });
test tcUnsafeFoodSettlement [main=TestUnsafeFoodSettlement]: assert FoodBillNeverOverCollected in (union UnsafeFoodSettlementModel, FoodPayerModel, { TestUnsafeFoodSettlement });
