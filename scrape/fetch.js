const fs = require("fs");
const { chromium } = require("playwright");

const START_URL =
  "https://www.sunoutdoors.com/ontario/sun-retreats-sherkston-shores/vacation-home-sales";

async function tryClickCookieOrModalButtons(page) {
  // Common cookie/consent / modal close patterns
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
  // Best source: hidden data-url
  const fromData = await page.$$eval(".storemapdata[data-url]", (els) =>
    els.map((e) => e.getAttribute("data-url")).filter(Boolean)
  );

  // Backup: See details buttons
  const fromButtons = await page.$$eval("a.seeDetailsDL[href]", (els) =>
    els.map((e) => e.href).filter(Boolean)
  );

  return [...fromData, ...fromButtons];
}

async function clickNext(page) {
  // Your pagination uses class="page-link next"
  const sel = "a.page-link.next";
  const next = await page.$(sel);
  if (!next) return false;

  // stop if disabled-ish
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

  // Be a little more “real browser”-like
  await page.setExtraHTTPHeaders({
    "Accept-Language": "en-CA,en;q=0.9"
  });

  await page.goto(START_URL, { waitUntil: "domcontentloaded" });

  // Give the JS app time to boot and make API calls
  await page.waitForTimeout(3000);
  await tryClickCookieOrModalButtons(page);

  // Wait for the listing container to ATTACH (not necessarily visible)
  // If the site renders offscreen or hidden briefly, "visible" can time out.
  const selector = ".dh-property-list, .storemapdata[data-url], a.seeDetailsDL";

  let found = false;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      await page.waitForSelector(selector, { timeout: 15000, state: "attached" });
      found = true;
      break;
    } catch {
      // Sometimes it needs a nudge: scroll and wait again
      await page.mouse.wheel(0, 800).catch(() => {});
      await page.waitForTimeout(2000);
      await tryClickCookieOrModalButtons(page);
    }
  }

  if (!found) {
    /
