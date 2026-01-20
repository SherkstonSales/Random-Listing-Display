const fs = require('fs');
const { chromium } = require('playwright');

const START_URL = 'https://www.sunoutdoors.com/ontario/sun-retreats-sherkston-shores/vacation-home-sales';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(START_URL, { waitUntil: 'networkidle' });

  const urls = new Set();

  for (let i = 0; i < 40; i++) {
    const links = await page.$$eval('a[href]', as => as.map(a => a.href));
    links.filter(u => u.includes('sunoutdoors.com') && !u.endsWith('vacation-home-sales'))
         .forEach(u => urls.add(u));

    const next = await page.$('a:has-text("Next")');
    if (!next) break;
    await next.click();
    await page.waitForTimeout(800);
  }

  await browser.close();

  fs.mkdirSync('display', { recursive: true });
  fs.writeFileSync('display/listings.json',
    JSON.stringify({ listings: [...urls] }, null, 2));
})();
