# WhatsApp messaging

Staff messaging uses the shared StaffWhatsAppProvider and staffWhatsApp link builder. Each authenticated user can choose Ask every time, WhatsApp Business, or regular/default WhatsApp under Management → My Preferences. The choice is stored only on that browser/device under the username. Messages are drafts; staff must review and tap Send inside WhatsApp. The browser cannot confirm app launch, account selection, transmission or delivery.

## Entry points

| Entry point | Behavior |
| --- | --- |
| Admin booking details → message → template | Prepares the message and follows the current device preference. The draft panel remains available with explicit choices. |
| Admin Reviews → Send WhatsApp | Validates the number, calls existing `sendWhatsApp` API to prepare the review token, then follows the device preference while retaining the draft panel. |
| Guest food-order sharing | Existing standard WhatsApp link to kitchen; unchanged. |
| Admin Food Orders → Bill / Combined Bill → WhatsApp | Mints opaque `food_bill_share_tokens` via `createBillShareLink`, then uses the shared staff launcher with `/my-bills?t=` (not `?phone=`). |
| Public booking enquiry | Existing template link to Goko; unchanged. |
| Floating button, footer, booking gate popup, FAQs, directions | Existing public contact links; unchanged. |

Android staff links target `com.whatsapp.w4b` for Business and `com.whatsapp` for regular WhatsApp. Ask every time opens the prepared panel without launching. A saved app is attempted in a separate context so the current PWA and its recovery panel stay available. The panel always exposes both package-specific links on Android; non-Android devices use regular/default `wa.me`. If a package is missing or cannot handle the intent, the same-origin fallback restores the valid current-user draft and identifies the unavailable app. Its one-time marker is removed without dropping other URL state; the prior Business marker remains accepted during compatibility. A stale marker without a valid draft is removed silently, and fallback URLs never include guest content. If Business is installed but the phone number is not registered, Business owns that native warning. Automatic attempts are best-effort because browsers may block external apps after asynchronous preparation; the visible explicit links are the recovery path.

Only one prepared draft is retained per tab, owned by the logged-in username, for at most 30 minutes. It contains number/message, section and creation time, never credentials. A new draft replaces it. Dismissal/logout removes it; invalid, expired or different-owner stored drafts are discarded. Reload restores the draft after login. If session storage is blocked, the panel keeps the message in memory and Business launch uses a new tab so recovery controls remain available. Guest content is never put in the browser fallback URL. Clipboard failure leaves selectable text.

Booking and review numbers use the existing shared formatter: unprefixed 10-digit local numbers default to India; explicit `+`/`00` international numbers preserve their country code. Malformed numbers are rejected before preparing a review request, with equivalent server validation.

## Review counter compatibility

The existing API name `sendWhatsApp`, response fields and database fields are retained. `whatsappSentCount` counts preparation attempts, including historical attempts; the UI labels these Prepared/Preparation Attempts. Opening, retrying or copying the prepared draft does not call the API or increment the counter. Preparing a new request does. These values are not delivery receipts. Existing RBAC and compatibility aliases remain unchanged.

## Verification and references

Automated checks cover both Android packages, preference isolation/failure, link encoding/fallback, fallback-marker cleanup and URL-state preservation, international numbers, invalid input, draft ownership/expiry, preparation failures, and Booking/Reviews/Food Bill routing. Real-device release verification requires installed-PWA and Chrome tests with neither app, either app, both apps, and a preferred app removed after selection. Check iPhone/desktop fallback separately. Do not infer native launch success from automated browser mocks.

- [Chrome Android intents](https://developer.chrome.com/docs/android/intents): package targeting, user gestures and fallback URLs.
- [Official WhatsApp Business listing](https://play.google.com/store/apps/details?id=com.whatsapp.w4b): Android package identity.
