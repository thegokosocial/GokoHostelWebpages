/**
 * Slim rate-scrape callback bodies for the Worker POST.
 * Full card dumps stay in Actions artifacts; D1 only needs prices + short evidence.
 */
const CARD_TEXT_MAX = 240;

function slimEvidence(evidence) {
  if (!evidence || typeof evidence !== "object") return undefined;
  const out = {};
  for (const [date, entry] of Object.entries(evidence)) {
    if (!entry || typeof entry !== "object") continue;
    const cardText = typeof entry.cardText === "string" ? entry.cardText.slice(0, CARD_TEXT_MAX) : "";
    out[date] = {
      sourceUrl: entry.sourceUrl,
      capturedAt: entry.capturedAt,
      priceText: entry.priceText,
      cardText,
    };
    if (entry.error) out[date].error = entry.error;
  }
  return Object.keys(out).length ? out : undefined;
}

function slimCallbackPayload(payload) {
  if (payload == null || typeof payload === "string") return payload;
  if (payload.version === 2 && Array.isArray(payload.properties)) {
    return {
      version: 2,
      failedDates: Array.isArray(payload.failedDates) ? payload.failedDates : [],
      properties: payload.properties.map((row) => ({
        property: row.property,
        rating: row.rating ?? null,
        prices: row.prices || {},
        evidence: slimEvidence(row.evidence),
      })),
    };
  }
  if (Array.isArray(payload)) {
    return payload.map((row) => ({
      property: row.property,
      rating: row.rating ?? null,
      prices: row.prices || {},
      evidence: slimEvidence(row.evidence),
    }));
  }
  return payload;
}

module.exports = { slimCallbackPayload, slimEvidence, CARD_TEXT_MAX };
