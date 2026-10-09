# Goko P race models

This directory is a design-time model checker for bounded Goko workflows. It does not run in the Next.js application, touch D1, or use production credentials.

## Runnable workflow suite

`check.sh` compiles and checks eight independent, bounded models:

| Model | Contract |
|---|---|
| `FoodOrderRace` | two guest orders cannot oversell one tracked unit |
| `FoodPaymentRace` | Razorpay capture and desk payment settle a food bill once |
| `BookingPaymentRace` | stale booking-payment commits cannot over-collect |
| `NativeHoldRace` | one physical bed cannot receive overlapping website holds |
| `CheckinRace` | one idempotency key cannot upload identity files twice |
| `PhysicalBedRace` | two staff claims cannot occupy the same physical bed |
| `ChannelBookingRace` | duplicate Aiosell deliveries cannot create two bookings |
| `RecurringExpenseRace` | duplicate cron runs cannot create/post the same rule/date twice |

`FoodOrderRace.p` models two guest orders for one tracked stock unit. Each attempt reads stock, then later requests a reservation. The scheduler explores the interleavings between those steps.

- `tcUnsafeReadThenWrite` is an expected-failure fixture: it represents a stock check followed by an unconditional decrement, and must produce `guest inventory must never become negative`.
- `tcGuardedReserve` is the target contract: the inventory owner performs `stock >= quantity` and decrement in the same operation, so exactly one request is accepted.

Run the bounded check with Docker (the official P image supports Apple Silicon and CI):

```sh
bash tools/p-race-model/check.sh
```

If the official image cannot be pulled but a local P CLI is available, set `P_BIN` to it instead:

```sh
P_BIN=/home/goko/.local/bin/p bash tools/p-race-model/check.sh
```

The script checks 100 schedules per test. The Pi baseline passed the guarded model for 100 schedules and found the unsafe counterexample on its first schedule. A P counterexample is an abstract trace, not evidence that a database implementation is fixed; promote every relevant trace to a D1 route/integration regression before changing production behavior.

## Scope

The models deliberately exclude unbounded request volume, real provider I/O, Drive, D1, and UI rendering. They establish ownership contracts, not framework wiring. Keep future additions bounded and attach their invariants to the relevant flow document.
