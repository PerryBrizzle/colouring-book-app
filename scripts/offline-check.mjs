// Checks the built app installs its offline copy and still works with no
// network. Needs `npm run build` then `npm run preview`.
//   node scripts/offline-check.mjs <photo>
import { chromium } from 'playwright-core';

const photo = process.argv[2];
const url = process.env.APP_URL ?? 'http://localhost:4173/';
const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 412, height: 880 } });
const page = await context.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(String(e)));
page.on('requestfailed', (r) => problems.push(`request failed: ${r.url()} ${r.failure()?.errorText}`));
process.on('exit', () => problems.length && console.log('PROBLEMS:\n' + problems.join('\n')));

await page.goto(url);
page.setDefaultTimeout(20000);
await page.evaluate(() =>
  Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) => setTimeout(() => reject(new Error('service worker never became ready')), 15000)),
  ]),
);
await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 });
console.log('service worker active');

const manifest = await page.evaluate(async () => {
  const link = document.querySelector('link[rel=manifest]');
  const m = await (await fetch(link.href)).json();
  const icons = await Promise.all(
    m.icons.map(async (i) => {
      const res = await fetch(new URL(i.src, link.href));
      await res.blob();
      return res.ok;
    }),
  );
  return { name: m.name, display: m.display, iconsOk: icons.every(Boolean) };
});
console.log('manifest:', JSON.stringify(manifest));

await context.setOffline(true);
await page.reload();
await page.waitForSelector('.card.new');
console.log('reloaded with no network: app shell OK');

if (photo) {
  await page.setInputFiles('input[type=file]', photo);
  await page.waitForSelector('.segmented', { timeout: 60000 });
  console.log('converted a photo offline:', await page.locator('.panel-foot .muted').textContent());
}
if (!problems.length) console.log('no page errors');
await browser.close();
