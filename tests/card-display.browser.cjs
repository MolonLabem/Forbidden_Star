// Display-resolution and asynchronous image regressions. No PDF/view settings shared.
// PLAYWRIGHT_MODULE=... CHROMIUM_PATH=... node tests/card-display.browser.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../page');
const output = path.resolve(process.env.BROWSER_OUTPUT || 'reports/card-display/artifacts');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.png': 'image/png' };
const faction = '#exp=sow&faction=adeptasororitas&category=';
const card = (category, file) => faction + category + '&card=' + encodeURIComponent('factions/sow/adeptasororitas/' + category + '/' + file + '.jpg');

(async () => {
  await fs.mkdir(output, { recursive: true });
  const server = http.createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(await fs.readFile(file));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const checks = [], errors = [], measurements = [];
  let active;
  async function check(name, run) { await run(); checks.push(name); console.log('PASS ' + name); }
  async function context(viewport, deviceScaleFactor = 1) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor });
    // Remote UI fonts are irrelevant to the local card fonts and must not delay tests.
    await ctx.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
    const page = active = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    return { ctx, page };
  }
  const ready = (page, selector = '.fs-lb-imgwrap') => page.locator(selector + '.is-ready').first().waitFor();
  async function crisp(page, selector, minimum = 2) {
    const result = await page.locator(selector).first().evaluate(img => {
      const b = img.getBoundingClientRect();
      return { rendered: [img.naturalWidth, img.naturalHeight], shown: [b.width, b.height], x: b.x, y: b.y,
        viewport: [innerWidth, innerHeight], dpr: devicePixelRatio, visibility: getComputedStyle(img).visibility, src: img.src.slice(0, 22) };
    });
    const scale = Math.max(minimum, result.dpr);
    assert.equal(result.visibility, 'visible');
    assert.ok(result.src.startsWith('data:image/png'), JSON.stringify(result));
    assert.ok(result.rendered[0] >= result.shown[0] * scale - 1, JSON.stringify(result));
    assert.ok(result.rendered[1] >= result.shown[1] * scale - 1, JSON.stringify(result));
    assert.ok(Math.abs(result.shown[0] / result.shown[1] - result.rendered[0] / result.rendered[1]) < .005);
    if (selector.includes('fs-lb')) {
      assert.ok(result.x >= 0 && result.x + result.shown[0] <= result.viewport[0] + 1, JSON.stringify(result));
      assert.ok(result.y >= 0 && result.y + result.shown[1] <= result.viewport[1] + 1, JSON.stringify(result));
    }
    measurements.push({ selector, ...result });
    return result;
  }
  try {
    const desktop = await context({ width: 1440, height: 1000 }, 2);
    const page = desktop.page;
    // A saved legacy low-resolution preference must never reduce the HD baseline.
    await page.addInitScript(() => localStorage.setItem('forbidden-stars.high-resolution-cards', 'false'));
    await check('order and event grids draw HD text at 2× screen density', async () => {
      for (const category of ['orders', 'events']) {
        await page.goto(base + faction + category);
        await ready(page, '.fs-card');
        const size = await crisp(page, '.fs-card.is-ready img');
        assert.ok(size.shown[0] <= 320);
        await page.locator('.fs-scrollarea').screenshot({ path: path.join(output, category + '-grid.png'), animations: 'disabled' });
      }
    });
    await check('orders and long events fit the viewer, full-screen mode, and viewport resize in HD', async () => {
      for (const [category, file] of [['orders', 'o_2'], ['events', 'e_2']]) {
        await page.goto(base + card(category, file)); await ready(page);
        const size = await crisp(page, '.fs-lb img');
        assert.ok(size.shown[0] <= 501);
        await page.screenshot({ path: path.join(output, category + '-viewer.png'), animations: 'disabled' });
        await page.locator('.fs-lb-full').click(); await ready(page);
        await crisp(page, '.fs-lb img');
        await page.locator('#fs-lb-wording').selectOption('icons'); await ready(page);
        await crisp(page, '.fs-lb img');
      }
      await page.setViewportSize({ width: 900, height: 650 });
      await page.waitForTimeout(200); await ready(page);
      await crisp(page, '.fs-lb img');
    });
    await desktop.ctx.close();

    const delayed = await context({ width: 1440, height: 1000 });
    const slow = delayed.page;
    let release, requested = 0;
    const gate = new Promise(resolve => { release = resolve; });
    await slow.route('**/factions/sow/adeptasororitas/orders/o_1.jpg', async route => {
      requested++; await gate; await route.continue();
    });
    await check('pending composition has a stable loader and no broken image in the grid or viewer', async () => {
      await slow.goto(base + card('orders', 'o_1'), { waitUntil: 'domcontentloaded' });
      await slow.locator('.fs-lb-imgwrap.is-loading').waitFor();
      await slow.waitForFunction(() => document.querySelectorAll('.fs-card').length === 5);
      assert.equal(await slow.locator('.fs-lb .fs-image-status').isVisible(), true);
      assert.match(await slow.locator('.fs-lb .fs-image-label').innerText(), /Загрузка/);
      assert.equal(await slow.locator('.fs-lb img').evaluate(img => getComputedStyle(img).visibility), 'hidden');
      const gridCard = slow.locator('.fs-card[data-card-id$="orders/o_1.jpg"]');
      assert.equal(await gridCard.getAttribute('aria-busy'), 'true');
      assert.equal(await gridCard.locator('img').evaluate(img => getComputedStyle(img).visibility), 'hidden');
      const before = await slow.locator('.fs-lb-imgwrap').boundingBox();
      assert.ok(before.width > 300 && before.height > 400);
      await slow.screenshot({ path: path.join(output, 'loading.png'), animations: 'disabled' });
      release(); await ready(slow); assert.ok(requested > 0);
      const after = await slow.locator('.fs-lb-imgwrap').boundingBox();
      assert.ok(Math.abs(before.width - after.width) < 1 && Math.abs(before.height - after.height) < 1, JSON.stringify({ before, after }));
      assert.equal(await slow.locator('.fs-lb .fs-image-status').isVisible(), false);
      await crisp(slow, '.fs-lb img');
    });
    await delayed.ctx.close();

    const failed = await context({ width: 1280, height: 900 });
    const retry = failed.page;
    let missing = true;
    await retry.route('**/factions/sow/adeptasororitas/orders/o_1.jpg', route => missing ? route.fulfill({ status: 404, body: '' }) : route.continue());
    await check('a missing template stays an explicit error, with working grid and modal retries', async () => {
      await retry.goto(base + card('orders', 'o_1'));
      await retry.locator('.fs-lb-imgwrap.is-error').waitFor();
      assert.equal(await retry.locator('.fs-lb img').evaluate(img => getComputedStyle(img).visibility), 'hidden');
      assert.equal(await retry.locator('.fs-lb img').getAttribute('src'), null, 'Never display a blank template after render failure');
      await retry.screenshot({ path: path.join(output, 'retry.png'), animations: 'disabled' });
      missing = false;
      await retry.getByRole('button', { name: 'Повторить загрузку', exact: true }).click();
      await ready(retry); await crisp(retry, '.fs-lb img');
      await retry.keyboard.press('Escape');
      const gridCard = retry.locator('.fs-card[data-card-id$="orders/o_1.jpg"]');
      await gridCard.click(); await gridCard.locator('img').waitFor({ state: 'visible' });
      assert.equal(await retry.locator('.fs-lb').count(), 0, 'Retry the grid image before opening it');
      await gridCard.click(); await ready(retry);
      assert.equal(await retry.locator('.fs-lb-close').evaluate(node => node === document.activeElement), true);
    });
    await failed.ctx.close();

    const navigation = await context({ width: 1440, height: 1000 });
    let finishOld;
    const oldRender = new Promise(resolve => { finishOld = resolve; });
    await navigation.page.route('**/factions/sow/adeptasororitas/orders/o_1.jpg', async route => { await oldRender; await route.continue(); });
    await check('navigating during a slow render never replaces the next card with the previous one', async () => {
      await navigation.page.goto(base + card('orders', 'o_1'), { waitUntil: 'domcontentloaded' });
      await navigation.page.locator('.fs-lb-imgwrap.is-loading').waitFor();
      await navigation.page.getByRole('button', { name: 'Следующая карточка', exact: true }).click();
      await ready(navigation.page);
      const title = await navigation.page.locator('[role=dialog]').getAttribute('aria-label');
      const current = await navigation.page.locator('.fs-lb img').getAttribute('src');
      assert.equal(title, 'КРЕСТНЫЙ ХОД');
      finishOld();
      await ready(navigation.page, '.fs-card[data-card-id$="orders/o_1.jpg"]');
      assert.equal(await navigation.page.locator('.fs-lb img').getAttribute('src'), current);
      assert.equal(await navigation.page.locator('[role=dialog]').getAttribute('aria-label'), title);
    });
    await navigation.ctx.close();

    const raster = await context({ width: 1280, height: 900 });
    let rawMissing = true;
    await raster.page.route('**/factions/base/ork/backs/order.jpg', route => rawMissing ? route.fulfill({ status: 404, body: '' }) : route.continue());
    await check('raster image failures offer retry and recover the native image without stretching', async () => {
      await raster.page.goto(base + '#exp=base&faction=ork&category=backs&card=factions%2Fbase%2Fork%2Fbacks%2Forder.jpg');
      await raster.page.locator('.fs-lb-imgwrap.is-error').waitFor();
      assert.equal(await raster.page.locator('.fs-lb img').evaluate(img => getComputedStyle(img).visibility), 'hidden');
      rawMissing = false;
      await raster.page.getByRole('button', { name: 'Повторить загрузку', exact: true }).click(); await ready(raster.page);
      const native = await raster.page.locator('.fs-lb img').evaluate(img => {
        const b = img.getBoundingClientRect();
        return { src: img.getAttribute('src'), ratio: img.naturalWidth / img.naturalHeight, displayedRatio: b.width / b.height };
      });
      assert.equal(native.src, 'factions/base/ork/backs/order.jpg');
      assert.ok(Math.abs(native.ratio - native.displayedRatio) < .001);
    });
    await check('landscape faction sheets keep their aspect ratio and fit beside the text panel', async () => {
      await raster.page.goto(base + '#exp=tdl&faction=genestealercult&category=faction_card&card=factions%2Ftdl%2Fgenestealercult%2Ffaction_card%2Fsheet_front_1.jpg');
      await ready(raster.page);
      const size = await crisp(raster.page, '.fs-lb img');
      assert.ok(Math.abs(size.rendered[0] / size.rendered[1] - 3118 / 1878) < .002);
    });
    await raster.ctx.close();

    const mobile = await context({ width: 390, height: 844 }, 3);
    await check('mobile orders and events use two columns and fit their viewer at 3× density', async () => {
      for (const [category, file] of [['orders', 'o_3'], ['events', 'e_2']]) {
        await mobile.page.goto(base + faction + category); await ready(mobile.page, '.fs-card');
        const columns = await mobile.page.locator('.fs-grid').evaluate(grid => getComputedStyle(grid).gridTemplateColumns.split(' ').length);
        assert.equal(columns, 2);
        await crisp(mobile.page, '.fs-card.is-ready img');
        await mobile.page.locator(`.fs-card[data-card-id$="${category}/${file}.jpg"]`).click(); await ready(mobile.page);
        await crisp(mobile.page, '.fs-lb img');
        await mobile.page.screenshot({ path: path.join(output, category + '-mobile.png'), animations: 'disabled' });
        await mobile.page.locator('.fs-lb-full').click(); await ready(mobile.page);
        await crisp(mobile.page, '.fs-lb img');
      }
    });
    await mobile.ctx.close();
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(output, 'browser-results.json'), JSON.stringify({ checks, errors, measurements }, null, 2) + '\n');
    console.log(`${checks.length} display checks passed; no JavaScript errors. Previews: ${output}`);
  } catch (e) {
    if (active && !active.isClosed()) await active.screenshot({ path: path.join(output, 'failure.png'), animations: 'disabled' });
    throw e;
  } finally {
    await browser.close(); await new Promise(resolve => server.close(resolve));
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
