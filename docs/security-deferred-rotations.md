# Deferred security rotations

The first security hardening rollout intentionally does not rotate live integration credentials. These are deferred until an explicit maintenance window:

- `ADMIN_PASSWORD` and `MANAGER_PASSWORD` will be rotated manually by the maintainer before production rollout.
- Google OAuth refresh token and client credentials will be revoked/reconnected later.
- Sync, webhook, Razorpay/payment, Aiosell/channel-manager, and other integration secrets will be rotated later.

Until completed, treat these credentials as an accepted residual risk. Do not paste their values into source, tickets, chat, or logs. When the rotation window is approved, update Cloudflare and Pi together, reconnect affected integrations, invalidate all sessions, and run the documented smoke tests.
