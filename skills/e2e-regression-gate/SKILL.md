---
name: e2e-regression-gate
description: Require risk-based end-to-end regression coverage for changed GokoWeb user workflows before commit or release.
---

# E2E regression gate

Use for every non-trivial behavior, workflow, payment, authentication, API, or UI change in GokoWeb.

Before implementation, trace the full path: triggering UI or API, authorization, persisted state, external/provider boundary, and rendered result. Write a compact path matrix with the applicable cases: success, validation/empty state, permission denial, retry/idempotency or stale state, and provider failure/fallback. Include mobile and desktop when the changed surface is responsive.

Add the smallest durable tests that cover that matrix:

- Unit tests for pure branching and formatting.
- Route/integration tests for authorization, persistence, request validation, and provider responses.
- Playwright tests for every changed user-visible path, with deterministic mocked APIs. Assert the request shape and the user-visible outcome; do not use production credentials or mutate live data.

Do not rely on a source-text assertion where a real route or browser test can exercise the behavior. A source contract is acceptable only for wiring that cannot be observed otherwise, and must accompany behavior-level coverage.

Before commit, run the focused unit/integration tests, the focused Playwright spec, TypeScript, diff check, and build. Run the full suite when the change affects shared payment, auth, or navigation behavior. Record any unrelated pre-existing failure without masking it. A migration is needed only for a durable data/schema change; never add one for UI state alone.
