# WhatsApp messaging

Staff messaging uses the shared StaffWhatsAppProvider and staffWhatsApp link builder. Messages are drafts; staff must review and tap Send inside WhatsApp. The browser cannot confirm app launch, account selection, transmission or delivery.

## Entry points

| Entry point | Behavior |
| --- | --- |
| Admin booking details → message → template | Prepares the message and directly attempts WhatsApp Business on Android from the template tap. Retains recovery controls. |
| Admin Reviews → Send WhatsApp | Validates the number, calls existing `sendWhatsApp` API to prepare the review token, then shows Open WhatsApp Business. The explicit second tap preserves browser user activation. |
| Guest food-order sharing | Existing standard WhatsApp link to kitchen; unchanged. |
| Admin Food Orders → Bill / Combined Bill → WhatsApp | Mints opaque `food_bill_share_tokens` via `createBillShareLink`, opens `wa.me` with `/my-bills?t=` (not `?phone=`). Standard personal WhatsApp link (not StaffWhatsAppProvider / Business intent). |
| Public booking enquiry | Existing template link to Goko; unchanged. |
| Floating button, footer, booking gate popup, FAQs, directions | Existing public contact links; unchanged. |

Android staff links target `com.whatsapp.w4b` using an intent with the `whatsapp` scheme. If Business is missing or cannot handle the intent, the same-origin fallback returns to the relevant admin section, restores the valid current-user draft and shows that Business is not installed or available. The one-time fallback marker is removed without dropping other URL state. A stale marker without a valid draft is removed silently. The fallback never includes guest content or automatically opens personal WhatsApp. Retry Business, Copy message, Copy number and explicit Open regular/default WhatsApp controls remain available. If Business is installed but the phone number is not registered, Business owns that native warning. iPhone and desktop show copy/default-app choices because forced Business selection has not been established there. Android browsers and embedded browsers still require device validation.

Only one prepared draft is retained per tab, owned by the logged-in username, for at most 30 minutes. It contains number/message, section and creation time, never credentials. A new draft replaces it. Dismissal/logout removes it; invalid, expired or different-owner stored drafts are discarded. Reload restores the draft after login. If session storage is blocked, the panel keeps the message in memory and Business launch uses a new tab so recovery controls remain available. Guest content is never put in the browser fallback URL. Clipboard failure leaves selectable text.

Booking and review numbers use the existing shared formatter: unprefixed 10-digit local numbers default to India; explicit `+`/`00` international numbers preserve their country code. Malformed numbers are rejected before preparing a review request, with equivalent server validation.

## Review counter compatibility

The existing API name `sendWhatsApp`, response fields and database fields are retained. `whatsappSentCount` counts preparation attempts, including historical attempts; the UI labels these Prepared/Preparation Attempts. Opening, retrying or copying the prepared draft does not call the API or increment the counter. Preparing a new request does. These values are not delivery receipts. Existing RBAC and compatibility aliases remain unchanged.

## Verification and references

Automated checks cover link encoding/package/fallback, fallback-marker cleanup and URL-state preservation, international numbers, invalid input, draft ownership/expiry, preparation failures and retry behavior. Real-device release verification requires Android with both apps: Chrome and installed Goko, booking/review workflows, Business installed/unavailable, recipient/message preservation, return/reload, blocked storage, and explicit default-app choice. Check iPhone/desktop fallback separately. Do not infer native launch success from automated browser mocks.

- [Chrome Android intents](https://developer.chrome.com/docs/android/intents): package targeting, user gestures and fallback URLs.
- [Official WhatsApp Business listing](https://play.google.com/store/apps/details?id=com.whatsapp.w4b): Android package identity.
