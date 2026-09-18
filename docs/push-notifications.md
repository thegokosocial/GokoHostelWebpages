# Push notifications

All app pushes use `src/lib/pushNotify.ts` and `public/sw.js`; no separate legacy display system is maintained. The header bell opens device notification settings, not an event inbox. Existing recipients and permissions are unchanged.

The dialog always shows an **Install app** section while the admin UI is not running as an installed/standalone app: Chrome gets a native Install button when `beforeinstallprompt` is available, otherwise menu instructions; iPhone/iPad always get Share → Add to Home Screen steps. Enable notifications on iOS is disabled in a Safari tab and only runs from the Home Screen app (iOS/iPadOS 16.4+). Subscribe waits for `navigator.serviceWorker.ready` before `pushManager.subscribe`.

## Event inventory

| Family | Events / producers |
| --- | --- |
| Food | New Food Order: guest ordering and admin-created orders |
| Check-in | New Check-in: self-check-in and admin records; Guest Checked In: bookings |
| Booking | New Booking, Booking Rebooked, Booking Modified, Booking Dates Changed, Booking Cancelled, Booking Partially Cancelled, Booking Marked No-show: admin bookings and/or Aiosell reservations |
| Attention | Booking Needs Attention, Booking Needs Bed Assignment, OTA Inventory Reconciliation Needed, Channel Booking Sync Failed, Inventory Sync Failed: booking/PMS workflows |
| Reminder | Reconciliation pending: scheduled reminder, existing role-restricted recipients |
| Test | Test Notification: notification settings `/api/push` test action |

Food bodies always include the first name, items, room/bed or table when present, amount and approval requirement. Missing names use Guest. Item summaries are shortened to preserve identifying context. Full names, phone numbers and identity documents are not added to lock-screen content.

## Rendering and troubleshooting

The worker normalizes blank/invalid text, supplies meaningful defaults, accepts legacy plain-text payloads and generates distinct tags when no event identity exists. Existing event tags retain intentional replacement behavior. Sender and receiver permit only the same-origin `/admin` page with query/hash; unsafe links fall back to `/admin`.

Display first uses Goko icons plus optional platform features. If rejected, retry with branded options without vibration/renotify/timestamp, then use minimal text only if branding is also rejected. Terminal failures log a generic message without payload contents. Browser/OS notification layouts cannot be controlled by Goko.

Chrome's “Tap to copy the URL for this app” card is a browser-owned app notice, not an empty Goko push. Dismiss it in Android; app code cannot remove it. Already displayed cards are not retroactively restyled.

The worker registration checks for updates without clearing subscriptions or requiring reinstall. Enable/test/disable report failures and clear busy states. Test counts mean acceptance by the push service, not confirmed display: check the phone, site permission and OS notification/sound settings.

## Verification

Run payload and executable worker Vitest coverage plus the full suite, TypeScript and production build. After deployment, verify Android Chrome and installed Goko in foreground/background: food names/location, branding, click destination, upgrade without resubscription, denied permissions and settings failures. Verify installed iOS when a device is available; automated mocks do not prove physical-device rendering.
