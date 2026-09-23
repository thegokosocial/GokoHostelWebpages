# Food-order save repair — reviewed plan

The reported paid/unpaid save failures on build 1b3d387 share an unconditional D1 transaction call. Repair the backend and remove the extra served-item staging confirmation.

1. Prepare and validate edits using current order, item, inventory and payment data. Commit edit identity, items, stock, totals, refunds, receipts and audit in one D1 batch. Use bounded NOT NULL guards within that batch to abort stale snapshots or stock conflicts. Use a synchronous SQLite transaction on Pi; an async callback commits too early.
2. Retain the original quantities for the live multi-item summary. One outer Save changes persists pending quantities, item removals and prices with the shared optional reason/notes. Remove the summary's inner Save/Cancel buttons. Cancel editing clears drafts; failed saves retain them. Unchanged retries reuse their operation ID, including refunds.
3. Replace transaction-only edit mocks with actual disposable D1/workerd tests. Verify unpaid/partial/paid additions, exact refunds, rollback after late failures, snapshot conflicts, competing stock claims, large orders, idempotency and real Pi transaction behavior. Update browser tests for one save, multi-line reasons, quantities above three, no-op reversal, retained failed drafts and cancellation controls.
4. Run focused tests, full Vitest, TypeScript, diff checks and production build. Update flow/API/testing/decision documentation. No schema or permission change is required. Production deployment and migration verification remain separate release steps.

Review correction: use an immediate NOT NULL constraint guard instead of a foreign-key guard, and split guards into bounded statements to avoid D1 bind limits on larger orders. Existing cancellation confirmations remain separate from the removed quantity-summary buttons.
