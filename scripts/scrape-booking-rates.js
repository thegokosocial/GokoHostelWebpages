/**
 * Booking.com Rate Scraper
 * Runs via GitHub Actions with Puppeteer.
 * Fetches hostel/hotel prices for a given city and date range.
 * Posts results back to the Goko API.
 *
 * Environment variables (set by GitHub Action):
 *   SCRAPE_ID, CITY, START_DATE, END_DATE, PROPERTY_TYPE, API_URL, API_PASSWORD
 */

const puppeteer = require("puppeteer");

const SCRAPE_ID = process.env.SCRAPE_ID;
const CITY = process.env.CITY || "Gokarna";
const START_DATE = process.env.START_DATE;
const END_DATE = process.env.END_DATE;
const PROPERTY_TYPE = process.env.PROPERTY_TYPE || "hostels";
const API_URL = process.env.API_URL;
const API_PASSWORD = process.env.API_PASSWORD;
const PROXY_URL = process.env.PROXY_URL || ""; // e.g. "http://user:pass@proxy.example.com:8080"

const PROPERTY_TYPE_IDS = {
  hostels: "ht_id=203",
  hotels: "ht_id=204",
  guesthouses: "ht_id=216",
  homestays: "ht_id=222",
};

function generateDates(start, end) {
  const dates = [];
  const current = new Date(start);
  const endDate = new Date(end);
  while (current < endDate) {
    dates.push(current.toISOString().split("T")[0]);
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

function buildUrl(city, checkin, checkout, propertyType) {
  const filter = PROPERTY_TYPE_IDS[propertyType] || PROPERTY_TYPE_IDS.hostels;
  return `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(city)}&checkin=${checkin}&checkout=${checkout}&group_adults=1&no_rooms=1&nflt=${filter}&selected_currency=INR&lang=en`;
}

async function scrapeOnePage(browser, city, checkin, checkout, propertyType) {
  const page = await browser.newPage();

  // Proxy authentication if credentials are in the URL
  if (PROXY_URL && PROXY_URL.includes("@")) {
    const match = PROXY_URL.match(/\/\/([^:]+):([^@]+)@/);
    if (match) {
      await page.authenticate({ username: match[1], password: match[2] });
    }
  }

  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
  await page.setViewport({ width: 1366, height: 768 });
  await page.setExtraHTTPHeaders({ "Accept-Language": "en-IN,en;q=0.9" });

  const url = buildUrl(city, checkin, checkout, propertyType);
  console.log(`Fetching: ${checkin} → ${checkout}`);

  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    await page.waitForSelector('[data-testid="property-card"]', { timeout: 15000 });

    // Debug: log first card's text to see what the scraper sees
    const debugText = await page.evaluate(() => {
      const card = document.querySelector('[data-testid="property-card"]');
      return card ? card.innerText?.substring(0, 300) : "NO CARDS FOUND";
    });
    console.log(`  DEBUG card text: ${debugText.replace(/\n/g, " | ")}`);

    const properties = await page.evaluate(() => {
      const cards = document.querySelectorAll('[data-testid="property-card"]');
      return Array.from(cards).slice(0, 20).map((card) => {
        const nameEl = card.querySelector('[data-testid="title"]');
        
        // Strategy: find ALL price-like numbers, pick the right one
        // Booking.com structure: strikethrough price (original) + actual price (discounted)
        // We want the LAST/LOWEST visible price that's not taxes
        let price = null;

        // Method 1: data-testid="price-and-discounted-price" contains the final price
        // Extract price using multiple currency symbol patterns
        const cardText = (card.innerText || card.textContent || "").replace(/\u00a0/g, " ");
        
        // Try ₹, Rs, Rs., INR, or just the Unicode rupee sign variants
        const priceRegex = /(?:₹|Rs\.?|INR|&#8377;|\u20B9)\s?([\d,]+)/gi;
        const priceMatches = [...cardText.matchAll(priceRegex)];
        let parsedPrices = priceMatches
          .map((m) => parseInt(m[1].replace(/,/g, ""), 10))
          .filter((n) => n >= 100 && n <= 15000);
        
        // Fallback: if no currency-anchored prices found, look for data-testid element
        if (parsedPrices.length === 0) {
          const priceEl = card.querySelector('[data-testid="price-and-discounted-price"]');
          if (priceEl) {
            const priceText = (priceEl.innerText || priceEl.textContent || "").replace(/\u00a0/g, " ");
            const nums = [...priceText.matchAll(/([\d,]+)/g)];
            parsedPrices = nums.map((m) => parseInt(m[1].replace(/,/g, ""), 10)).filter((n) => n >= 100 && n <= 15000);
          }
        }

        if (parsedPrices.length > 0) {
          // Take the LAST price (Booking.com: strikethrough first, discounted last)
          price = parsedPrices[parsedPrices.length - 1];
          
          // Edge case: if exactly 2 and second > first, take first
          if (parsedPrices.length === 2 && parsedPrices[1] > parsedPrices[0]) {
            price = parsedPrices[0];
          }
        }

        return { name: nameEl?.textContent?.trim() || "Unknown", price, rating: null };
      });
    });

    await page.close();
    return properties;
  } catch (err) {
    console.error(`Error scraping ${checkin}: ${err.message}`);
    await page.screenshot({ path: `/tmp/scrape-error-${checkin}.png` }).catch(() => {});
    await page.close();
    return [];
  }
}

async function main() {
  console.log(`\n=== Booking.com Rate Scraper ===`);
  console.log(`City: ${CITY}, Dates: ${START_DATE} → ${END_DATE}, Type: ${PROPERTY_TYPE}\n`);

  if (!SCRAPE_ID || !START_DATE || !END_DATE) {
    console.error("Missing required environment variables");
    process.exit(1);
  }

  const dates = generateDates(START_DATE, END_DATE);
  console.log(`Scraping ${dates.length} dates...\n`);

  const launchArgs = ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"];
  if (PROXY_URL) {
    launchArgs.push(`--proxy-server=${PROXY_URL.replace(/^https?:\/\/[^@]+@/, "http://")}`);
    console.log(`Using proxy: ${PROXY_URL.replace(/:[^:@]+@/, ":***@")}`);
  }

  const browser = await puppeteer.launch({
    headless: "new",
    args: launchArgs,
  });

  const allProperties = new Map(); // property name → { rating, prices: { date: price } }

  for (const date of dates) {
    const checkout = new Date(date);
    checkout.setDate(checkout.getDate() + 1);
    const checkoutStr = checkout.toISOString().split("T")[0];

    let results = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      results = await scrapeOnePage(browser, CITY, date, checkoutStr, PROPERTY_TYPE);
      if (results.length > 0) break;
      console.log(`  Retry ${attempt + 1} for ${date}...`);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    for (const r of results) {
      if (!allProperties.has(r.name)) {
        allProperties.set(r.name, { property: r.name, rating: r.rating, prices: {} });
      }
      const entry = allProperties.get(r.name);
      if (r.price) entry.prices[date] = r.price;
      if (r.rating && !entry.rating) entry.rating = r.rating;
    }

    // Rate limit: wait 3-7 seconds between requests
    await new Promise((resolve) => setTimeout(resolve, 3000 + Math.random() * 4000));
  }

  await browser.close();

  const resultsArray = Array.from(allProperties.values());
  console.log(`\nScraped ${resultsArray.length} properties across ${dates.length} dates.`);

  // Post results back to API
  if (API_URL && API_PASSWORD) {
    console.log("Posting results to API...");
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: API_PASSWORD,
          action: "updateRateScrapeResults",
          scrapeId: parseInt(SCRAPE_ID),
          results: JSON.stringify(resultsArray),
          status: "done",
        }),
      });
      if (res.ok) {
        console.log("✓ Results posted successfully.");
      } else {
        console.error("Failed to post results:", await res.text());
      }
    } catch (err) {
      console.error("Error posting results:", err.message);
    }
  } else {
    console.log("\nNo API_URL set. Results (paste into D1 manually):");
    console.log(JSON.stringify(resultsArray, null, 2));
  }
}

main().catch(async (err) => {
  console.error("Scraper failed:", err);

  // Post failure status back to API
  if (API_URL && API_PASSWORD && SCRAPE_ID) {
    try {
      await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: API_PASSWORD,
          action: "updateRateScrapeResults",
          scrapeId: parseInt(SCRAPE_ID),
          results: "[]",
          status: "failed",
        }),
      });
    } catch {}
  }
  process.exit(1);
});
