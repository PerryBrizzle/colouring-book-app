// Drives the app in a phone-sized browser: converts a photo, colours a few
// sections, and saves screenshots. Needs the dev server running (npm run dev).
//
//   node scripts/e2e.mjs <photo> <output-folder> [colours] [detail]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const [photo, outDir, colours, detail] = process.argv.slice(2);
if (!photo || !outDir) {
  console.error('usage: node scripts/e2e.mjs <photo> <output-folder> [colours] [detail]');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
const shot = (page, name) => page.screenshot({ path: path.join(outDir, name + '.png') });

const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({
  viewport: { width: 412, height: 880 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
});
const page = await context.newPage();
const problems = [];
page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
page.on('pageerror', (e) => problems.push(String(e)));

await page.goto(process.env.APP_URL ?? 'http://localhost:5173/');
await page.waitForSelector('.card.new');
await page.setInputFiles('input[type=file]', photo);

const setSlider = async (index, value) => {
  await page.locator('input[type=range]').nth(index).evaluate((el, v) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
};
const settled = async () => {
  await page.waitForSelector('.segmented');
  await page.waitForTimeout(400);
  await page.waitForSelector('.veil', { state: 'detached', timeout: 60000 });
  await page.waitForTimeout(150);
};

const t0 = Date.now();
await settled();
console.log(`first conversion shown after ${Date.now() - t0} ms`);
if (colours) await setSlider(0, colours);
if (detail) await setSlider(1, detail);
if (colours || detail) await settled();
console.log(await page.locator('.panel-foot .muted').textContent());
await shot(page, '1-preview-finished');
await page.getByText('To colour').click();
await page.waitForTimeout(200);
await shot(page, '2-preview-outline');

await page.getByText('Start colouring').click();
await page.waitForSelector('.palette');
await page.waitForTimeout(400);
await shot(page, '3-colour-start');

// Colour: use "Find" to jump to sections of the first colours and tap them.
const canvas = page.locator('.stage canvas');
const box = await canvas.boundingBox();
const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
for (let i = 0; i < 12; i++) {
  await page.getByText('Find', { exact: true }).click();
  await page.waitForTimeout(450);
  if (i === 0) await shot(page, '4-colour-zoomed');
  await page.touchscreen.tap(centre.x, centre.y);
  await page.waitForTimeout(60);
}
await shot(page, '5-colour-after-taps');
console.log('progress:', await page.locator('.progress span').textContent());

await page.getByText('Fit', { exact: true }).click();
await page.waitForTimeout(200);
await shot(page, '6-colour-fit');

// Optionally colour the whole picture to check auto-advance and the finish state.
if (process.argv[6] === 'finish') {
  for (let i = 0; i < 3000 && (await page.locator('.palette').count()); i++) {
    await page.getByText('Find', { exact: true }).click();
    await page.waitForTimeout(420);
    await page.touchscreen.tap(centre.x, centre.y);
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(600);
  console.log('finished:', await page.locator('.progress span').textContent());
  await shot(page, '6b-finished');
  await page.getByText('Admire it').click();
}

// Leave and come back: progress must survive.
await page.goBack();
await page.waitForSelector('.card .thumb');
await page.waitForTimeout(800);
await shot(page, '7-library');
await page.reload();
await page.waitForSelector('.card .thumb');
await page.locator('.card .thumb').first().click();
await page.waitForSelector('.stage canvas');
await page.waitForTimeout(300);
console.log('after reload:', await page.locator('.progress span').textContent());

if (problems.length) console.log('PAGE ERRORS:\n' + problems.join('\n'));
else console.log('no page errors');
await browser.close();
