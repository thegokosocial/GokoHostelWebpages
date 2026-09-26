const vm = require('node:vm');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const source = fs.readFileSync(require.resolve('./scrape-booking-rates'), 'utf8');

async function simulate(outcomes, { callbackOk = true, env = {}, failAfter = Infinity } = {}) {
  const requests = [];
  const navigations = [];
  let attempt = 0;
  let done;
  const completed = new Promise(resolve => { done = resolve; });
  const processMock = {
    env: {
      SCRAPE_ID: '1',
      START_DATE: '2026-09-16',
      END_DATE: '2026-09-18',
      API_URL: 'https://example.test',
      API_PASSWORD: 'test',
      ...env,
    },
    exitCode: undefined,
    exit: code => {
      processMock.exitCode = code;
      setImmediate(done);
    },
  };
  let fetchCalls = 0;
  const browser = {
    close: async () => {},
    newPage: async () => ({
      setUserAgent: async () => {},
      setViewport: async () => {},
      setExtraHTTPHeaders: async () => {},
      goto: async url => { navigations.push(url); },
      waitForSelector: async () => {},
      waitForFunction: async () => {},
      evaluate: async () => outcomes[Math.min(attempt++, outcomes.length - 1)],
      close: async () => {},
      screenshot: async () => {},
    }),
  };
  vm.runInNewContext(source, {
    require: name => name === 'puppeteer'
      ? { launch: async () => browser }
      : name === 'node:fs/promises'
        ? { writeFile: async () => {} }
        : { extractBookingCards: () => {} },
    process: processMock,
    console: { log() {}, error() {} },
    setTimeout: cb => { setImmediate(cb); return 0; },
    fetch: async (_, opts) => {
      fetchCalls += 1;
      const body = JSON.parse(opts.body);
      requests.push(body);
      const ok = callbackOk && fetchCalls <= failAfter;
      if (['done', 'partial', 'failed'].includes(body.status)) {
        setImmediate(done);
      }
      return { ok, status: ok ? 200 : 500 };
    },
  });
  await completed;
  // Allow in-flight retries after a failed terminal post to settle.
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  const terminal = [...requests].reverse().find(r => ['done', 'partial', 'failed'].includes(r.status));
  return {
    requests,
    request: terminal || requests[requests.length - 1],
    payload: terminal ? JSON.parse(terminal.results) : null,
    navigations,
    exitCode: processMock.exitCode,
  };
}

(async () => {
  const card = price => ({ name: 'Goko', price, rating: null, evidence: { priceText: `₹${price}` } });

  const success = await simulate([[card(500)], [card(550)]]);
  assert.equal(success.requests[0].status, 'in_progress');
  assert.equal(success.request.status, 'done');
  assert.deepEqual(success.payload.properties[0].prices, { '2026-09-16': 500, '2026-09-17': 550 });
  const url = new URL(success.navigations[0]);
  for (const [key, value] of Object.entries({
    checkin: '2026-09-16', checkout: '2026-09-17', group_adults: '1',
    group_children: '0', no_rooms: '1', selected_currency: 'INR',
  })) assert.equal(url.searchParams.get(key), value);

  const partial = await simulate([[card(500)], [], []]);
  assert.equal(partial.requests[0].status, 'in_progress');
  assert.equal(partial.request.status, 'partial');
  assert.deepEqual(partial.payload.failedDates, ['2026-09-17']);
  assert.equal(partial.payload.properties[0].prices['2026-09-16'], 500);

  const failed = await simulate([[]]);
  assert.equal(failed.request.status, 'failed');
  assert.equal(failed.payload.failedDates.length, 2);

  const ambiguous = await simulate([[card(null)]]);
  assert.equal(ambiguous.request.status, 'failed');

  const callback = await simulate([[card(500)]], { callbackOk: false });
  assert.equal(callback.exitCode, 1);
  assert.ok(callback.requests.filter(r => r.status === 'done' || r.status === 'failed').length >= 1);

  const missingSecrets = await simulate([[card(500)]], { env: { API_URL: '', API_PASSWORD: '' } });
  assert.equal(missingSecrets.exitCode, 1);
  assert.equal(missingSecrets.requests.length, 0);

  console.log('7 scraper flow scenarios passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
