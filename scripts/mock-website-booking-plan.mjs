/**
 * Executable specification mock for docs/plan-first-party-booking-and-payments.md.
 * Run: node scripts/mock-website-booking-plan.mjs
 * No app imports, network requests, D1 access, charges, or deployment changes.
 * These checks validate model invariants, not the future implementation.
 */
import assert from 'node:assert/strict';
import { createHmac, timingSafeEqual } from 'node:crypto';

const SITE = 'https://www.gokohostel.com';
const MINUTE = 60_000;
const NIGHTS = ['2026-10-01', '2026-10-02'];
const IDS = ['mixed-single-1', 'mixed-single-2', 'mixed-double-1'];
const CAPACITY = new Map([[IDS[0], 1], [IDS[1], 1], [IDS[2], 2]]);

function destination(value) {
  if (!value?.trim()) return { mode: 'empty', url: null };
  const raw = value.trim();
  if (raw.startsWith('//')) throw new Error('unsafe URL');
  const url = new URL(raw, SITE);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('unsafe URL');
  if (url.origin === SITE) {
    if (url.pathname !== '/book' || url.search || url.hash) throw new Error('unsupported internal URL');
    return { mode: 'native', url: '/book' };
  }
  if (raw.startsWith('/')) throw new Error('unsupported internal URL');
  return { mode: 'external', url: url.href };
}

function quote(rates, percent = 50, tax = 5) {
  assert.ok(rates.length && rates.every(Number.isFinite), 'missing nightly rates');
  assert.ok(rates.every((rate) => rate >= 0), 'negative rate');
  assert.ok(percent >= 0 && percent <= 100, 'invalid advance');
  const gross = rates.reduce((sum, rate) => sum + rate, 0);
  const total = gross + Math.round(gross * tax / 100);
  const advance = Math.min(total, Math.ceil(total * percent / 100));
  return { total, advance, orderPaise: advance * 100 };
}

