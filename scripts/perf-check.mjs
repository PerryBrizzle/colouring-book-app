// Measures how smooth the colouring screen is on a big picture, with the
// processor slowed down to roughly phone speed. Needs the app being served.
//   node scripts/perf-check.mjs <photo> [colours] [detail] [slowdown]
import { chromium } from 'playwright-core';

const [photo, colours = '80', detail = '7', slowdown = '4'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({
  viewport: { width: 412, height: 880 },
  deviceScaleFactor: 2.6,
  hasTouch: true,
  isMobile: true,
});
const page = await context.newPage();
await page.goto(process.env.APP_URL ?? 'http://localhost:4173/');
await page.setInputFiles('input[type=file]', photo);
const setSlider = (index, value) =>
  page.locator('input[type=range]').nth(index).evaluate((el, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
const settled = async () => {
  await page.waitForSelector('.segmented');
  await page.waitForTimeout(400);
  await page.waitForSelector('.veil', { state: 'detached', timeout: 120000 });
};
await settled();
await setSlider(0, colours);
await setSlider(1, detail);
await settled();
console.log(await page.locator('.panel-foot .muted').textContent());

const cdp = await context.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(slowdown) });
console.log(`processor slowed ${slowdown}x`);

let t = Date.now();
await page.getByText('Start colouring').click();
await page.waitForSelector('.palette');
console.log(`save + open colouring screen: ${Date.now() - t} ms`);
await page.waitForTimeout(1000);

// Frame times while something is happening on screen.
const measure = (label, action) =>
  (async () => {
    await page.evaluate(() => {
      window.__frames = [];
      let last = performance.now();
      window.__stop = false;
      const tick = (now) => {
        window.__frames.push(now - last);
        last = now;
        if (!window.__stop) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await action();
    const frames = await page.evaluate(() => {
      window.__stop = true;
      return window.__frames.slice(2);
    });
    frames.sort((a, b) => a - b);
    const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
    console.log(
      `${label}: average ${avg.toFixed(0)} ms/frame, worst ${frames[frames.length - 1].toFixed(0)} ms ` +
        `(${frames.length} frames)`,
    );
  })();

const box = await page.locator('.stage canvas').boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;

await measure('zooming in', async () => {
  for (let i = 0; i < 25; i++) {
    await page.mouse.move(cx, cy);
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(400);
});
await measure('panning (zoomed in)', async () => {
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 0; i < 40; i++) {
    await page.mouse.move(cx + i * 4, cy + i * 3);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(400);
});
await page.getByText('Fit', { exact: true }).click();
await page.waitForTimeout(500);
await measure('panning (whole picture)', async () => {
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 0; i < 40; i++) {
    await page.mouse.move(cx + i * 3, cy + i * 2);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(400);
});

// Tap-to-fill latency: time from tap to the progress text changing.
const before = await page.locator('.progress span').textContent();
const times = [];
for (let i = 0; i < 6; i++) {
  await page.getByText('Find', { exact: true }).click();
  await page.waitForTimeout(700);
  const was = await page.locator('.progress span').textContent();
  t = Date.now();
  await page.touchscreen.tap(cx, cy);
  await page.waitForFunction(
    (old) => document.querySelector('.progress span').textContent !== old,
    was,
    { timeout: 5000 },
  );
  times.push(Date.now() - t);
}
console.log(`tap to fill: ${times.join(', ')} ms  (${before} -> ${await page.locator('.progress span').textContent()})`);
await browser.close();
