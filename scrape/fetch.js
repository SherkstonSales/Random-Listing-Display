const fs = require("fs");
const { chromium } = require("playwright");

const START_URL =
  "https://www.sunoutdoors.com/ontario/sun-retreats-sherkston-shores/vacation-home-sales";

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

async function getUrlsFromDom(page) {
  const fromData = await page.$$eval(".storemapdata[data-url]", (els) =>
    els.map((e) => e.getAttribute("data-url")).filter(Boolean)
  );
  const fromButtons = await page.$$eval("a.seeDetailsDL[href]", (els) =>
    els.map((e) => e.href).filter(Boolean)
  );
  return [...fromData, ...fromButtons];
}

async function waitForListings(page) {
  await page.waitForSelector(".storemapdata[data-url], a.seeDetailsDL", {
    timeout: 60000,
    state: "attached"
  });
}

async function getTotalPages(page) {
  // Try to read the largest numbered page link
  const nums = await page.$$eval("a.page-link", (els) => {
    const out = [];
    for (const a of els) {
      const t = (a.textContent || "").trim();
      if (/^\d+$/.test(t)) out.push(parseInt(t, 10));
    }
    return out;
  });
  return nums.length ? Math.max(...nums) : 1;
}

async function clickPageNumber(page, n) {
  // Click the numbered page link like <a class="page-link">2</a>
  const locator = page.locator("a.page-link", { hasText: String(n) }).first();

  // Ensure it exists
  const count = await locator.count();
  if (!count) return false;

  // Scroll into view & click
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await locator.click().catch(() => {});
  return true;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
    viewport: { width: 1280, height: 800 },
    locale: "en-CA"
  });

  await page.goto(START_URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await tryClickCookieOrModalButtons(page);

  await waitForListings(page);

  const totalPages = await getTotalPages(page);
  const listingUrls = new Set();

  let pagesVisited = 0;

  // Always scrape page 1 first
  pagesVisited++;
  (await getUrlsFromDom(page)).forEach((u) => listingUrls.add(u));

  // Now go through remaining pages explicitly
  for (let p = 2; p <= totalPages; p++) {
    const ok = await clickPageNumber(page, p);
    if (!ok) break;

    // Wait for the listing set to change by waiting a moment + re-attached selector
    await page.waitForTimeout(1200);
    await tryClickCookieOrModalButtons(page);
    await waitForListings(page);

    pagesVisited++;
    (await getUrlsFromDom(page)).forEach((u) => listingUrls.add(u));

    // small safety pause so we don't hammer the site
    await page.waitForTimeout(250);
  }

  await browser.close();

  const out = {
    updatedAt: new Date().toISOString(),
    source: START_URL,
    totalPagesDetected: totalPages,
    pagesVisited,
    count: listingUrls.size,
    listings: Array.from(listingUrls)
  };

  fs.mkdirSync("docs", { recursive: true });
  fs.writeFileSync("docs/listings.json", JSON.stringify(out, null, 2), "utf-8");

  console.log(
    `Detected ${totalPages} pages. Visited ${pagesVisited}. Saved ${out.count} listing URLs.`
  );
})();
