const fs = require("fs");

const BASE = "https://www.sunoutdoors.com";
const API_URL = `${BASE}/api/InventoryApi/GetInventoryRecords`;

async function fetchPage(pageNumber) {
  const payload = {
    Name: "VacationHomeSales",
    FormatName: "vacation-home-list-block",
    IsAttributeFilterOnly: false,
    AttributeFilters: [],
    BaseInventoryFilters: [],
    InventoryFilters: [],
    IsCaching: false,
    IsJsonResult: true,
    OrderBy: "desc",
    OrderByField: "price",
    PageSize: 12,
    ProfileIds: [30321],
    SecondryOrderByField: "_id",
    pageNumber
  };

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
      "Origin": "https://www.sunoutdoors.com",
      "Referer": "https://www.sunoutdoors.com/ontario/sun-retreats-sherkston-shores/vacation-home-sales"
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} on page ${pageNumber}`);
  }

  return await res.json();
}

function buildListingUrl(alias) {
  return `https://www.sunoutdoors.com/vacation-home-sales/${alias}`;
}

(async () => {
  const listings = [];
  const seen = new Set();
  let pagesVisited = 0;

  for (let pageNumber = 1; pageNumber <= 50; pageNumber++) {
    console.log(`Fetching page ${pageNumber}...`);

    let data;
    try {
      data = await fetchPage(pageNumber);
    } catch (err) {
      console.log(`Failed on page ${pageNumber}: ${err.message}`);
      break;
    }

    const records = Array.isArray(data?.Record) ? data.Record : [];
    console.log(`Page ${pageNumber}: ${records.length} records`);

    if (!records.length) {
      break;
    }

    let addedThisPage = 0;

    for (const rec of records) {
      const alias = rec?.Alias;
      if (!alias) continue;

      const url = buildListingUrl(alias);
      if (seen.has(url)) continue;

      seen.add(url);
      listings.push(url);
      addedThisPage++;
    }

    pagesVisited = pageNumber;

    if (addedThisPage === 0) {
      console.log(`No new listings added on page ${pageNumber}, stopping.`);
      break;
    }
  }

  const out = {
    updatedAt: new Date().toISOString(),
    source: API_URL,
    pagination: "pageNumber",
    pagesVisited,
    count: listings.length,
    listings
  };

  fs.mkdirSync("docs", { recursive: true });
  fs.writeFileSync("docs/listings.json", JSON.stringify(out, null, 2), "utf-8");

  console.log(`DONE. Visited ${pagesVisited} pages, saved ${listings.length} listing URLs.`);
})();
