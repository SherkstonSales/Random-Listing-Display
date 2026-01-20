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
    'button:has-text("Close")',
    'a:has-text("Accept")'
  ];

  for (const sel of selectors) {
    const el = await page.$(sel);
    if (el) {
      await el.click().catch(() => {});
      await page.waitForTimeout(600);
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

async function clickNext(page) {
  const sel = "a.page-link.next";
  const next = await page.$(sel);
  if (!next) return false;

  const ariaDisabled = await next.getAttribute("aria-disabled");
  const disabledAttr = await next.getAttribute("disabled");
  const className = (await next.getAttribute("class")) || "";

  if (ariaDisabled === "true" || disabledAttr !== null || className.includes("disabled")) {
    return false;
  }

  await next.click().catch(() => {});
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

  await page.setExtraHTTPHeaders({
    "Accept-Language": "en-CA,en;q=0.9"
  });

  await page.goto(START_URL, { waitUntil: "domcontentloaded" });

  await page.waitForTimeout(3000);
  await tryClickCookieOrModalButtons(page);

  const selector = ".dh-property-list, .storemapdata[data-url], a.seeDetailsDL";

  let found = false;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      await page.waitForSelector(selector, { timeout: 15000, state: "attached" });
      found = true;
      break;
    } catch {
      await page.mouse.wheel(0, 800).catch(() => {});
      await page.waitForTimeout(2000);
      await tryClickCookieOrModalButtons(page);
    }
  }

  if (!found) {
    const html = await page.content();
    fs.mkdirSync("docs", { recursive: true });
    fs.writeFileSync("docs/debug.html", html, "utf-8");

    const outEmpty = {
      updatedAt: new Date().toISOString(),
      source: START_URL,
      pagesVisited: 0,
      count: 0,
      listings: [],
      note:
        "No listing elements detected in GitHub runner. Saved docs/debug.html for inspection."
    };

    fs.writeFileSync("docs/listings.json", JSON.stringify(outEmpty, null, 2), "utf-8");
    await browser.close();
    console.log("No listing elements found. Wrote docs/debug.html and empty docs/listings.json");
    process.exit(0);
  }

  const listingUrls = new Set();
  let pagesVisited = 0;

  for (let i = 0; i < 120; i++) {
    pagesVisited++;

    const urls = await getUrlsFromDom(page);
    urls.forEach((u) => listingUrls.add(u));

    const before = listingUrls.size;
    const clicked = await clickNext(page);
    if (!clicked) break;

    await page.waitForTimeout(1200);
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await tryClickCookieOrModalButtons(page);
    await page.waitForTimeout(1200);

    const after = listingUrls.size;
    if (i >= 2 && after === before) break;
  }

  await browser.close();

  const out = {
    updatedAt: new Date().toISOString(),
    source: START_URL,
    pagesVisited,
    count: listingUrls.size,
    listings: Array.from(listingUrls)
  };

  fs.mkdirSync("docs", { recursive: true });
  fs.writeFileSync("docs/listings.json", JSON.stringify(out, null, 2), "utf-8");

  console.log(`Visited ${pagesVisited} pages, saved ${out.count} listing URLs.`);
})();
