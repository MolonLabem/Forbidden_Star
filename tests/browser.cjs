// Optional browser checks: PLAYWRIGHT_MODULE=... CHROMIUM_PATH=... node tests/browser.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../page');
const output = process.env.BROWSER_OUTPUT || '/tmp/forbidden-star-preview';
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.png': 'image/png' };

(async () => {
  await fs.mkdir(output, { recursive: true });
  const server = http.createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
      const data = await fs.readFile(file);
      response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(data);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const errors = [], checks = [];
  let active;
  async function check(name, run) { await run(); checks.push(name); console.log('PASS ' + name); }
  async function makeContext(viewport) {
    const context = await browser.newContext({ viewport });
    await context.addInitScript(() => {
      window.drawnText = [];
      const fill = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
        window.drawnText.push(text); return fill.call(this, text, ...args);
      };
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    return { context, page };
  }
  const waitCard = page => page.waitForFunction(() => {
    const img = document.querySelector('.fs-lb img');
    return img?.parentNode.classList.contains('is-ready') && img.complete && img.naturalWidth > 0;
  });
  try {
    const desktop = await makeContext({ width: 1440, height: 1000 });
    const page = active = desktop.page;
    await page.goto(base);
    await page.locator('.fs-exp-head').nth(3).waitFor();
    await check('font has three distinct visible token glyphs and a labelled legend', async () => {
      await page.locator('.fs-settings summary').click();
      await page.evaluate(() => document.fonts.load('32px ForbiddenStars'));
      const bitmaps = await page.evaluate(() => window.FSWord.tokens.map(token => {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 48;
        const ctx = canvas.getContext('2d'); ctx.font = '32px ForbiddenStars'; ctx.fillText(token.glyph, 2, 36);
        const pixels = ctx.getImageData(0, 0, 48, 48).data;
        return { png: canvas.toDataURL(), ink: pixels.filter((n, i) => i % 4 === 3 && n > 0).length };
      }));
      assert.equal(new Set(bitmaps.map(x => x.png)).size, 3);
      assert.ok(bitmaps.every(x => x.ink > 30));
      assert.equal(await page.locator('.fs-token-legend [role=img][aria-label]').count(), 3);
      await page.locator('.fs-token-legend').screenshot({ path: path.join(output, 'tokens.png') });
      await page.locator('.fs-settings summary').click();
    });
    await check('search finds a rule sentence without matching the card title', async () => {
      await page.locator('.fs-faq-search').fill('жетон кузницы, чтобы восстановить');
      await page.locator('.fs-card').first().waitFor();
      assert.equal(await page.locator('.fs-card').count(), 1);
      assert.match(await page.locator('.fs-search-name').innerText(), /ПРЕВОСХОДСТВО МАШИНЫ/);
    });
    let cardLink;
    await check('modal exposes selectable text and traps keyboard focus', async () => {
      await page.locator('.fs-card').click(); await waitCard(page);
      assert.equal(await page.locator('[role=dialog][aria-modal=true]').count(), 1);
      assert.match(await page.locator('.fs-card-text').innerText(), /жетон кузницы/);
      assert.equal(await page.locator('.fs-header').evaluate(node => node.inert), true);
      assert.equal(await page.locator('.fs-lb-close').evaluate(node => node === document.activeElement), true);
      const lastControl = page.locator('.fs-lb').locator('button:enabled:visible, a:visible, summary:visible, input:enabled:visible, select:enabled:visible').last();
      await lastControl.focus(); await page.keyboard.press('Tab');
      assert.equal(await page.locator('.fs-lb-nav').first().evaluate(node => node === document.activeElement), true);
      await page.keyboard.press('Shift+Tab');
      assert.equal(await lastControl.evaluate(node => node === document.activeElement), true);
      cardLink = await page.locator('.fs-lb-share').getAttribute('href');
    });
    await check('icon wording reaches canvas and accessible HTML, persists, and switches back', async () => {
      await page.evaluate(() => { window.drawnText = []; });
      await page.locator('#fs-lb-wording').selectOption('icons'); await waitCard(page);
      assert.equal(await page.locator('.fs-card-text .fs-token[aria-label="жетон кузницы"]').count(), 1);
      assert.equal(await page.evaluate(() => window.drawnText.some(text => text.includes('\uE100'))), true);
      await page.screenshot({ path: path.join(output, 'card-icons.png'), animations: 'disabled' });
      await page.reload(); await waitCard(page);
      assert.equal(await page.locator('#fs-lb-wording').inputValue(), 'icons');
      await page.locator('#fs-lb-wording').selectOption('explicit'); await waitCard(page);
      assert.equal(await page.locator('.fs-card-text .fs-token').count(), 0);
      assert.match(await page.locator('.fs-card-text').innerText(), /жетон кузницы/);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.fs-header').evaluate(node => node.inert), false);
      assert.equal(await page.locator('.fs-card').evaluate(node => node === document.activeElement), true);
    });
    await check('all three tokens compose from real card data with independent concurrent resolutions', async () => {
      const result = await page.evaluate(async () => {
        const general = await (await fetch('factions/general.json')).json();
        const mech = await (await fetch('factions/sow/adeptusmechanicus/text.json')).json();
        const inq = await (await fetch('factions/sow/inquisition/text.json')).json();
        const eventIndex = mech.eventsText.findIndex(c => c.general.includes('жетон запасов'));
        const event = { src: 'factions/sow/adeptusmechanicus/events/e_' + (eventIndex + 1) + '.jpg', kind: 'events', text: mech.eventsText[eventIndex], wording: 'icons' };
        let reinforcements;
        inq.combatText.forEach((tier, ti) => tier.forEach((c, i) => {
          if (!reinforcements && (c.general + c.unit).includes('жетон подкрепления')) {
            reinforcements = { src: 'factions/sow/inquisition/combat/' + general.filenames.combat[ti][i], kind: 'combat', text: { title: c.title, background: c.general, foreground: c.unit, icons: c.icons }, wording: 'icons' };
          }
        }));
        window.drawnText = [];
        const images = await Promise.all([
          window.FSCardRender.compose({ ...event, width: 450, height: 650 }),
          window.FSCardRender.compose({ ...event, width: 630, height: 880 }),
          window.FSCardRender.compose({ ...reinforcements, width: 450, height: 650 }),
        ]);
        const sizes = await Promise.all(images.map(url => new Promise(resolve => {
          const img = new Image(); img.onload = () => resolve([img.width, img.height]); img.src = url;
        })));
        return { sizes, glyphs: ['\uE100', '\uE101', '\uE102'].map(g => window.drawnText.some(text => text.includes(g))) };
      });
      assert.deepEqual(result.sizes, [[450, 650], [630, 880], [450, 650]]);
      assert.deepEqual(result.glyphs, [true, true, true]);
    });
    await check('canonical card links reopen the correct faction and card; Back closes the modal', async () => {
      await page.goto(base + cardLink); await waitCard(page);
      assert.match(await page.locator('[role=dialog]').getAttribute('aria-label'), /ПРЕВОСХОДСТВО МАШИНЫ/);
      await page.keyboard.press('Escape');
      await page.locator('.fs-card[data-card-id$="combat/t2_1.jpg"]').click(); await waitCard(page);
      await page.goBack();
      await page.waitForFunction(() => !document.querySelector('.fs-lb'));
      assert.equal(await page.locator('.fs-card[data-card-id$="combat/t2_1.jpg"]').evaluate(node => node === document.activeElement), true);
    });
    await check('FAQ permalinks reopen answers with accessible accordion state', async () => {
      await page.goto(base + '#view=faq');
      await page.locator('.fs-faq-qbtn').first().waitFor();
      const head = page.locator('.fs-faq-qbtn').first();
      assert.equal(await head.getAttribute('aria-expanded'), 'false');
      await head.click(); assert.equal(await head.getAttribute('aria-expanded'), 'true');
      assert.equal(await page.getByRole('link', { name: 'Ссылка на ответ', exact: true }).count(), 0);
      const link = page.url();
      await page.goto(link);
      await page.locator('.fs-faq-item.is-open .fs-faq-qbtn[aria-expanded=true]').waitFor();
      assert.equal(await page.locator('.fs-faq-item.is-open').count(), 1);
      const answerId = await page.locator('.fs-faq-item.is-open button').getAttribute('aria-controls');
      assert.equal(await page.locator('#' + answerId).evaluate(node => node.hidden), false);
      await page.reload(); await page.locator('.fs-faq-item.is-open').waitFor();
    });
    await check('reviewed FAQ answers link to the right card and distinguish note, card, and revision sources', async () => {
      const openAnswer = async name => {
        await page.goto(base + '#view=faq&faqQ=' + encodeURIComponent(name));
        const target = page.getByRole('button', { name, exact: true });
        await target.waitFor();
        assert.equal(await target.count(), 1, name);
        await target.click();
        return target.locator('..');
      };
      await openAnswer('Слава Императора');
      assert.match(await page.locator('.fs-faq-item.is-open .fs-faq-atext').innerText(), /переверните.*\[M\]/i);
      assert.match(await page.locator('.fs-faq-source').innerText(), /Note/);
      await page.locator('.fs-faq-card').click(); await waitCard(page);
      await page.waitForFunction(() => document.querySelector('[role=dialog]')?.getAttribute('aria-label').includes('Слава Императора'));
      await page.keyboard.press('Escape');
      await openAnswer('Мек Бойзы');
      assert.match(await page.locator('.fs-faq-source').innerText(), /Текст карточки/);
      await openAnswer('Превосходство Машины');
      assert.equal(await page.locator('.fs-faq-source').count(), 2);
      const sourceLabels = await page.locator('.fs-faq-source').allTextContents();
      assert.ok(sourceLabels.some(label => label.includes('прежняя редакция')));
      assert.ok(sourceLabels.some(label => label.includes('Актуальная редакция')));
      await openAnswer('Стрельба в Движении');
      assert.ok((await page.locator('.fs-faq-source').allTextContents()).includes('FAQ оригинального проекта'));
      const martyrAnswer = await openAnswer('Мученичество');
      await martyrAnswer.locator('.fs-faq-card').click(); await waitCard(page);
      assert.match(await page.locator('.fs-card-text').innerText(), /во время шага нанесения повреждений/);
      await page.locator('.fs-lb img').screenshot({ path: path.join(output, 'martyrdom-clarified.png'), animations: 'disabled' });
      await page.keyboard.press('Escape');
      await page.goto(base + '#view=faq&question=faq-dbe70dce');
      await page.locator('#question-faq-dbe70dce.is-open').waitFor();
      assert.equal(await page.locator('#question-faq-dbe70dce .fs-faq-q').innerText(), 'Обстрел');
    });
    await desktop.context.close();

    const lazy = await makeContext({ width: 1280, height: 800 }); active = lazy.page;
    await check('grids defer offscreen cards and render visible text in HD', async () => {
      const originals = [];
      lazy.page.on('request', r => { if (new URL(r.url()).pathname.startsWith('/factions/') && /\.jpg$/.test(r.url())) originals.push(r.url()); });
      await lazy.page.goto(base + '#q=' + encodeURIComponent('Получите'));
      await lazy.page.waitForFunction(() => document.querySelectorAll('.fs-card').length > 30 && !document.body.innerText.includes('Загрузка карточек…'));
      await lazy.page.waitForFunction(() => document.querySelectorAll('.fs-card img[src]').length > 0);
      const total = await lazy.page.locator('.fs-card').count(), loaded = await lazy.page.locator('.fs-card img[src]').count();
      assert.ok(loaded < total, `${loaded} loaded of ${total}`);
      await lazy.page.locator('.fs-card').last().scrollIntoViewIfNeeded();
      await lazy.page.waitForFunction(() => Array.from(document.querySelectorAll('.fs-card img')).at(-1)?.src.startsWith('data:image/png'));
      assert.ok(originals.length < total, `${originals.length} original images for ${total} cards`);
      console.log(`  Initially loaded ${loaded}/${total} grid images.`);
    });
    await lazy.context.close();

    const mobile = await makeContext({ width: 390, height: 844 }); active = mobile.page;
    await check('mobile card, wording control, text panel, and settings stay usable', async () => {
      await mobile.page.goto(base + cardLink); await waitCard(mobile.page);
      const bounds = await mobile.page.locator('.fs-lb img').boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391, JSON.stringify(bounds));
      assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 845, JSON.stringify(bounds));
      await mobile.page.locator('#fs-lb-wording').selectOption('icons'); await waitCard(mobile.page);
      await mobile.page.locator('.fs-card-text summary').click();
      assert.equal(await mobile.page.locator('.fs-card-text').getAttribute('open'), '');
      assert.equal(await mobile.page.locator('.fs-card-text [role=img]').count(), 1);
      await mobile.page.screenshot({ path: path.join(output, 'mobile.png'), animations: 'disabled' });
      await mobile.page.keyboard.press('Escape');
      await mobile.page.locator('.fs-settings summary').click();
      await mobile.page.locator('#fs-res-toggle').check();
      await mobile.page.locator('.fs-card[data-card-id$="combat/t2_1.jpg"]').click(); await waitCard(mobile.page);
      assert.ok(await mobile.page.locator('.fs-lb img').evaluate(img => img.naturalWidth >= img.getBoundingClientRect().width * 3));
    });
    await mobile.context.close();
    assert.deepEqual(errors, []);
    console.log(`${checks.length} browser checks passed; no JavaScript errors. Previews: ${output}`);
  } catch (error) {
    if (active && !active.isClosed()) await active.screenshot({ path: path.join(output, 'failure.png'), animations: 'disabled' });
    throw error;
  } finally {
    await browser.close(); await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
