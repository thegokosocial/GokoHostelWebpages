# GokoWeb handbook

Project knowledge for humans and LLMs. **Passwords, tokens, SSH, and live Worker version stamps are not in this folder’s git copy.** Those stay in:

- `docs/secrets-and-access.md` (**gitignored**) — logins, Google, Cloudflare tokens, Pi SSH
- `MAINTAINER.local.md` (**gitignored**) — what is live today (deploys, D1 stamps)

If those files are missing on a machine, do not invent secrets. Bindings that *are* in git: `wrangler.jsonc`.

When handbook and `src/` disagree, **trust `src/`**. When live production status disagrees, trust `MAINTAINER.local.md`. Project-wide update requirements are in [`AGENTS.md`](../AGENTS.md).

Last source-aligned pass: **11 Sep 2026** (bulk inventory availability updates, PMS push/retry behavior, and existing analytics corrections). After a product change, update the matching file here (Cursor rule `goko-local-docs`).

---

## New LLM session

1. [developing.md](developing.md) — how to continue work (includes **handoff** rules)  
2. [llm-onboarding.md](llm-onboarding.md) — landmines  
3. [overview.md](overview.md) — product map  
4. [interactions.md](interactions.md) — mermaid sequences  
5. One flow file for the task  
6. [secrets-and-access.md](secrets-and-access.md) only if you must run or deploy  

Handoff in short: trust `src/` over docs; trust local `MAINTAINER.local.md` for what is live; never commit secrets files; GitHub Actions does **not** deploy (Workers Builds **does** on push to `main`); landmines before bookings / food tab / money. Full text: [developing.md](developing.md#handoff-to-another-agent).  

---

## Map

| If you need… | Open |
|--------------|------|
| Continue development | [developing.md](developing.md) |
| Landmines / wire formats | [llm-onboarding.md](llm-onboarding.md) |
| What the product is | [overview.md](overview.md) |
| Pages + admin components | [pages-and-ui.md](pages-and-ui.md) |
| Sequences / state machines | [interactions.md](interactions.md) |
| Two runtimes, Worker, D1, R2 | [architecture.md](architecture.md) |
| Why we built it this way | [decisions.md](decisions.md) |
| Module + ER graphs | [relationships.md](relationships.md) |
| Table catalog | [data-model.md](data-model.md) |
| Every SQL column | [schema-columns.md](schema-columns.md) |
| Auth + RBAC | [auth-rbac.md](auth-rbac.md) |
| Every API + `action` | [api-map.md](api-map.md) |
| Env **names** (no values) | [env-vars.md](env-vars.md) |
| Passwords / tokens | **[secrets-and-access.md](secrets-and-access.md)** (local only) |
| Vendors | [integrations.md](integrations.md) |
| Aiosell vendor API contract | [aiosell-api-reference.md](aiosell-api-reference.md) |
| Repo layout | [directory.md](directory.md) |
| Coding rules | [conventions.md](conventions.md) |
| Tests + CI + Workers Builds | [testing-and-ci.md](testing-and-ci.md) |
| Stale committed README/ARCHITECTURE | [stale-docs.md](stale-docs.md) |
| Commands (no secrets) | [maintain.md](maintain.md) |

### Flows

| File | Topic |
|------|--------|
| [flows-guest-checkin.md](flows-guest-checkin.md) | Self check-in, Vision, Drive |
| [flows-food-kitchen.md](flows-food-kitchen.md) | Menu, orders, kitchen, bills |
| [flows-pms.md](flows-pms.md) | Beds, bookings, inventory, Aiosell |
| [flows-accounts.md](flows-accounts.md) | Expenses, ledger, salary |
| [flows-splits.md](flows-splits.md) | Staff/volunteer IOUs |
| [flows-cms.md](flows-cms.md) | Events / Community, R2 |
| [flows-sync.md](flows-sync.md) | Cloudflare ↔ Pi |
| [flows-reviews-formc.md](flows-reviews-formc.md) | Reviews + FRRO Form C |
