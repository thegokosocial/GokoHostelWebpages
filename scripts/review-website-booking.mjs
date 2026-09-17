/** Read-only adversarial review. Failing probes are findings, not production changes.
 * Run: node scripts/review-website-booking.mjs
 * Real validation helpers are loaded from TypeScript source. Payment probes run
 * only the existing specification model, never Razorpay or a database.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHmac, timingSafeEqual } from 'node:crypto';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function loadHelper(path, replacements = {}) {
  const output = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output)(
    (name) => Object.hasOwn(replacements, name) ? replacements[name] : require(name), module, module.exports,
  );
  return module.exports;
}
const { site } = loadHelper('src/lib/site.ts');
const { bookingDestination } = loadHelper('src/lib/bookingDestination.ts', { '@/lib/site': { site } });
const { readWebsiteBookingSettings, gatewayConfiguration, websiteBookingSettingsSchema } = loadHelper('src/lib/websiteBookingSettings.ts');
let passed = 0;
const findings = [];
function probe(name, run) {
  try { run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { findings.push(name); console.error(`FINDING ${name}: ${error.message}`); }
}

probe('All ASCII control insertions in an HTTPS URL are rejected', () => {
  for (let code = 0; code < 32; code++) {
    assert.throws(() => bookingDestination(`https://provider.example/${String.fromCharCode(code)}book`));
  }
  assert.throws(() => bookingDestination('https://provider.example/\x7fbook'));
});
probe('Protocol and embedded-credential attack combinations are rejected', () => {
  for (const scheme of ['http:', 'javascript:', 'data:', 'file:', 'ftp:', 'blob:', 'vbscript:']) {
    for (const suffix of ['//provider.example/book', '/book', 'alert(1)']) assert.throws(() => bookingDestination(scheme + suffix));
  }
  for (const authority of ['user@provider.example', 'user:pass@provider.example', 'user%40mail.example:pass@provider.example']) {
    assert.throws(() => bookingDestination(`https://${authority}/book`));
  }
});
probe('Trailing-dot Goko host cannot bypass the native-path restriction', () => {
  assert.throws(() => bookingDestination('https://www.gokohostel.com./admin'));
});
probe('Trailing-dot API base cannot be used as a guest engine', () => {
  assert.throws(() => bookingDestination('https://live.aiosell.com./', 'https://live.aiosell.com'));
});
probe('Corrupt saved policy is surfaced instead of silently replaced', () => {
  assert.throws(() => readWebsiteBookingSettings('{"advancePercent":101,"policyText":"saved custom policy"}'));
});
probe('Gateway configuration never enables checkout for any credential combination', () => {
  for (const environment of ['test', 'live']) {
    for (let mask = 0; mask < 8; mask++) {
      const prefix = environment === 'live' ? 'RAZORPAY_LIVE' : 'RAZORPAY_TEST';
      const env = {
        [`${prefix}_KEY_ID`]: mask & 1 ? `rzp_${environment}_review` : undefined,
        [`${prefix}_KEY_SECRET`]: mask & 2 ? 'DUMMY_PRIVATE_KEY' : undefined,
        [`${prefix}_WEBHOOK_SECRET`]: mask & 4 ? 'DUMMY_PRIVATE_HOOK' : undefined,
      };
      const result = gatewayConfiguration(environment, env);
      assert.equal(result.nativeCheckoutReady, false);
      assert.ok(!JSON.stringify(result).includes('DUMMY_PRIVATE'));
      assert.equal(result.credentialsConfigured, mask === 7);
    }
  }
});
probe('Every percentage boundary rejects non-finite, fractional and out-of-range values', () => {
  for (const field of ['advancePercent', 'cancellationRefundPercent']) {
    for (const value of [-1, 101, 0.1, NaN, Infinity, -Infinity, '50', null]) {
      assert.equal(websiteBookingSettingsSchema.safeParse({ [field]: value }).success, false);
    }
    for (let value = 0; value <= 100; value++) assert.equal(websiteBookingSettingsSchema.safeParse({ [field]: value }).success, true);
  }
});

// Execute exactly the existing model in memory, then exercise missing sequences.
// This is not an alternative implementation and never invokes the app's APIs.
const source = readFileSync('scripts/mock-website-booking-plan.mjs', 'utf8')
  .replace(/^import .*;\r?\n/gm, '');
const quietConsole = { log() {}, error: console.error };
const modelProcess = { exitCode: 0 };
const { fixture } = new Function('assert', 'createHmac', 'timingSafeEqual', 'console', 'process', `${source}\nreturn { fixture };`)(assert, createHmac, timingSafeEqual, quietConsole, modelProcess);
assert.equal(modelProcess.exitCode, 0, 'The existing base model must pass before extra probes');

probe('MODEL: third distinct full capture increases the excess refund claim', () => {
  const [model, book] = fixture({ choice: 'full' });
  for (const id of ['capture-1', 'capture-2', 'capture-3']) model.provider(book, 'captured', { id });
  const claimed = [...book.refunds.values()].reduce((sum, refund) => sum + refund.amountPaise, 0);
  assert.equal(claimed, (book.paid - book.total) * 100);
});
probe('MODEL: every distinct unfulfillable capture is fully reserved for refund', () => {
  const [model, book] = fixture();
  model.now = 16 * 60_000;
  model.expire();
  model.prepare('other-guest');
  for (const id of ['late-1', 'late-2']) model.provider(book, 'captured', { id });
  const claimed = [...book.refunds.values()].reduce((sum, refund) => sum + refund.amountPaise, 0);
  assert.equal(claimed, book.paid * 100);
});
probe('MODEL: failed refund retry cannot overbook funds reserved by another operation', () => {
  const [model, book] = fixture();
  model.provider(book, 'captured');
  model.cancel(book);
  model.refundResult(book, 'cancellation', 'failed');
  model.refund(book, 'replacement', book.paid * 100);
  assert.throws(() => model.retryFailedRefund(book, 'cancellation'));
});

probe('MODEL: repeated captures preserve refund caps for each payment, not only the booking total', () => {
  for (const outcome of ['fulfilled', 'guest-cancelled', 'unfulfilled']) {
    const [model, book] = fixture({ choice: 'full' });
    if (outcome === 'guest-cancelled') model.cancel(book);
    if (outcome === 'unfulfilled') { model.now = 16 * 60_000; model.expire(); model.prepare('competitor'); }
    for (let i = 0; i < 20; i++) {
      const id = `capture-${i}`;
      model.provider(book, 'captured', { id });
      model.provider(book, 'captured', { id, event: `duplicate-${i}` });
      for (const payment of book.payments.values()) {
        const reserved = [...book.refunds.values()].filter((item) => item.paymentId === payment.id && item.state !== 'failed').reduce((sum, item) => sum + item.amountPaise, 0);
        assert.ok(reserved <= payment.amountPaise, 'per-payment over-refund');
      }
      const total = [...book.refunds.values()].filter((item) => item.state !== 'failed').reduce((sum, item) => sum + item.amountPaise, 0);
      assert.equal(total, (book.paid - (outcome === 'fulfilled' ? book.total : 0)) * 100);
    }
  }
});
probe('MODEL: cancellation after multiple captures refunds the remaining balance only', () => {
  const [model, book] = fixture({ choice: 'full' });
  for (const id of ['one', 'two', 'three']) model.provider(book, 'captured', { id });
  model.cancel(book);
  const count = book.refunds.size;
  model.cancel(book);
  assert.equal(book.refunds.size, count);
  assert.equal([...book.refunds.values()].reduce((sum, item) => sum + item.amountPaise, 0), book.paid * 100);
});
probe('MODEL: processed refunds are immutable and replayed payloads cannot change amount', () => {
  const [model, book] = fixture(); model.provider(book, 'captured'); model.cancel(book);
  model.refundResult(book, 'cancellation', 'processed');
  model.refundResult(book, 'cancellation', 'failed');
  assert.equal(book.refunded, 1000);
  assert.throws(() => model.refund(book, 'cancellation', 50000));
});
probe('MODEL: ambiguous hold window is bounded relative to creation, including later checkouts', () => {
  const [model, first] = fixture(); model.cancel(first);
  model.now = 60 * 60_000;
  const second = model.prepare('later-checkout');
  model.ambiguous(second);
  assert.equal(second.expires, second.created + 30 * 60_000);
  model.expire(); assert.equal(second.status, 'hold');
  model.now = second.created + 30 * 60_000; model.expire(); assert.equal(second.reason, 'hold_expired');
});
probe('MODEL: a later unknown browser response cannot regress verified capture', () => {
  const [model, book] = fixture(); model.provider(book, 'captured'); model.ambiguous(book);
  assert.equal(book.paymentState, 'partial'); assert.equal(book.status, 'received');
});
probe('MODEL: malformed capture/refund values cannot alter collected or refunded totals', () => {
  const [model, book] = fixture();
  for (const amountPaise of [-100, 0, NaN, Infinity, 100.5]) assert.equal(model.provider(book, 'captured', { amountPaise }), 'rejected');
  assert.equal(book.paid, 0);
  model.provider(book, 'captured');
  for (const amount of [-100, NaN, Infinity, 1.5]) assert.throws(() => model.refund(book, 'invalid', amount));
  assert.equal(book.refunds.size, 0);
});
probe('MODEL: odd-paise captures are refunded exactly, without rupee floating-point loss', () => {
  for (const amountPaise of [1, 29, 57, 101, 99999, 100001]) {
    const [model, book] = fixture(); model.provider(book, 'captured', { amountPaise });
    model.cancel(book);
    assert.equal([...book.refunds.values()].reduce((sum, item) => sum + item.amountPaise, 0), amountPaise);
  }
});
probe('MODEL: unresolved, authorized or mismatched payment prevents another desk collection', () => {
  for (const status of ['pending', 'authorized', 'review', 'captured_unfulfilled']) {
    const [model, book] = fixture(); book.paymentState = status;
    assert.throws(() => model.deskCollect(book, book.total));
    assert.equal(book.cash, 0);
  }
});
probe('MODEL: an operational refund decision never silently reopens when inventory later becomes free', () => {
  const [model, book] = fixture(); model.now = 16 * 60_000; model.expire();
  const competitor = model.prepare('competitor');
  model.provider(book, 'captured', { id: 'unfulfilled-one' });
  model.refundResult(book, 'operational', 'processed');
  model.cancel(competitor);
  model.provider(book, 'captured', { id: 'unfulfilled-two' });
  assert.equal(book.paymentState, 'captured_unfulfilled'); assert.equal(book.status, 'cancelled');
  assert.equal(model.inventory.size, 0);
  assert.equal([...book.refunds.values()].reduce((sum, item) => sum + item.amountPaise, 0), model.capturedPaise(book));
});

console.log(`\nAdversarial review: ${passed} groups passed; ${findings.length} findings.`);
console.log('Scope: validation source + specification model only. No live services, credentials, bookings or money accessed.');
process.exitCode = findings.length ? 1 : 0;
