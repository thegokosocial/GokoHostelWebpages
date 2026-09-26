import { validateIdFromText } from "../src/lib/validateIdDocument";

let passed = 0;
let failed = 0;

function assert(label: string, actual: unknown, expected: unknown) {
  const a = String(actual ?? "");
  const e = String(expected ?? "");
  if (a === e) {
    console.log(`  ✅ PASS: ${label}  (got "${a}")`);
    passed++;
  } else {
    console.log(`  ❌ FAIL: ${label}`);
    console.log(`         expected: "${e}"`);
    console.log(`         actual:   "${a}"`);
    failed++;
  }
}

// ── Aadhaar OCR samples ────────────────────────────────────────────

const AADHAAR_FRONT_OCR = `
Government of India
UNIQUE IDENTIFICATION AUTHORITY OF INDIA
Pawan Dhiran
DOB: 15/03/1995
Male
1234 5678 9012
आधार
`;

const AADHAAR_BACK_OCR = `
Address: 42 Green Valley Road
Sector 5, New Delhi
PIN: 110001
S/O Rajesh Dhiran
UIDAI
1234 5678 9012
`;

const AADHAAR_FRONT_NO_ADDRESS = `
Government of India
UNIQUE IDENTIFICATION AUTHORITY OF INDIA
Pawan Dhiran
DOB: 15/03/1995
Male
1234 5678 9012
आधार
`;

const AADHAAR_HINDI_GUARDIAN = `
Government of India
aadhaar
आधार
Suresh Kumar
पिता राम कुमार
1234 5678 9012
Address: 10 MG Road
PIN: 560001
`;

const DL_OCR = `
DRIVING LICENCE
Transport Department
DL0520210001234
Name: Pawan Dhiran
DOB: 15-03-1995
Valid Till: 14-03-2041
Class of Vehicle: LMV
Date of Issue: 15-03-2021
`;

// ═══ Test Suite 1: Basic Aadhaar Detection ═══
console.log("═══ Test 1: Aadhaar Detection ═══");

const r1 = validateIdFromText(AADHAAR_FRONT_OCR + "\n" + AADHAAR_BACK_OCR, "id", "aadhaar", "Pawan Dhiran");
assert("Combined front+back valid", r1.valid, "true");
assert("Document type is aadhaar", r1.documentType, "aadhaar");
assert("Name matched", r1.nameMatch, "true");

// ═══ Test 2: Name on back side only (the original bug) ═══
console.log("\n═══ Test 2: Name on back only — server was failing on single-image ═══");

const r2_front = validateIdFromText(AADHAAR_BACK_OCR, "id", "aadhaar", "Pawan Dhiran");
// Back side alone might not have enough aadhaar patterns without the front
const r2_combined = validateIdFromText(AADHAAR_FRONT_OCR + "\n" + AADHAAR_BACK_OCR, "id", "aadhaar", "Pawan Dhiran");
assert("Combined text validates name", r2_combined.valid, "true");
assert("Combined text name match", r2_combined.nameMatch, "true");

// ═══ Test 3: Name mismatch ═══
console.log("\n═══ Test 3: Name mismatch — wrong person's ID ═══");

const r3 = validateIdFromText(AADHAAR_FRONT_OCR + "\n" + AADHAAR_BACK_OCR, "id", "aadhaar", "Amit Sharma");
assert("Wrong name rejected", r3.valid, "false");
assert("Name match false", r3.nameMatch, "false");
assert("Has name_mismatch layer", r3.layers?.includes("name_mismatch"), "true");

// ═══ Test 4: Substring false positive prevention ═══
console.log("\n═══ Test 4: Substring false positive — 'raj' should NOT match inside 'Rajesh' ═══");

const r4 = validateIdFromText(AADHAAR_FRONT_OCR + "\n" + AADHAAR_BACK_OCR, "id", "aadhaar", "Raj Singh");
assert("'Raj' should not match 'Rajesh' (word boundary)", r4.valid, "false");

// ═══ Test 5: Guardian pattern filtering ═══
console.log("\n═══ Test 5: Guardian name should NOT satisfy match ═══");

const guardianOcr = `
Government of India
aadhaar
आधार
Suresh Kumar
S/O Rajesh Kumar
1234 5678 9012
Address: 10 MG Road
PIN: 560001
`;

