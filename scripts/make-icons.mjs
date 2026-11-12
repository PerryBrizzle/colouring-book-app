// Renders public/icon.svg into the PNG icons the home-screen install needs.
//   node scripts/make-icons.mjs
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const svg = readFileSync('public/icon.svg', 'utf8');
const browser = await chromium.launch({ channel: 'chrome' });

async function render(file, size, maskable) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  // Maskable icons get cropped to a circle/squircle by Android, so the art is
  // shrunk into the safe middle and the background fills the whole square.
  const inner = maskable ? 0.72 : 1;
  await page.setContent(`<body style="margin:0;background:${maskable ? '#1f1d2b' : 'transparent'};
    display:grid;place-items:center;width:${size}px;height:${size}px">
    <div style="width:${size * inner}px;height:${size * inner}px">${svg}</div></body>`);
  await page.screenshot({ path: file, omitBackground: !maskable });
  await page.close();
}

await render('public/icon-192.png', 192, false);
await render('public/icon-512.png', 512, false);
await render('public/icon-maskable-512.png', 512, true);
await browser.close();
console.log('icons written to public/');
