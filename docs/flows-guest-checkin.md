# Guest self check-in

**Git-safe.** Admin reviews records at `/admin` → Records. Password: [secrets-and-access.md](secrets-and-access.md).

Pages: `/self-checkin` (static shell). APIs: `/api/checkin/lookup`, `/api/validate-id`, `/api/checkin`.

---

## Flow

```mermaid
stateDiagram-v2
  [*] --> phone
  phone --> form: lookup done
  form --> submitting: Complete check-in
  submitting --> success
  success --> form: Submit another
```

```mermaid
sequenceDiagram
  participant G as Guest phone
  participant L as GET /api/checkin/lookup
  participant V as POST /api/validate-id
  participant C as POST /api/checkin
  participant D as Drive
  participant VIS as Vision
  participant DB as D1
  G->>L: phone digits
  L-->>G: prior name / Drive links or empty
  G->>V: ID images (if validation on)
  V->>VIS: OCR
  VIS-->>G: valid / reason
  G->>C: multipart form
  C->>VIS: re-check first file unless reuse
  C->>D: monthly folder upload
  C->>DB: insert checkins
  C-->>G: success
```

1. Phone → latest checkin by contact. Hit: prefill, show clickable previews for stored `idCardLink` / `visaLink`, and reuse those links unless replacement files are uploaded. A failed preview is retried once before showing an explicit link to open the stored document. Miss: blank form.
2. Fields: booking platform (required) + optional booking id (auto `GOKO{date}{rand}` for Offline/Walk-in when applicable), arrival, name, persons, days, nationality, coming from, emergency, ID type + photos. Indian guests can choose Aadhaar, Driving Licence, or Passport. A non-Indian nationality automatically selects Passport, shows no other ID type, and requires visa page photo(s); APIs reject non-passport or missing-visa foreign submissions. Foreign guests also provide Form C extras. Admin Records add and past-record forms prompt for and upload the required visa; edit and ID-upload flows follow the same passport-only rule.
3. Optional Vision (`settings.image_validation`): labels → OCR → Aadhaar/DL/passport scoring → name match → SafeSearch. Name matching accepts normal punctuation/case variation and initials such as `Pawan D` for `Pawan Dhiran`, while ignoring guardian lines. Type mismatch: changing dropdown to `detectedIdType` accepts. Vision down: submit still allowed (`idServerError`).
4. Server: required fields → validate a supplied DOB as a real, non-future date → ignore a repeat of an active guest visit on the same arrival date (returning the existing check-in id without Vision/Drive work) → Vision again unless `prevIdCardLink` → Drive `{Guest}_{id_1}_{timestamp}` under month folder → `formCData` JSON for foreigners → insert `status: active`. Visit matching uses normalized phone/name and arrival date; stay length and booking ID changes do not create another active check-in or another Beds assignment row.
5. DOB is stored separately from `dobFromId`. Age checks use the supplied DOB first, then a valid DOB extracted from the ID; if neither exists, no age warning is shown. OCR accepts only DOB-labelled/MRZ dates and rejects invalid or future dates, so licence issue/expiry dates cannot become DOBs. `verified`: `yes` (passed or reused ID), `pending` (off / error), `spoof_warning`, `no` (admin reject).

Pi offline: Drive/Vision may fail; check-in should still persist locally (`isOfflineMode`).

Staff then assign a bed (Beds tab) and/or link a booking (Bookings calendar). Check-in row is **not** an automatic bed assignment.
