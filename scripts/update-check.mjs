// Simulates the app being updated on a phone that already has it installed.
// Serves a series of builds one after another (with the same 10-minute
// browser caching GitHub Pages uses, and old files disappearing on each
// deploy) and checks the app still opens after every update.
//
//   node scripts/update-check.mjs <build1> <build2> [build3 ...]
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const builds = process.argv.slice(2);
if (builds.length < 2) {
  console.error('usage: node scripts/update-check.mjs <build1> <build2> [build3 ...]');
  process.exit(1);
}

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};
let root = builds[0];
const server = createServer(async (req, res) => {
  let file = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (file.endsWith('/')) file += 'index.html';
  try {
    const body = await readFile(path.join(root, file));
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'max-age=600',
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((r) => server.listen(0, r));
const url = `http://localhost:${server.address().port}/`;

const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 412, height: 880 } });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);

/** Opens the app like launching it from the home screen; says what the user sees. */
async function open() {
  await page.goto(url);
  const ok = await page
    .waitForSelector('.card.new', { timeout: 6000 })
    .then(() => true)
    .catch(() => false);
  // Which build's script the page asked for, and which offline copies exist.
  const detail = await page
    .evaluate(async () => {
      const src = document.querySelector('script[type=module]')?.src ?? '';
      const keys = await caches.keys();
      return `${src.split('/').pop()}; caches: ${keys.map((k) => k.replace('colouring-book-', '')).join(',')}`;
    })
    .catch(() => 'page not readable');
  return `${ok ? 'works' : 'BLANK PAGE'} [${detail}]`;
}

let failed = false;
console.log(`build 1 installed: ${await open()}`);
await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 });

for (let i = 1; i < builds.length; i++) {
  root = builds[i];
  console.log(`--- update to build ${i + 1} published ---`);
  const results = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    results.push(await open());
    await page.waitForTimeout(4000); // time for the update to install in the background
  }
  // Ten minutes later the browser's own short-term cache has expired, so any
  // file that only "worked" because of it is now really gone.
  await cdp.send('Network.clearBrowserCache');
  const last = await open();
  results.forEach((r, n) => console.log(`  opening ${n + 1}: ${r}`));
  console.log(`  finally:   ${last}`);
  if (last.startsWith('BLANK')) failed = true;
}

await browser.close();
server.close();
console.log(failed ? '\nFAILED: app was left on a blank page' : '\nOK: app works after every update');
process.exit(failed ? 1 : 0);
