# Goko P race models

This directory is a design-time model checker for bounded Goko workflows. It does not run in the Next.js application, touch D1, or use production credentials.

## Food-order inventory

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

## Scope and next models

The model deliberately excludes order headers, line-item compensation, tab limits, and push notifications. They are separate state transitions; including them before the stock reservation contract is wired into the route would add state without making the first race easier to diagnose.

Next, add models for food QR capture versus desk payment, booking payment CAS/retry, native inventory holds, and self-check-in idempotency/checkout. Keep each model bounded and attach its invariants to the relevant flow document.
