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
      console.log(`Clicked modal/cookie button: ${sel}`);
      await el.click().catch(() => {});
      await page.waitForTimeout(500);
    }
  }
}

async function waitForListings(page) {
  const timeoutMs = 30000;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {

    const count = await page.$$eval(
      ".storemapdata[data-url], a.seeDetailsDL[href]",
      els => els.length
    ).catch(() => 0);

    console.log(`Listing selector count: ${count}`);

    if (count > 0) {
      return;
    }

    // scroll a bit in case listings lazy-load
    await page.mouse.wheel(0, 1500).catch(() => {});

    await page.waitForTimeout(1000);
  }

  throw new Error("Listings never appeared");
}

async function getListingUrls(page) {
  const urls = await page.$$eval(".vhs-list-block-outer a.seeDetailsDL[href]", (els) =>
    els.map((e) => e.href).filter(Boolean)
  );
  return Array.from(new Set(urls));
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
    viewport: { width: 1280, height: 800 },
    locale: "en-CA"
  });

  page.setDefaultNavigationTimeout(30000);
  page.setDefaultTimeout(30000);

  const listingSet = new Set();
  let pagesVisited = 0;
  const HARD_CAP_PAGES = 25;

  for (let n = 1; n <= HARD_CAP_PAGES; n++) {
    const url = pageUrl(n);
    console.log(`\n=== Loading page ${n}: ${url}`);

    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    } catch (e) {
      console.log(`goto timeout/fail on page ${n}, stopping.`);
      console.log(String(e));
      break;
    }

    console.log(`Page ${n} loaded (navigation returned)`);

    await page.waitForTimeout(8000);
    await tryClickCookieOrModalButtons(page);

    // scroll in case lazy render / lazy load is involved
    await page.mouse.wheel(0, 1200).catch(() => {});
    await page.waitForTimeout(2000);

    const debugCounts = await page.evaluate(() => {
      return {
        cards: document.querySelectorAll(".vhs-list-block-outer").length,
        detailLinks: document.querySelectorAll(".vhs-list-block-outer a.seeDetailsDL[href]").length,
        anySeeDetails: document.querySelectorAll("a.seeDetailsDL[href]").length,
        bodyTextSnippet: (document.body.innerText || "").slice(0, 500)
      };
    });

    console.log(`Debug counts page ${n}:`, JSON.stringify(debugCounts, null, 2));

    console.log(`Waiting for listings on page ${n}...`);
    try {
      await waitForListings(page);
    } catch (e) {
      console.log(`No listings selector found on page ${n}, stopping.`);

      const title = await page.title().catch(() => "NO TITLE");

      const bodyText = await page.evaluate(() => {
        return (document.body?.innerText || "").slice(0, 3000);
      }).catch(() => "NO BODY TEXT");

      console.log("===== PAGE TITLE =====");
      console.log(title);

      console.log("===== BODY TEXT =====");
      console.log(bodyText);

      break;
    }

    const urls = await getListingUrls(page);
    console.log(`Page ${n}: found ${urls.length} listing urls`);

    if (!urls.length) {
      console.log(`Page ${n} returned 0 urls, stopping.`);
      fs.mkdirSync("docs", { recursive: true });
      fs.writeFileSync(`docs/debug-page${n}.html`, await page.content(), "utf-8");
      console.log(`Saved debug HTML to docs/debug-page${n}.html`);
      break;
    }

    const before = listingSet.size;
    urls.forEach((u) => listingSet.add(u));
    pagesVisited = n;

    console.log(`Total unique listings so far: ${listingSet.size}`);

    if (listingSet.size === before) {
      console.log(`No new listings added on page ${n}, stopping.`);
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
