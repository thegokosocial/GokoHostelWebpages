let chromium;
try { chromium = require('puppeteer'); } catch { ({ chromium } = require('playwright')); }
const assert = require('node:assert/strict');
const { extractBookingCards } = require('./booking-rate-parser');
(async () => {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    const cases = [
      ['Goko', '₹ 500', '+₹ 25 taxes', 500],
      ['HostelLife', '₹ 550', '+₹ 28 taxes', 550],
      ['Tax over 100', '₹ 2,000', '+₹ 100 taxes', 2000],
      ['Discount', '<s>₹625</s> ₹500', '+₹100 taxes', 500],
      ['Hidden amount', '<span style="display:none">₹400</span> ₹500', '', 500],
      ['Decimal', 'INR 1,234.50', '', 1234.5],
      ['Rs', 'Rs. 400', '', 400],
      ['Cheap', '₹99', '', 99],
      ['Expensive', '₹20,000', '', 20000],
      ['Ambiguous', '₹400 ₹500', '', null],
      ['Foreign', '$500', '', null],
      ['Tax in selector', '₹500 + ₹100 taxes', '', null],
      ['Missing', null, '₹400', null],
    ];
    for (const [name, text, other, expected] of cases) {
      await page.setContent(`<div data-testid="property-card"><h2 data-testid="title">${name}</h2>${text === null ? '' : `<span data-testid="price-and-discounted-price" aria-hidden="true">${text}</span>`}<div>${other}</div></div>`);
      const [result] = await page.evaluate(extractBookingCards);
      assert.equal(result.price, expected, name);
      assert.equal(result.name, name);
      assert.ok(result.evidence.capturedAt);
    }
    console.log(`${cases.length} browser card scenarios passed`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
