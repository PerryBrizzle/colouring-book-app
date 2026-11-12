// Converts a photo in the real app and saves the two previews (finished look
// and outline) as images, for judging conversion quality. Needs `npm run dev`.
//
//   node scripts/preview.mjs <photo> <output-prefix> [colours] [detail]
import { chromium } from 'playwright-core';

const [photo, prefix, colours, detail] = process.argv.slice(2);
if (!photo || !prefix) {
  console.error('usage: node scripts/preview.mjs <photo> <output-prefix> [colours] [detail]');
  process.exit(1);
}

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 760, height: 860 }, deviceScaleFactor: 1 });
const problems = [];
page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
page.on('pageerror', (e) => problems.push(String(e)));

await page.goto(process.env.APP_URL ?? 'http://localhost:5173/');
await page.setInputFiles('input[type=file]', photo);
const settled = async () => {
  await page.waitForSelector('.segmented');
  await page.waitForTimeout(400);
  await page.waitForSelector('.veil', { state: 'detached', timeout: 60000 });
  await page.waitForTimeout(150);
};
const setSlider = (index, value) =>
  page.locator('input[type=range]').nth(index).evaluate((el, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);

await settled();
if (colours) await setSlider(0, colours);
if (detail) await setSlider(1, detail);
if (colours || detail) await settled();
// Optional 5th argument "flat": switch Exact shades off for comparison.
if (process.argv[6] === 'flat') await page.locator('.toggle input').uncheck();
console.log(`${photo}: ${await page.locator('.panel-foot .muted').textContent()}`);

// Hide the toggle so it doesn't cover the picture.
const stage = page.locator('.stage');
await page.addStyleTag({ content: '.segmented{opacity:0}' });
await stage.screenshot({ path: `${prefix}-finished.png` });
await page.getByText('To colour').click({ force: true });
await page.waitForTimeout(250);
await stage.screenshot({ path: `${prefix}-outline.png` });

if (problems.length) console.log('PAGE ERRORS:\n' + problems.join('\n'));
await browser.close();
