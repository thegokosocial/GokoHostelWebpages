# OTA overbooking remediation plan

## Incident conclusion

The weekend incident was a **commercial inventory overbooking**, not a duplicate physical-bed assignment. The inbound OTA webhook correctly persisted each booking as Unassigned when its mapped online pool was empty, and the existing Unassigned hold prevented a second local physical assignment. The missing step was containment: that capacity-breach branch alerted staff but did not recalculate and push zero availability for the affected room-nights.

The inbound events arrived after an earlier outgoing availability update had been acknowledged. A later zero-availability push also received an acknowledgement before another booking arrived. Therefore an Aiosell HTTP acknowledgement is evidence that the request was received, not proof that the OTA had stopped selling. The application had no provider-availability readback or durable incident state to make that distinction visible.

## Immediate containment — implemented

When an inbound mapped OTA booking cannot auto-assign an online unit:

1. Keep the booking Unassigned; never auto-cancel the guest or assign an offline bed.
2. Use the newly persisted Unassigned OTA hold to recalculate every requested mapped dorm-night. The result is the current safe capacity; it is zero for an exhausted type, but may remain positive for another requested type with real surplus.
3. Call `triggerInventoryPush` for those exact cells. It writes dirty inventory first, so an error, warning, disabled auto-push, or unconfirmed response remains eligible for the existing retry job.
4. Keep the reconciliation alert and booking-history entry. An accepted provider response is still a prompt for staff verification, not resolution.

This deliberately does not push ordinary inbound bookings back to the channel. The exception is only a confirmed local capacity breach.

## Risk-based regression matrix

| Path | Required outcome | Durable check |
|---|---|---|
| One mapped room, online unit available | one online assignment; no echo push | `pms-workflows.test.ts` |
| One mapped room, only offline units | Unassigned hold plus targeted one-night fence | `pms-workflows.test.ts` |
| Mixed mapped rooms / one shortage | no partial assignment; fence all requested mapped room-nights | `pms-workflows.test.ts` |
| Multi-night or multi-unit shortage | fence every stay night, not only arrival night | `pms-workflows.test.ts` |
| Provider rejects or cannot confirm fence | booking remains held; dirty inventory retry remains eligible; warning says retry queued | `pms-workflows.test.ts`, `inventory-mutations.integration.test.ts` |
| Duplicate/replayed inbound event | no second booking; an incomplete received stay retries online assignment and re-fences if still unassignable | channel webhook regressions |
| Unauthorized webhook | no booking, no inventory mutation | channel webhook regressions |
| Mobile operator handling | existing Unassigned panel surfaces the booking and preserves offline overflow as a deliberate human decision | existing channel UI Playwright/unit coverage; no UI behavior changed in this containment patch |

`OtaCapacityFenceRace.p` models the critical two-delivery schedule. Its guarded test requires provider availability to be zero at the first local capacity breach; its unsafe fixture proves the former alert-only path violates that invariant. This is a bounded ownership contract, not a substitute for the route/integration checks above.

## Next release: reconciliation closure

1. Add a durable `ota_capacity_incidents` record keyed by booking and affected dorm-night, with fence attempts/results, provider-readback result, owner, and resolution timestamp.
2. Add a manager/admin inventory reconciliation action (reuse `canManageInventory`) that requires explicit confirmation of the external OTA state before resolving an incident. Do not treat an inventory-push acknowledgement as closure.
3. Add a provider availability readback where the vendor contract supports it; otherwise require documented manual verification and retain the incident.
4. Make the scheduled retry prioritize open incidents, back off safely, and escalate after a bounded number of unconfirmed attempts.
5. Add a browser workflow for the incident state/action when that UI exists, plus D1 integration tests for incident idempotency and retry ownership.

## Release gates

Before release, run focused booking/channel/inventory tests, the full Vitest suite, TypeScript, `git diff --check`, and the production build. Run the P suite on the Pi with its approved P binary and preserve the guarded-pass/unsafe-fail output in the release record. The current workstation has neither Docker nor a P CLI; the Pi was reachable during this review but rejected available key-only SSH authentication, so that remote P result remains pending credential/key access.
