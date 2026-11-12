// Asks Chrome whether it considers the app installable ("Add to Home screen").
//   node scripts/install-check.mjs [url]
import { chromium } from 'playwright-core';

const url = process.argv[2] ?? process.env.APP_URL ?? 'http://localhost:4173/';
const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({
  viewport: { width: 412, height: 880 },
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();
await page.goto(url);
await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, {
  timeout: 20000,
});
const cdp = await context.newCDPSession(page);
const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
const manifest = await cdp.send('Page.getAppManifest');
console.log('manifest url:', manifest.url);
console.log('manifest parse errors:', JSON.stringify(manifest.errors));
console.log('installability errors:', JSON.stringify(installabilityErrors));
await browser.close();
