const fs = require("fs");
const { chromium } = require("playwright");

const BASE =
  "https://www.sunoutdoors.com/ontario/sun-retreats-sherkston-shores/vacation-home-sales";

function pageUrl(n) {
  return `${BASE}?pageno=${n}`;
}

async function tryClickCookieOrModalButtons(page) {
  const selectors = [
    'button:has-text("Accept")',
    'button:has-text("I Accept")',
    'button:has-text("Accept All")',
    'button:has-text("Agree")',
    'button:has-text("OK")',
    'button:has-text("Got it")',
    'button[aria-label="Close"]',
    'button:has-text("Close")'
  ];
  for (const sel of selectors) {
    const el = await page.$(sel);
    if (el) {
      await el.click().catch(() => {});
      await page.waitForTimeout(300);
    }
  }
}

async function waitForListings(page) {
  // short timeout so we don’t hang forever
  await page.waitForSelector(".storemapdata[data-url], a.seeDetailsDL", {
    timeout: 15000,
    state: "attached"
  });
}

async function getListingUrls(page) {
  const fromData = await page.$$eval(".storemapdata[data-url]", (els) =>
    els.map((e) => e.getAttribute("data-url")).filter(Boolean)
  );
  const fromButtons = await page.$$eval("a.seeDetailsDL[href]", (els) =>
    els.map((e) => e.href).filter(Boolean)
  );
  return Array.from(new Set([...fromData, ...fromButtons]));
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
    viewport: { width: 1280, height: 800 },
    locale: "en-CA"
  });

  // Keep anything from hanging too long
  page.setDefaultNavigationTimeout(30000);
  page.setDefaultTimeout(30000);

  const listingSet = new Set();
  let pagesVisited = 0;

  const HARD_CAP_PAGES = 25; // your site is ~20 pages, so 25 is safe

  for (let n = 1; n <= HARD_CAP_PAGES; n++) {
    const url = pageUrl(n);
    console.log(`\n=== Loading page ${n}: ${url}`);

    // IMPORTANT: do NOT use waitUntil: "domcontentloaded" (can hang on JS sites)
    try {
      await page.goto(url, { timeout: 30000 });
    } catch (e) {
      console.log(`goto timeout/fail on page ${n}, stopping.`);
      break;
    }

    console.log(`Page ${n} loaded (navigation returned)`);

    await page.waitForTimeout(1500);
    await tryClickCookieOrModalButtons(page);

    console.log(`Waiting for listings on page ${n}...`);
    try {
      await waitForListings(page);
    } catch (e) {
      console.log(`No listings selector found on page ${n}, stopping.`);
      break;
    }

    const urls = await getListingUrls(page);
    console.log(`Page ${n}: found ${urls.length} listing urls`);

    if (!urls.length) {
      console.log(`Page ${n} returned 0 urls, stopping.`);
      break;
    }

    const before = listingSet.size;
    urls.forEach((u) => listingSet.add(u));
    pagesVisited = n;

    console.log(`Total unique listings so far: ${listingSet.size}`);

    // If page n didn’t add anything new, then the runner is seeing repeats
    if (listingSet.size === before) {
      console.log(
        `No new listings added on page ${n} (runner may be seeing repeats), stopping.`
      );
      break;
    }
  }

  await browser.close();

  const out = {
    updatedAt: new Date().toISOString(),
    source: BASE,
    pagination: "pageno",
    pagesVisited,
    count: listingSet.size,
    listings: Array.from(listingSet)
  };

  fs.mkdirSync("docs", { recursive: true });
  fs.writeFileSync("docs/listings.json", JSON.stringify(out, null, 2), "utf-8");

  console.log(`\nDONE. Visited ${pagesVisited} pages, saved ${out.count} listing URLs.`);
})();
