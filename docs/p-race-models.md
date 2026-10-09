# P race-condition models

Goko uses small [P](https://p-org.github.io/P/) models to systematically explore asynchronous workflow interleavings before or alongside implementation changes. They complement unit, route/integration, and Playwright coverage; they are not production code, a D1 simulator, or a substitute for authorization tests.

## Runnable models

`tools/p-race-model/FoodOrderRace.p` explores two one-item guest orders against one stock unit. Its invariant is that guest stock never becomes negative.

The expected-failure test models the existing dangerous pattern: a request reads availability and a later unconditional decrement writes the result. The guarded-reserve test models the required database contract: the same write checks `stock >= requested quantity` and decrements it, accepting at most one order.

This maps to the guest order flow in [flows-food-kitchen.md](flows-food-kitchen.md): the route now uses a conditional `stock_quantity >= requested` reservation for guests, returns a retryable `409 food_inventory_changed` when it loses, and leaves staff's explicit oversell behavior on its separate path.

On the Pi (64-bit Bookworm), the guarded model completed 100 schedules with zero bugs; the unsafe fixture found the negative-stock counterexample on its first schedule. The runner supports the official Docker image or a local P CLI through `P_BIN`.

`check.sh` runs these bounded contracts as a set:

| Model | Race boundary | Safety invariant |
|---|---|---|
| `FoodOrderRace` | stock read → guest reservation | tracked stock never goes negative |
| `FoodPaymentRace` | Razorpay capture ↔ desk payment | one food bill is settled at most once |
| `BookingPaymentRace` | stale payment snapshot → booking journal commit | collection never exceeds the due amount |
| `NativeHoldRace` | two website checkouts → one physical bed hold | a physical bed has at most one active hold |
| `CheckinRace` | retry submissions → identity-document upload | one idempotency key uploads documents at most once |

Each has a guarded test that must pass and an unsafe reference test that must fail. The latter proves the checker can exercise the stated bug class; it is not an assertion that the production implementation has every unsafe behavior.

## Rules for future models

- Keep the model finite and use only synthetic identifiers, amounts, and provider outcomes.
- Model the real ownership boundary: D1 write/CAS, Razorpay capture claim, idempotency key, or checkout hold.
- Express one safety or liveness invariant per model and retain an expected-failure fixture when it proves the harness can find the original bug class.
- Convert any relevant P trace into a focused Vitest/D1 regression before declaring a product workflow protected.
- Do not add credentials, production D1 access, or P dependencies to the Worker runtime.
