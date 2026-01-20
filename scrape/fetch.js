const fs = require('fs');
const { chromium } = require('playwright');

const START_URL =
  'https://www.sunoutdoors.com/ontario/sun-retreats-sherkston-shores/vacation-home-sales';

// Click the "Next" pagination button (your site uses class="page-link next")
async function clickNext(page) {
  const nextSelector = 'a.page-link.next';

  const next = await page.$(nextSelector);
  if (!next) return false;

  // Stop if disabled
  const ariaDisabled = await next.getAttribute('aria-disabled');
  const className = (await next.getAttribute('class')) || '';
  const disabledAttr = await next.getAttribute('disabled');

  if (ariaDisabled === 'true' || disabledAttr !== null || className.includes('disabled')) {
    return false;
  }

  // Click and allow the page to redraw listings
  await next.click().catch(() => {});
  return true;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // Go to the page and wait for JS to finish
  await page.goto(START_URL, { waitUntil: 'networkidle' });

  // Wait for listing elements to exist in the DOM
  await page.waitForSelector('.dh-property-list, .storemapdata[data-url], a.seeDetailsDL', {
    timeout: 60000
  });

  const listingUrls = new Set();
  let pageCount = 0;

  // Loop through pages (safety cap set high enough for 20+ pages)
  for (let i = 0; i < 100; i++) {
    pageCount++;

    // Pull urls from hidden storemapdata blocks (best source)
    const urlsFromData = await page.$$eval('.storemapdata[data-url]', (els) =>
      els
        .map((e) => e.getAttribute('data-url'))
        .filter(Boolean)
    );
    urlsFromData.forEach((u) => listingUrls.add(u));

    // Backup: pull urls from "See details" buttons
    const urlsFromButtons = await page.$$eval('a.seeDetailsDL[href]', (els) =>
      els
        .map((e) => e.href)
        .filter(Boolean)
    );
    urlsFromButtons.forEach((u) => listingUrls.add(u));

    // Try to move to next page
    const before = listingUrls.size;
    const clicked = await clickNext(page);
    if (!clicked) break;

    // Wait a bit for the new page content to load / rerender
    await page.waitForTimeout(1200);
    await page.waitForLoadState('networkidle').catch(() => {});

    // Ensure listings exist again after pagination
    await page
      .waitForSelector('.dh-property-list, .storemapdata[data-url], a.seeDetailsDL', {
        timeout: 60000
      })
      .catch(() => {});

    // If we clicked next but got no new URLs after several pages, break (prevents loops)
    const after = listingUrls.size;
    if (i >= 2 && after === before) {
      // Could be stuck or last page not flagged as disabled
      break;
    }
  }

  await browser.close();

  const out = {
    updatedAt: new Date().toISOString(),
    source: START_URL,
    pagesVisited: pageCount,
    count: listingUrls.size,
    listings: Array.from(listingUrls)
  };

  // IMPORTANT: write to /docs so GitHub Pages can serve it in classic mode
  fs.mkdirSync('docs', { recursive: true });
  fs.writeFileSync('docs/listings.json', JSON.stringify(out, null, 2), 'utf-8');

  console.log(`Visited ${pageCount} pages, saved ${out.count} listing URLs to docs/listings.json`);
})();
