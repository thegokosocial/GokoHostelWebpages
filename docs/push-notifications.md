# Push notifications

All app pushes use `src/lib/pushNotify.ts`, the shared notification catalog, and `public/sw.js`; no separate legacy display system is maintained. The header bell manages install/enable/test/disable. Management → My Preferences lists only the notification categories granted by an administrator and lets the user mute a whole category or individual event on that browser/PWA.

The dialog always shows an **Install app** section (admin bell only). Chrome/Android gets a native Install button when `beforeinstallprompt` is available, otherwise menu instructions. **iPhone/iPad have no install API** — the dialog shows Safari Share → Add to Home Screen steps (detects non-Safari browsers and offers a copyable `/admin` link). Already-installed sessions show a short confirmation. The public website does **not** advertise a web app manifest or Apple web-app meta — those live on `src/app/admin/layout.tsx` only (with `apple-touch-icon` and `apple-mobile-web-app-capable`) — so guests do not get browser install pop-ups. Service worker registration still runs on iOS Safari tabs so Add to Home Screen can attach a real app; Enable notifications stays disabled until the Home Screen app is open (iOS/iPadOS 16.4+). Subscribe waits for `navigator.serviceWorker.ready` before `pushManager.subscribe`. After admin login succeeds, the password is cleared from client state; `/api/push` accepts the current HttpOnly session. Test sends only to the requesting endpoint and bypasses preference filters.

## Event inventory

| Family | Events / producers |
| --- | --- |
| Food | New Food Order: guest ordering and admin-created orders |
| Check-in | New Check-in: self-check-in and admin records; Guest Checked In: bookings |
| Booking | New Booking, Booking Rebooked, Booking Modified, Booking Dates Changed, Booking Cancelled, Booking Partially Cancelled, Booking Marked No-show: admin bookings and/or Aiosell reservations |
| Tasks | Task Assigned: newly assigned user; Task Completed: followers on first transition to done; Task Status Changed: followers on other status transitions including reopen |
| Attention | Booking Needs Attention, Booking Needs Bed Assignment |
| Operations | OTA Inventory Reconciliation Needed, Channel Booking Sync Failed, Inventory Sync Failed |
| Reminder | Reconciliation pending: scheduled reminder, existing role-restricted recipients |
| Test | Test Notification: notification settings `/api/push` test action |

Food bodies always include the first name, items, room/bed or table when present, amount and approval requirement. Missing names use Guest. Item summaries are shortened to preserve identifying context. Full names, phone numbers and identity documents are not added to lock-screen content.

## Recipient controls

Delivery is the intersection of event recipients, existing role restrictions, the administrator-granted category, and the device's muted event IDs. Notification category grants are active permission-catalog keys edited under Management → Users. Legacy DB users with no category keys retain all categories; migration 0076 enables the Tasks category for existing active users, and new users receive it with the other defaults. Once configured, explicit false values block that category server-side. Admin/environment system accounts retain all category grants. Device exclusions are stored on `push_subscriptions`; hidden categories are preserved when visible preferences are saved, so re-granting restores the previous device choice. Unknown/deleted users are ineligible, and deleting a DB user removes its subscriptions. Task assignment is targeted to the new assignee; task completion and other status changes are targeted to the task's active followers, with the actor excluded.

## Rendering and troubleshooting

The worker normalizes blank/invalid text, supplies meaningful defaults, accepts legacy plain-text payloads and generates distinct tags when no event identity exists. Existing event tags retain intentional replacement behavior. Sender and receiver permit only the same-origin `/admin` page with query/hash; unsafe links fall back to `/admin`.

Display first uses Goko's full-color app icon, a separate monochrome status badge, and optional vibration/renotify/timestamp. If rejected, retries progressively remove optional features while preserving branding; a minimal text fallback is used only if branded display also fails. Terminal failures log a generic message without payload contents. Browser/OS notification layouts cannot be controlled by Goko. The manifest's square 512px install icon is kept dimensionally accurate.

Chrome's “Tap to copy the URL for this app” card is a browser-owned app notice, not an empty Goko push. Android/Chrome may also show an **Unsubscribe** control for site notifications; it is not an action added by Goko and cannot be removed by app code. Already displayed cards are not retroactively restyled.

The worker registration checks for updates without clearing subscriptions or requiring reinstall. Enable/test/disable report failures and clear busy states. Test counts mean acceptance by the push service, not confirmed display or sound. If a notification appears but is silent, check Android notification sound for Chrome's site notification channel (or Goko if installed), notification volume, and Do Not Disturb. The web app can request vibration where supported but cannot force Android to play sound. The reconciliation reminder formats its date using the shared notification formatter.

## Verification

Run payload and executable worker Vitest coverage plus the full suite, TypeScript and production build. Verify manifest icon sizes against PNG dimensions. After deployment, verify Android Chrome and installed Goko in foreground/background: food names/location, app icon and badge, click destination, sound/vibration with device notifications enabled, and silent behavior with Do Not Disturb or channel sound disabled. Verify installed iOS when a device is available; automated mocks do not prove physical-device rendering or sound.