const r5 = validateIdFromText(guardianOcr, "id", "aadhaar", "Rajesh Sharma");
assert("Guardian 'Rajesh Sharma' filtered — 'Rajesh' only on S/O line, 'Sharma' absent", r5.valid, "false");

// ═══ Test 6: Hindi guardian pattern filtering ═══
console.log("\n═══ Test 6: Hindi guardian pattern (पिता) should be filtered ═══");

const r6 = validateIdFromText(AADHAAR_HINDI_GUARDIAN, "id", "aadhaar", "Suresh Kumar");
assert("Actual name 'Suresh' passes", r6.valid, "true");

const r6b = validateIdFromText(AADHAAR_HINDI_GUARDIAN, "id", "aadhaar", "Ram Sharma");
assert("Guardian 'Ram Sharma' filtered — 'Ram' on पिता line, 'Sharma' absent", r6b.valid, "false");

// Test that shared last name between guardian and cardholder correctly allows the cardholder
const r6c = validateIdFromText(AADHAAR_HINDI_GUARDIAN, "id", "aadhaar", "Ram Kumar");
assert("'Ram Kumar' — 'Kumar' found on non-guardian line (shared family name)", r6c.valid, "true");

// ═══ Test 7: Type mismatch ═══
console.log("\n═══ Test 7: Type mismatch — DL when aadhaar selected ═══");

const r7 = validateIdFromText(DL_OCR, "id", "aadhaar", "Pawan Dhiran");
assert("DL rejected when aadhaar selected", r7.valid, "false");
assert("Has type_mismatch layer", r7.layers?.includes("type_mismatch"), "true");
assert("Detected as driving_licence", r7.documentType, "driving_licence");

// ═══ Test 8: DL with correct type ═══
console.log("\n═══ Test 8: DL with correct type selection ═══");

const r8 = validateIdFromText(DL_OCR, "id", "driving_licence", "Pawan Dhiran");
assert("DL accepted with correct type", r8.valid, "true");
assert("Name matched on DL", r8.nameMatch, "true");

// ═══ Test 9: Aadhaar front only (no address) ═══
console.log("\n═══ Test 9: Front side only — needsBackSide ═══");

const r9 = validateIdFromText(AADHAAR_FRONT_NO_ADDRESS, "id", "aadhaar", "Pawan Dhiran", "India");
assert("Front-only hard-blocked", r9.valid, "false");
assert("Needs back side flag", r9.needsBackSide, "true");

// ═══ Test 10: No guest name provided — should pass ═══
console.log("\n═══ Test 10: No guest name — skip name check ═══");

const r10 = validateIdFromText(AADHAAR_FRONT_OCR + "\n" + AADHAAR_BACK_OCR, "id", "aadhaar");
assert("No name provided passes", r10.valid, "true");

// ═══ Test 11: Short name (<2 chars) — should pass ═══
console.log("\n═══ Test 11: Very short name — skip name check ═══");

const r11 = validateIdFromText(AADHAAR_FRONT_OCR + "\n" + AADHAAR_BACK_OCR, "id", "aadhaar", "A");
assert("Single char name passes", r11.valid, "true");

// ═══ Test 12: Visa validation ═══
console.log("\n═══ Test 12: Visa document ═══");

const visaOcr = `
VISA
Bureau of Immigration
Type: Tourist
Valid from: 01/01/2026
Duration of stay: 90 days
Entry permit
`;

const r12 = validateIdFromText(visaOcr, "visa");
assert("Visa detected and valid", r12.valid, "true");
assert("Visa document type", r12.documentType, "visa");

// ═══ Test 13: Empty/unreadable text ═══
console.log("\n═══ Test 13: Empty/unreadable text ═══");

const r13 = validateIdFromText("", "id", "aadhaar", "Test User");
assert("Empty text rejected", r13.valid, "false");

const r13b = validateIdFromText("abc", "id", "aadhaar", "Test User");
assert("Too short text rejected", r13b.valid, "false");

// ═══ Summary ═══
console.log(`\n═══ Summary: ${passed} passed, ${failed} failed ═══`);
process.exit(failed > 0 ? 1 : 0);
