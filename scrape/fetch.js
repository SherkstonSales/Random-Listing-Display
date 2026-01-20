const fs = require("fs");
const { chromium } = require("playwright");

const BASE =
  "https://www.sunoutdoors.com/ontario/sun-retreats-sherkston-shores/vacation-home-sales";

function listPageUrl(n) {
  return `${BASE}?pageno=${n}`;
}

async function waitForListCards(page) {
  await page.waitForSelector(".dh-property-list", { timeout: 12000, state: "attached" });
}

async function getListPageCards(page) {
  return await page.$$eval(".dh-property-list", (cards) => {
    const out = [];
    for (const c of cards) {
      const url =
        c.querySelector(".storemapdata")?.getAttribute("data-url") ||
        c.querySelector("a.seeDetailsDL")?.href ||
        null;

      const img = c.querySelector("img")?.getAttribute("src") || null;
      const priceRaw = c.querySelector(".home-list-price")?.textContent?.trim() || null;

      const addrParts = Array.from(c.querySelectorAll(".address span"))
        .map((s) => s.textContent.trim())
        .filter(Boolean);
      const address = addrParts.length ? addrParts.join(" ") : null;

      const text = c.textContent || "";
      const beds = (text.match(/(\d+)\s*Bed/i) || [])[1] || null;
      const baths = (text.match(/(\d+)\s*Bath/i) || [])[1] || null;

      if (url) {
        out.push({
          url,
          price: priceRaw ? `$${priceRaw}`.replace("$$", "$") : null,
          beds,
          baths,
          address,
          images: img ? [img] : [],
          description: "",
          features: []
        });
      }
    }
    return out;
  });
}

async function extractDetails(detailPage) {
  return await detailPage.evaluate(() => {
    const pickText = (sels) => {
      for (const sel of sels) {
        const el = document.querySelector(sel);
        if (el && el.textContent) {
          const t = el.textContent.trim();
          if (t) return t;
        }
      }
      return "";
    };

    const pickManyText = (sels) => {
      for (const sel of sels) {
        const els = Array.from(document.querySelectorAll(sel));
        const items = els.map((e) => (e.textContent || "").trim()).filter(Boolean);
        if (items.length) return items;
      }
      return [];
    };

    // Grab likely gallery/hero images
    const imgs = Array.from(document.querySelectorAll("img"))
      .map((img) => img.currentSrc || img.getAttribute("src") || "")
      .filter(Boolean)
      .filter((src) =>
        src.includes("cloudfront") ||
        src.includes("milestoneinternet") ||
        src.includes("cdn-cgi")
      );

    const images = Array.from(new Set(imgs)).slice(0, 12);

    const description = pickText([
      ".description",
      ".property-description",
      ".vhs-description",
      ".listing-description",
      "main p"
    ]);

    const features = pickManyText([
      ".features li",
      ".amenities li",
      ".property-features li",
      ".vhs-features li"
    ]).slice(0, 20);

    return { images, description, features };
  });
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // Prevent hangs
  page.setDefaultNavigationTimeout(30000);
  page.setDefaultTimeout(30000);

  const listingsByUrl = new Map();

  // 1) Walk list pages and collect listing cards
  for (let p = 1; p <= 25; p++) {
    const url = listPageUrl(p);
    console.log(`List page ${p}: ${url}`);

    try {
      await page.goto(url, { timeout: 30000 });
    } catch {
      break;
    }

    await page.waitForTimeout(900);

    let cards = [];
    try {
      await waitForListCards(page);
      cards = await getListPageCards(page);
    } catch {
      break;
    }

    if (!cards.length) break;

    const before = listingsByUrl.size;
    for (const c of cards) {
      if (!listingsByUrl.has(c.url)) listingsByUrl.set(c.url, c);
    }

    // If nothing new was added, likely end of paging
    if (listingsByUrl.size === before) break;

    await page.waitForTimeout(150);
  }

  // 2) Visit each detail page and enrich
  const detail = await browser.newPage();
  detail.setDefaultNavigationTimeout(30000);
  detail.setDefaultTimeout(30000);

  let i = 0;
  for (const [url, item] of listingsByUrl) {
    i++;
    console.log(`Detail ${i}/${listingsByUrl.size}: ${url}`);

    try {
      await detail.goto(url, { timeout: 30000 });
    } catch {
      continue;
    }

    await detail.waitForTimeout(900);

    try {
      const d = await extractDetails(detail);
      if (d.images && d.images.length) item.images = d.images;
      if (d.description) item.description = d.description;
      if (d.features && d.features.length) item.features = d.features;
    } catch {
      // keep whatever we already had
    }

    // small delay
    await detail.waitForTimeout(80);
  }

  await browser.close();

  const out = {
    updatedAt: new Date().toISOString(),
    source: BASE,
    count: listingsByUrl.size,
    listings: Array.from(listingsByUrl.values())
  };

  fs.mkdirSync("docs", { recursive: true });
  fs.writeFileSync("docs/listings_detailed.json", JSON.stringify(out, null, 2), "utf-8");

  console.log(`Saved ${out.count} detailed listings to docs/listings_detailed.json`);
})();