function verifySignature(storedOrder, paymentId, signature, secret) {
  const expected = createHmac('sha256', secret).update(`${storedOrder}|${paymentId}`).digest();
  const supplied = Buffer.from(signature, 'hex');
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

const access = (role, permissions, action) => role === 'admin' ||
  (action !== 'settings' && permissions[{
    view: 'canViewBookingPayments', reconcile: 'canReconcileBookingPayments',
    refund: 'canRefundBookingPayments',
  }[action]] === true);

class Mock {
  constructor() {
    this.now = 0;
    this.mode = 'native';
    this.gateway = true;
    this.normalProperty = true;
    this.autoPush = true;
    this.production = true;
    this.books = new Map();
    this.keys = new Map();
    this.inventory = new Map();
    this.events = new Set();
    this.paymentOwners = new Map();
    this.receipts = new Map();
  }
  slots(book) { return book.units.flatMap((unit) => book.nights.map((night) => `${unit}/${night}`)); }
  available(book) { return this.slots(book).every((slot) => !this.inventory.has(slot) || this.inventory.get(slot) === book.id); }
  reserve(book) {
    if (!this.available(book)) throw new Error('inventory conflict');
    this.slots(book).forEach((slot) => this.inventory.set(slot, book.id));
  }
  release(book) { this.slots(book).forEach((slot) => { if (this.inventory.get(slot) === book.id) this.inventory.delete(slot); }); }
  capturedPaise(book) { return [...book.payments.values()].reduce((sum, item) => sum + item.amountPaise, 0); }
  prepare(key, options = {}) {
    const input = { units: [IDS[0]], nights: NIGHTS, guests: 1, percent: 50, total: 2000,
      choice: 'advance', env: 'live', policy: { deadlineHours: 48, refundPercent: 100 }, ...options };
    const fingerprint = JSON.stringify(input);
    if (this.keys.has(key)) {
      const old = this.keys.get(key);
      if (old.fingerprint !== fingerprint) throw new Error('idempotency conflict');
      return this.books.get(old.id);
    }
    if (this.mode !== 'native') throw new Error('native booking disabled');
    if (this.production && input.env !== 'live') throw new Error('test checkout forbidden');
    if (!input.nights.length || !input.units.length || new Set(input.units).size !== input.units.length ||
      !input.units.every((unit) => CAPACITY.has(unit))) throw new Error('invalid selection');
    const capacity = input.units.reduce((sum, unit) => sum + CAPACITY.get(unit), 0);
    if (input.guests < 1 || input.guests > 4 || input.guests > capacity) throw new Error('invalid guests');
    if (input.percent < 0 || input.percent > 100) throw new Error('invalid advance');
    if (input.choice === 'property' && this.gateway && !this.normalProperty) throw new Error('normal property payment disabled');
    const id = `GOKO-MOCK-${this.books.size + 1}`;
    const book = { ...structuredClone(input), id, order: `order-${id}`, status: 'hold',
      created: this.now, expires: this.now + 15 * MINUTE, reason: null, paid: 0, refunded: 0, cash: 0,
      payments: new Map(), refunds: new Map(), paymentState: 'pending', sync: 'none', token: `private-${id}` };
    book.expectedPaise = (input.choice === 'full' ? input.total : Math.ceil(input.total * input.percent / 100)) * 100;
    this.reserve(book); // Atomic in this in-memory model; D1 implementation needs separate integration tests.
    this.books.set(id, book);
    this.keys.set(key, { fingerprint, id });
    if (!this.gateway || input.choice === 'property' || book.expectedPaise === 0) this.confirm(book);
    return book;
  }
  confirm(book) {
    if (book.reason === 'guest_cancelled') return;
    if (book.paymentState === 'captured_unfulfilled') {
      this.refundToTarget(book, 'operational', this.capturedPaise(book)); return;
    }
    try { this.reserve(book); } catch { book.paymentState = 'captured_unfulfilled'; this.refundToTarget(book, 'operational', this.capturedPaise(book)); return; }
    if (!['checked_in', 'checked_out'].includes(book.status)) book.status = 'received';
    book.reason = null;
    const collected = book.paid + book.cash;
    book.paymentState = collected === 0 ? 'pay_at_property' : collected < book.total ? 'partial' : 'paid';
    book.sync = this.autoPush ? 'pending' : 'manual_required';
  }
  ambiguous(book) {
    if (book.payments.size || book.status !== 'hold') return;
    book.paymentState = 'unknown'; book.expires = book.created + 30 * MINUTE;
  }
  expire() {
    for (const book of this.books.values()) {
      if (book.status === 'hold' && this.now >= book.expires) {
        book.status = 'cancelled'; book.reason = 'hold_expired'; this.release(book);
      }
    }
  }
  provider(book, state, options = {}) {
    const payment = { id: `pay-${book.id}`, order: book.order, env: book.env,
      currency: 'INR', amountPaise: book.expectedPaise, trusted: true, ...options };
    if (!payment.trusted || payment.order !== book.order || payment.env !== book.env || payment.currency !== 'INR') return 'rejected';
    if (!Number.isSafeInteger(payment.amountPaise) || payment.amountPaise <= 0) return 'rejected';
    if (payment.event && this.events.has(`${payment.env}/${payment.event}`)) return 'duplicate-event';
    if (state !== 'captured') {
      if (book.payments.size === 0) book.paymentState = state;
      if (payment.event) this.events.add(`${payment.env}/${payment.event}`);
      return state;
    }
    if (this.paymentOwners.has(payment.id)) {
      assert.equal(this.paymentOwners.get(payment.id), book.id, 'payment belongs to another booking');
      return 'duplicate-payment';
    }
    book.payments.set(payment.id, payment);
    this.paymentOwners.set(payment.id, book.id);
    book.paid = this.capturedPaise(book) / 100;
    if (book.reason === 'guest_cancelled') this.refund(book, `late-cancel-${payment.id}`, payment.amountPaise, payment.id);
    else if (payment.amountPaise !== book.expectedPaise) book.paymentState = 'review';
    else this.confirm(book);
    const excessPaise = this.capturedPaise(book) + book.cash * 100 - book.total * 100;
    if (book.reason !== 'guest_cancelled' && book.paymentState !== 'captured_unfulfilled' && excessPaise > 0) this.refundToTarget(book, 'excess', excessPaise);
    if (payment.event) this.events.add(`${payment.env}/${payment.event}`);
    return 'captured';
  }
  refundCapacity(book, paymentId) {
    const payment = book.payments.get(paymentId); assert.ok(payment, 'refund must own a captured payment');
    const claimed = [...book.refunds.values()].filter((item) => item.paymentId === paymentId && item.state !== 'failed').reduce((sum, item) => sum + item.amountPaise, 0);
    return payment.amountPaise - claimed;
  }
  refund(book, key, amountPaise, paymentId) {
    if (book.refunds.has(key)) {
      const old = book.refunds.get(key);
      assert.equal(old.amountPaise, amountPaise, 'refund idempotency payload conflict');
      if (paymentId) assert.equal(old.paymentId, paymentId, 'refund payment ownership conflict');
      return old;
    }
    if (amountPaise === 0) return null;
    assert.ok(Number.isSafeInteger(amountPaise) && amountPaise > 0, 'invalid refund amount');
    paymentId ||= [...book.payments.keys()].find((id) => this.refundCapacity(book, id) >= amountPaise);
    assert.ok(paymentId && this.refundCapacity(book, paymentId) >= amountPaise, 'refund exceeds remaining capture');
    const refund = { paymentId, amountPaise, state: 'pending' }; book.refunds.set(key, refund); return refund;
  }
  refundToTarget(book, kind, targetPaise) {
    const claimed = [...book.refunds.values()].filter((item) => item.state !== 'failed').reduce((sum, item) => sum + item.amountPaise, 0);
    let remaining = Math.max(0, targetPaise - claimed);
    assert.ok(Number.isSafeInteger(targetPaise) && targetPaise >= 0 && targetPaise <= this.capturedPaise(book), 'invalid refund target');
    for (const paymentId of book.payments.keys()) {
      const amount = Math.min(remaining, this.refundCapacity(book, paymentId));
      if (!amount) continue;
      const key = book.refunds.has(kind) ? `${kind}-${paymentId}-${book.refunds.size}` : kind;
      this.refund(book, key, amount, paymentId); remaining -= amount;
    }
    assert.equal(remaining, 0, 'refund target must be fully reserved');
  }
  refundResult(book, key, state) {
    const refund = book.refunds.get(key); assert.ok(refund, 'missing refund');
    if (refund.state === 'processed') return;
    assert.ok(['pending', 'unknown', 'failed', 'processed'].includes(state), 'invalid refund state');
    if (refund.state === 'failed' && state !== 'failed') assert.ok(this.refundCapacity(book, refund.paymentId) >= refund.amountPaise, 'refund exceeds remaining capture');
    refund.state = state;
    book.refunded = [...book.refunds.values()].filter((item) => item.state === 'processed').reduce((sum, item) => sum + item.amountPaise, 0) / 100;
  }
  retryFailedRefund(book, key) {
    const refund = book.refunds.get(key);
    if (refund?.state !== 'failed') throw new Error('resolve original refund first');
    assert.ok(this.refundCapacity(book, refund.paymentId) >= refund.amountPaise, 'refund exceeds remaining capture');
    refund.state = 'pending'; return refund;
  }
  cancel(book, hoursBeforeArrival = 72) {
    if (book.status === 'checked_in' || book.status === 'checked_out') throw new Error('staff workflow required');
    book.status = 'cancelled'; book.reason = 'guest_cancelled'; this.release(book);
    if (hoursBeforeArrival >= book.policy.deadlineHours) this.refundToTarget(book, 'cancellation', Math.floor(this.capturedPaise(book) * book.policy.refundPercent / 100));
    book.sync = this.autoPush ? 'pending' : 'manual_required';
  }
  settle(id, netPaise, verified = true) {
    if (!verified) throw new Error('unverified settlement');
    if (this.receipts.has(id)) assert.equal(this.receipts.get(id), netPaise, 'settlement conflict');
    else this.receipts.set(id, netPaise);
  }
  deskCollect(book, amountRupees) {
    if (['unknown', 'pending', 'authorized', 'review', 'captured_unfulfilled'].includes(book.paymentState)) throw new Error('reconcile before collecting');
    if (amountRupees !== Math.max(0, book.total - book.paid - book.cash)) throw new Error('wrong balance');
    book.cash += amountRupees;
    book.status = 'checked_in'; book.paymentState = 'paid';
    return book.paid > 0 && book.cash > 0 ? 'split' : 'cash';
  }
}

let passed = 0;
let failed = 0;
function scenario(name, run) {
  try { run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`); }
}
function fixture(options) { const mock = new Mock(); return [mock, mock.prepare('checkout-1', options)]; }

scenario('Blank link has no old StayFlexi fallback', () => assert.deepEqual(destination(''), { mode: 'empty', url: null }));
scenario('Missing configuration has no active checkout', () => assert.equal(destination(null).mode, 'empty'));
scenario('Relative Goko URL activates native mode', () => assert.equal(destination('/book').mode, 'native'));
scenario('Canonical Goko URL activates native mode', () => assert.equal(destination(`${SITE}/book`).mode, 'native'));
scenario('External guest-engine URL activates external mode', () => assert.equal(destination('https://guest-engine.example/book?hotel=1').mode, 'external'));
scenario('Unsafe and unsupported URLs are rejected', () => {
  for (const value of ['javascript:alert(1)', '//guest-engine.example', `${SITE}/admin`, 'http://guest-engine.example', 'https://user:pass@guest-engine.example']) assert.throws(() => destination(value));
});
scenario('Variable nightly rates and tax are priced across the whole stay', () => assert.deepEqual(quote([500, 700, 900]), { total: 2205, advance: 1103, orderPaise: 110300 }));
scenario('Missing nightly rate blocks quoting', () => assert.throws(() => quote([500, undefined])));
scenario('Zero and full advance produce exact amounts', () => { assert.equal(quote([1000], 0).orderPaise, 0); assert.equal(quote([1000], 100).orderPaise, 105000); });
scenario('Invalid advance percentages are rejected', () => { assert.throws(() => quote([1000], -1)); assert.throws(() => quote([1000], 101)); });
scenario('Full payment confirms exactly one provisional booking', () => { const [m, b] = fixture({ choice: 'full' }); m.provider(b, 'captured'); assert.equal(b.paid, 2000); assert.equal(b.status, 'received'); assert.equal(m.books.size, 1); });
scenario('50 percent advance leaves the correct balance', () => { const [m, b] = fixture(); m.provider(b, 'captured'); assert.equal(b.paid, 1000); assert.equal(b.total - b.paid, 1000); assert.equal(b.paymentState, 'partial'); });
scenario('Zero percent confirms without collected money', () => { const [, b] = fixture({ percent: 0 }); assert.equal(b.status, 'received'); assert.equal(b.paid, 0); assert.equal(b.paymentState, 'pay_at_property'); });
scenario('Normal pay-at-property is configurable', () => { const m = new Mock(); m.normalProperty = false; assert.throws(() => m.prepare('key', { choice: 'property' })); });
scenario('Gateway outage still permits zero advance with normal property mode disabled', () => { const m = new Mock(); m.normalProperty = false; m.gateway = false; const b = m.prepare('key'); assert.equal(b.status, 'received'); assert.equal(b.paid, 0); });
scenario('Production rejects test payments', () => assert.throws(() => fixture({ env: 'test' })));
scenario('Checkout double-click returns one booking', () => { const [m, b] = fixture(); assert.equal(m.prepare('checkout-1'), b); assert.equal(m.books.size, 1); });
scenario('Same idempotency key with changed dates/payment is rejected', () => { const [m] = fixture(); assert.throws(() => m.prepare('checkout-1', { percent: 100 })); });
scenario('Switching to an external link preserves existing recovery', () => { const [m, b] = fixture(); m.mode = 'external'; assert.equal(m.prepare('checkout-1'), b); m.provider(b, 'captured'); assert.equal(b.status, 'received'); assert.throws(() => m.prepare('new-key', { units: [IDS[1]] })); });
scenario('Clearing link blocks new bookings but permits an outstanding capture', () => { const [m, b] = fixture(); m.mode = 'empty'; m.provider(b, 'captured'); assert.equal(b.status, 'received'); assert.throws(() => m.prepare('new-key')); });
scenario('Last local unit can be held by only one checkout', () => { const [m] = fixture(); assert.throws(() => m.prepare('second')); assert.equal(m.books.size, 1); });
scenario('Multi-unit conflict leaves no partial hold', () => { const [m] = fixture(); assert.throws(() => m.prepare('second', { units: [IDS[1], IDS[0]], guests: 2 })); assert.ok(NIGHTS.every((night) => !m.inventory.has(`${IDS[1]}/${night}`))); });
scenario('Double unit holds both guest places as one sellable unit', () => { const [, b] = fixture({ units: [IDS[2]], guests: 2 }); assert.equal(b.units.length, 1); assert.equal(b.guests, 2); });
scenario('Over-capacity and excessive group sizes are rejected', () => { assert.throws(() => fixture({ guests: 2 })); assert.throws(() => fixture({ units: IDS, guests: 5 })); });
scenario('Hold conversion does not subtract inventory twice', () => { const [m, b] = fixture(); const size = m.inventory.size; m.provider(b, 'captured'); assert.equal(m.inventory.size, size); });
scenario('Abandoned hold releases inventory after 15 minutes', () => { const [m, b] = fixture(); m.now = 15 * MINUTE; m.expire(); assert.equal(b.reason, 'hold_expired'); assert.equal(m.inventory.size, 0); assert.equal(b.paid, 0); });
scenario('Unknown payment has a bounded 30-minute hold', () => { const [m, b] = fixture(); m.ambiguous(b); m.now = 20 * MINUTE; m.expire(); assert.equal(b.status, 'hold'); m.now = 30 * MINUTE; m.expire(); assert.equal(m.inventory.size, 0); assert.equal(b.paymentState, 'unknown'); });
scenario('Money debited and browser disconnected resolves through a trusted capture', () => { const [m, b] = fixture(); m.ambiguous(b); m.provider(b, 'captured', { event: 'webhook-1' }); assert.equal(b.status, 'received'); assert.equal(b.paid, 1000); });
scenario('Authorized payment is not treated as captured', () => { const [m, b] = fixture(); m.provider(b, 'authorized'); assert.equal(b.status, 'hold'); assert.equal(b.paid, 0); });
scenario('Declined/provider-failed attempt creates no collected revenue', () => { const [m, b] = fixture(); m.provider(b, 'failed'); assert.equal(b.paid, 0); assert.equal(m.receipts.size, 0); });
scenario('Callback signature uses the stored order and rejects tampering', () => {
  const secret = 'MOCK-NOT-A-LIVE-SECRET';
  const signature = createHmac('sha256', secret).update('stored-order|payment').digest('hex');
  assert.equal(verifySignature('stored-order', 'payment', signature, secret), true);
  assert.equal(verifySignature('wrong-order', 'payment', signature, secret), false);
  assert.equal(verifySignature('stored-order', 'payment', 'invalid', secret), false);
});
scenario('Untrusted browser success cannot confirm', () => { const [m, b] = fixture(); assert.equal(m.provider(b, 'captured', { trusted: false }), 'rejected'); assert.equal(b.status, 'hold'); });
scenario('Wrong order/currency/environment cannot fulfil', () => { const [m, b] = fixture(); for (const options of [{ order: 'other' }, { currency: 'USD' }, { env: 'test' }]) assert.equal(m.provider(b, 'captured', options), 'rejected'); assert.equal(b.paid, 0); });
scenario('Captured wrong amount is retained for review, not treated as an allowed deposit', () => { const [m, b] = fixture(); m.provider(b, 'captured', { amountPaise: 90000 }); assert.equal(b.paid, 900); assert.equal(b.paymentState, 'review'); assert.equal(b.status, 'hold'); });
scenario('Callback before webhook records money once', () => { const [m, b] = fixture(); m.provider(b, 'captured'); m.provider(b, 'captured', { event: 'webhook' }); assert.equal(b.payments.size, 1); assert.equal(b.paid, 1000); });
scenario('Webhook before callback records money once', () => { const [m, b] = fixture(); m.provider(b, 'captured', { event: 'webhook' }); m.provider(b, 'captured'); assert.equal(b.payments.size, 1); assert.equal(m.books.size, 1); });
scenario('Duplicate webhook event is ignored', () => { const [m, b] = fixture(); m.provider(b, 'captured', { event: 'webhook' }); assert.equal(m.provider(b, 'captured', { event: 'webhook' }), 'duplicate-event'); });
scenario('Every authorized/captured/failed event ordering preserves verified capture', () => {
  for (const states of [['authorized', 'captured', 'failed'], ['authorized', 'failed', 'captured'], ['captured', 'authorized', 'failed'], ['captured', 'failed', 'authorized'], ['failed', 'authorized', 'captured'], ['failed', 'captured', 'authorized']]) {
    const [m, b] = fixture(); states.forEach((state, i) => m.provider(b, state, { event: `event-${i}` })); assert.equal(b.status, 'received'); assert.equal(b.paid, 1000); assert.equal(b.paymentState, 'partial');
  }
});
scenario('Late capture after expiry recovers when inventory remains free', () => { const [m, b] = fixture(); m.now = 16 * MINUTE; m.expire(); m.provider(b, 'captured'); assert.equal(b.status, 'received'); assert.equal(m.books.size, 1); });
scenario('Late capture after inventory is sold queues a full operational refund', () => { const [m, b] = fixture(); m.now = 16 * MINUTE; m.expire(); m.prepare('other'); m.provider(b, 'captured'); assert.equal(b.paymentState, 'captured_unfulfilled'); assert.equal(b.refunds.get('operational').amountPaise, 100000); });
scenario('Late capture after explicit cancellation never reopens', () => { const [m, b] = fixture(); m.cancel(b); m.provider(b, 'captured'); assert.equal(b.status, 'cancelled'); assert.equal(m.inventory.size, 0); assert.equal([...b.refunds.values()][0].amountPaise, 100000); });
scenario('Duplicate late-cancel capture cannot refund twice', () => { const [m, b] = fixture(); m.cancel(b); m.provider(b, 'captured'); m.provider(b, 'captured'); assert.equal(b.refunds.size, 1); });
scenario('Late capture credits the same pay-at-property booking', () => { const [m, b] = fixture({ choice: 'property' }); m.provider(b, 'captured'); assert.equal(m.books.size, 1); assert.equal(b.status, 'received'); assert.equal(b.total - b.paid, 1000); });
scenario('Different captured payment IDs are preserved and excess refund is queued once', () => { const [m, b] = fixture({ choice: 'full' }); m.provider(b, 'captured'); m.provider(b, 'captured', { id: 'second-payment' }); m.provider(b, 'captured', { id: 'second-payment' }); assert.equal(b.payments.size, 2); assert.equal(b.paid, 4000); assert.equal(b.refunds.size, 1); assert.equal(b.refunds.get('excess').amountPaise, 200000); });
scenario('Capture confirms the stay without claiming bank settlement', () => { const [m, b] = fixture(); m.provider(b, 'captured'); assert.equal(b.status, 'received'); assert.equal(m.receipts.size, 0); });
scenario('Net settlement creates exactly one bank receipt', () => { const [m, b] = fixture(); m.provider(b, 'captured'); m.settle('settlement-1', 97640); m.settle('settlement-1', 97640); assert.equal(m.receipts.size, 1); assert.equal(m.receipts.get('settlement-1'), 97640); assert.equal(b.paid, 1000); });
scenario('Unverified settlement cannot create a bank receipt', () => { const m = new Mock(); assert.throws(() => m.settle('settlement-1', 100000, false)); assert.equal(m.receipts.size, 0); });
scenario('Eligible cancellation releases inventory and requests, but does not complete, refund', () => { const [m, b] = fixture(); m.provider(b, 'captured'); m.cancel(b); assert.equal(m.inventory.size, 0); assert.equal(b.refunds.get('cancellation').state, 'pending'); assert.equal(b.refunded, 0); });
scenario('Verified refund processing updates amount refunded only once', () => { const [m, b] = fixture(); m.provider(b, 'captured'); m.cancel(b); m.refundResult(b, 'cancellation', 'processed'); m.refundResult(b, 'cancellation', 'processed'); assert.equal(b.refunded, 1000); assert.equal(b.paid, 1000); });
scenario('Cancellation after deadline releases inventory without automatic refund', () => { const [m, b] = fixture(); m.provider(b, 'captured'); m.cancel(b, 24); assert.equal(b.status, 'cancelled'); assert.equal(m.inventory.size, 0); assert.equal(b.refunds.size, 0); });
scenario('Refund timeout retains the claim and prevents another refund', () => { const [m, b] = fixture(); m.provider(b, 'captured'); m.cancel(b); m.refundResult(b, 'cancellation', 'unknown'); assert.equal(m.refund(b, 'cancellation', 100000).state, 'unknown'); assert.throws(() => m.refund(b, 'second-operation', 100000)); assert.equal(b.refunded, 0); });
scenario('Partial refund uses the accepted policy snapshot', () => { const policy = { deadlineHours: 48, refundPercent: 50 }; const [m, b] = fixture({ policy }); policy.refundPercent = 0; m.provider(b, 'captured'); m.cancel(b); assert.equal(b.refunds.get('cancellation').amountPaise, 50000); });
scenario('Guest cannot self-cancel a checked-in stay', () => { const [m, b] = fixture(); b.status = 'checked_in'; assert.throws(() => m.cancel(b)); });
scenario('Admin balance collection merges cash with the online advance', () => { const [m, b] = fixture(); m.provider(b, 'captured'); assert.equal(m.deskCollect(b, 1000), 'split'); assert.equal(b.paid + b.cash, 2000); });
scenario('Unresolved gateway payment blocks a second desk charge', () => { const [m, b] = fixture(); m.ambiguous(b); assert.throws(() => m.deskCollect(b, 2000)); });
scenario('Aiosell push failure does not undo booking or payment', () => { const [m, b] = fixture(); m.provider(b, 'captured'); b.sync = 'failed'; assert.equal(b.status, 'received'); assert.equal(b.paid, 1000); assert.equal(m.inventory.size, 2); b.sync = 'accepted'; assert.equal(m.books.size, 1); });
scenario('Disabled Aiosell auto-push explicitly requires manual channel update', () => { const m = new Mock(); m.autoPush = false; const b = m.prepare('key', { percent: 0 }); assert.equal(b.sync, 'manual_required'); });
scenario('Payment view permission does not authorize refund or settings', () => { const permissions = { canViewBookingPayments: true }; assert.equal(access('staff', permissions, 'view'), true); assert.equal(access('staff', permissions, 'refund'), false); assert.equal(access('staff', permissions, 'settings'), false); assert.equal(access('admin', {}, 'settings'), true); });
scenario('Reconciliation permission does not authorize returning money', () => { const permissions = { canReconcileBookingPayments: true }; assert.equal(access('manager', permissions, 'reconcile'), true); assert.equal(access('manager', permissions, 'refund'), false); });
scenario('Known reference without the private token is not guest authorization', () => { const [, b] = fixture(); const authorized = (token) => token === b.token; assert.equal(authorized(b.id), false); assert.equal(authorized(b.token), true); });
scenario('Late capture after a full cash collection queues excess refund and preserves check-in', () => { const [m, b] = fixture({ choice: 'property' }); m.deskCollect(b, 2000); m.provider(b, 'captured'); assert.equal(b.cash, 2000); assert.equal(b.paid, 1000); assert.equal(b.refunds.get('excess').amountPaise, 100000); assert.equal(b.status, 'checked_in'); assert.equal(b.paymentState, 'paid'); });
scenario('Two separate late captures after guest cancellation each receive one refund claim', () => { const [m, b] = fixture(); m.cancel(b); m.provider(b, 'captured'); m.provider(b, 'captured', { id: 'second-cancel-payment' }); assert.equal(b.refunds.size, 2); assert.equal([...b.refunds.values()].reduce((sum, r) => sum + r.amountPaise, 0), 200000); assert.equal(b.status, 'cancelled'); });
scenario('Confirmed failed refund retries the original operation', () => { const [m, b] = fixture(); m.provider(b, 'captured'); m.cancel(b); const original = b.refunds.get('cancellation'); m.refundResult(b, 'cancellation', 'failed'); assert.equal(m.retryFailedRefund(b, 'cancellation'), original); assert.equal(b.refunds.size, 1); assert.equal(b.refunded, 0); });
scenario('Unknown refund cannot be retried as a confirmed failed operation', () => { const [m, b] = fixture(); m.provider(b, 'captured'); m.cancel(b); m.refundResult(b, 'cancellation', 'unknown'); assert.throws(() => m.retryFailedRefund(b, 'cancellation')); });
scenario('Overlapping nights conflict but exclusive checkout allows an adjacent stay', () => { const [m] = fixture(); assert.throws(() => m.prepare('overlap', { nights: ['2026-10-02', '2026-10-03'] })); assert.equal(m.prepare('adjacent', { nights: ['2026-10-03'] }).status, 'hold'); });
scenario('One provider payment cannot be assigned to two local bookings', () => { const [m, b] = fixture(); m.provider(b, 'captured', { id: 'shared-payment' }); const second = m.prepare('second', { units: [IDS[1]] }); assert.throws(() => m.provider(second, 'captured', { id: 'shared-payment' })); assert.equal(second.paid, 0); });

console.log(`\nMock result: ${passed} passed; ${failed} failed. No live services contacted.`);
console.log('Scope: specification model only; real D1/Pi concurrency, Razorpay API/capture/refunds, UI, sync ownership, and deployment readiness require implementation tests.');
process.exitCode = failed ? 1 : 0;
