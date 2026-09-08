// Self-contained: passed to page.evaluate in both Puppeteer and browser fixtures.
function extractBookingCards() {
  // Booking marks its visible price aria-hidden and provides separate screen-reader text.
  const visible = (el) => {
    for (let node = el; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
    }
    return true;
  };
  return Array.from(document.querySelectorAll('[data-testid="property-card"]')).slice(0, 20).map(card => {
    const priceEls = Array.from(card.querySelectorAll('[data-testid="price-and-discounted-price"]')).filter(visible);
    const texts = priceEls.map(el => {
      const clone = el.cloneNode(true);
      const originals = Array.from(el.querySelectorAll('*'));
      Array.from(clone.querySelectorAll('*')).forEach((child, i) => {
        const original = originals[i];
        if (!visible(original) || original.matches('s,del') || getComputedStyle(original).textDecorationLine.includes('line-through')) child.remove();
      });
      if (el.matches('s,del') || getComputedStyle(el).textDecorationLine.includes('line-through')) return '';
      return clone.textContent.replace(/\s+/g, ' ').trim();
    });
    const amounts = texts.flatMap(text => {
      // Only accept an unambiguous INR amount in the dedicated price element.
      if (/tax|charge|[$€£]/i.test(text)) return [];
      return [...text.matchAll(/(?:₹|\bRs\.?|\bINR)\s*((?:\d{1,3}(?:,\d{2,3})+|\d+)(?:\.\d{1,2})?)(?![\d.,])/gi)]
        .map(m => Number(m[1].replace(/,/g, '')));
    });
    const unique = [...new Set(amounts)];
    const price = unique.length === 1 && unique[0] > 0 ? unique[0] : null;
    return {
      name: card.querySelector('[data-testid="title"]')?.textContent?.trim() || 'Unknown',
      price, rating: null,
      evidence: {
        sourceUrl: location.href,
        capturedAt: new Date().toISOString(),
        priceText: texts.join(' | '),
        cardText: (card.innerText || '').slice(0, 6000),
        error: price === null ? 'Missing or ambiguous displayed INR price' : undefined,
      },
    };
  });
}
module.exports = { extractBookingCards };
