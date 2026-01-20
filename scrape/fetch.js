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
      await page.waitForTimeout(500);
    }
  }
}

async function waitForListings(page) {
  await page.waitForSelector(".storemapdata[data-url], a.seeDetailsDL", {
    timeout: 60000,
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

  const listingSet = new Set();
  let pagesVisited = 0;

  // Loop pages until we stop seeing new listings.
  // Safety cap at 100 pages (way above your ~20).
  for (let n = 1; n <= 100; n++) {
    const url = pageUrl(n);
    
    await page.goto(url, { timeout: 30000 });
    console.log(`Page ${n} loaded (navigation returned)`);

    await tryClickCookieOrModalButtons(page);

    // If listings never appear on a page, assume we’re past the last page.
    try {
      await waitForListings(page);
    } catch {
      break;
    }

    const urls = await getListingUrls(page);

    // If page returns nothing, stop.
    if (!urls.length) break;

    const before = listingSet.size;
    urls.forEach((u) => listingSet.add(u));
    pagesVisited = n;

    // If we didn’t add anything new, we’ve hit the end.
    if (listingSet.size === before) break;

    // polite delay
    await page.waitForTimeout(250);
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

  console.log(`Visited ${pagesVisited} pages, saved ${out.count} listing URLs.`);
})();
