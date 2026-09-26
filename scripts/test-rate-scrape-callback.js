const assert = require("node:assert/strict");
const { slimCallbackPayload, CARD_TEXT_MAX } = require("./rate-scrape-callback");

const longCard = "X".repeat(CARD_TEXT_MAX + 400);
const fat = {
  version: 2,
  failedDates: ["2026-10-01"],
  properties: [{
    property: "Goko",
    rating: 9.1,
    prices: { "2026-10-01": 500, "2026-10-02": null },
    evidence: {
      "2026-10-01": {
        sourceUrl: "https://www.booking.com/searchresults.html",
        capturedAt: "t",
        priceText: "₹500",
        cardText: longCard,
      },
    },
  }],
};

const slim = slimCallbackPayload(fat);
assert.equal(slim.version, 2);
assert.deepEqual(slim.failedDates, ["2026-10-01"]);
assert.equal(slim.properties[0].prices["2026-10-01"], 500);
assert.equal(slim.properties[0].evidence["2026-10-01"].priceText, "₹500");
assert.equal(slim.properties[0].evidence["2026-10-01"].cardText.length, CARD_TEXT_MAX);
assert.ok(JSON.stringify(slim).length < JSON.stringify(fat).length);

const legacy = slimCallbackPayload([{ property: "A", rating: null, prices: { "2026-10-01": 1 }, evidence: { "2026-10-01": { sourceUrl: "https://www.booking.com/x", capturedAt: "t", priceText: "1", cardText: longCard } } }]);
assert.equal(legacy[0].evidence["2026-10-01"].cardText.length, CARD_TEXT_MAX);

console.log("rate-scrape-callback slim scenarios passed");
