// Checks the in-app "Install app" button: hidden until Chrome offers install,
// shows when it does, and triggers Chrome's prompt when tapped.
// Chrome's offer is simulated, since automated browsers never make it.
//   node scripts/install-button-check.mjs [url]
import { chromium } from 'playwright-core';

const url = process.argv[2] ?? process.env.APP_URL ?? 'http://localhost:4173/';
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 412, height: 880 } });
await page.goto(url);
await page.waitForSelector('.card.new');

const button = page.locator('button.install');
console.log('before offer, button shown:', (await button.count()) > 0);

await page.evaluate(() => {
  const e = new Event('beforeinstallprompt', { cancelable: true });
  e.prompt = () => {
    window.__prompted = true;
    return Promise.resolve();
  };
  window.dispatchEvent(e);
  window.__defaultPrevented = e.defaultPrevented;
});
await button.waitFor({ timeout: 5000 });
console.log('after offer, button shown:', true);
await button.click();
await page.waitForTimeout(200);
console.log('tap opened install prompt:', await page.evaluate(() => window.__prompted === true));
console.log('button hidden after use:', (await button.count()) === 0);
await browser.close();
