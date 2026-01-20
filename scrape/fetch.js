const fs = require("fs");
const { chromium } = require("playwright");

const BASE =
  "https://www.sunoutdoors.com/ontario/sun-retreats-sherkston-shores/vacation-home-sales";

const MAX_PAGES = 25;          // upper bound; script stops early when paging ends
const OUT_PATH = "docs/listings.json";

function listPageUrl(n) {
  return `${BASE}?pageno=${n}`;
}

async function waitForList(page) {
  // use multiple selectors so minor site changes don’t break the run
  await page.waitForSelector(".dh-property-list, .storemapdata, a.seeDetailsDL", {
    timeout: 15000,
    state: "attached",
  });
}

async function extractListingUrls(page) {
  return await page.evaluate(() => {
    const urls = new Set();

    // Primary: elements with data-url attribute
    document.querySelectorAll(".storemapdata").forEach((el) => {
      const u = el.getAttribute("data-url");
      if (u) urls.add(u);
    });

    // Fallback: explicit details links
    document.querySelectorAll("a.seeDetailsDL").forEach((a) => {
      if (a && a.href) urls.add(a.href);
    });

    // Normalize to absolute URLs (in case data-url is relative)
    const abs = [];
    urls.forEach((u) => {
      try {
        abs.push(new URL(u, window.location.origin).toString());
      } catch {
        // ignore bad urls
      }
    });

    return abs;
  });
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  page.setDefaultNavigationTimeout(30000);
  page.setDefaultTimeout(30000);

  const found = new Set();
  let pagesVisited = 0;

  for (let p = 1; p <= MAX_PAGES; p++) {
    const url = listPageUrl(p);
    console.log(`List page ${p}: ${url}`);

    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    } catch (e) {
      console.log("Navigation failed; stopping.", e?.message || e);
      break;
    }

    try {
      await waitForList(page);
    } catch {
      console.log("No listing elements found; stopping.");
      break;
    }

    // small delay for any client-side rendering
    await page.waitForTimeout(600);

    const urls = await extractListingUrls(page);

    if (!urls.length) {
      console.log("No URLs found on this page; stopping.");
      break;
    }

    const before = found.size;
    urls.forEach((u) => found.add(u));

    pagesVisited++;
    console.log(`  Found ${urls.length} urls (${found.size} unique total)`);

    // End condition: page didn’t add anything new
    if (found.size === before) {
      console.log("No new listings added; assuming end of pagination.");
      break;
    }
  }

  await browser.close();

  const out = {
    updatedAt: new Date().toISOString(),
    source: BASE,
    pagination: "pageno",
    pagesVisited,
    count: found.size,
    listings: Array.from(found),
  };

  fs.mkdirSync("docs", { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2), "utf-8");

  console.log(`Saved ${out.count} listings to ${OUT_PATH}`);
})();
