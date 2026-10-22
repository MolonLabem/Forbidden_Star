// Original token images and monochrome glyphs share one card layout.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../page');
const output = process.env.BROWSER_OUTPUT || '/tmp/forbidden-star-tokens';
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };

(async () => {
  await fs.mkdir(output, { recursive: true });
  const server = http.createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(root + path.sep)) throw new Error('Invalid path');
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }).end(await fs.readFile(file));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const errors = [];
  async function context(viewport = { width: 1440, height: 1000 }) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 });
    await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    return { ctx, page };
  }
  const ready = page => page.waitForFunction(() => document.querySelector('.fs-lb-imgwrap.is-ready img')?.naturalWidth > 0);
  const url = (faction, category, file) => base + '#exp=' + faction.split('/')[0] + '&faction=' + faction.split('/')[1] + '&category=' + category + '&card=' + encodeURIComponent('factions/' + faction + '/' + category + '/' + file);
  const mech = url('sow/adeptusmechanicus', 'events', 'e_7.jpg');
  const reinforcement = url('base/spacemarines', 'orders', 'o_1.jpg');
  try {
    const main = await context();
    await main.page.goto(base);
    await main.page.waitForFunction(() => !!window.FSCardRender && !!window.FSWord);
    const result = await main.page.evaluate(async () => {
      const general = await (await fetch('factions/general.json')).json();
      const cards = [];
      for (const expansion of general.expansion.folder) {
        const factions = await (await fetch('factions/' + expansion + '/faction.json')).json();
        for (const faction of factions.folder) {
          const folder = 'factions/' + expansion + '/' + faction + '/';
          const data = await (await fetch(folder + 'text.json')).json();
          const filenames = { ...general.filenames, ...data.filenames };
          for (const kind of ['combat', 'orders', 'events']) {
            if (!data[kind + 'Text']) continue;
            const rows = data[kind + 'Text'].flat();
            filenames[kind].flat().forEach((file, i) => {
              const row = rows[i];
              const text = kind === 'combat' ? { title: row.title, background: row.general, foreground: row.unit, icons: row.icons, raster: !!data.rasterText } : row;
              if (/[\uE100-\uE102]/.test(FSWord.format([row.general, row.unit].join(' ')))) {
                const aspect = data.cardAspect || 450 / 650;
                cards.push({ src: folder + kind + '/' + file, kind, text, template: data.templates?.[kind + '/' + file], width: 816, height: Math.round(816 / aspect) });
              }
            });
          }
        }
      }
      const rendered = [];
      for (const card of cards) {
        const before = JSON.stringify(localStorage);
        let icons, images;
        const mono = await FSCardRender.compose(card, { strict: true, onMetrics: m => { icons = m; } });
        const colour = await FSCardRender.compose({ ...card, wording: 'images' }, { strict: true, onMetrics: m => { images = m; } });
        const glyphs = FSWord.format([card.text.background, card.text.foreground, card.text.general].filter(Boolean).join(' ')).match(/[\uE100-\uE102]/g) || [];
        const bounds = images.tokenImages;
        delete images.tokenImages;
        rendered.push({ card: card.src, different: mono !== colour, sameLayout: JSON.stringify(icons) === JSON.stringify(images), expected: glyphs.length, drawn: bounds.length, settingsUnchanged: before === JSON.stringify(localStorage) });
      }
      return rendered;
    });
    assert.ok(result.length > 25, 'Exercise the real token-bearing card inventory');
    for (const row of result) {
      assert.equal(row.different, true, row.card);
      assert.equal(row.sameLayout, true, row.card);
      assert.equal(row.drawn, row.expected, row.card);
      assert.equal(row.settingsUnchanged, true, row.card);
    }
    console.log(`PASS ${result.length} real cards: default font icons and original images share layout; all tokens drawn; settings unchanged`);
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      await main.page.setViewportSize(viewport);
      for (const [link, count, name] of [[mech, 2, 'forge-cache'], [reinforcement, 1, 'reinforcement']]) {
        await main.page.goto(link); await ready(main.page);
        for (const mode of ['icons', 'images']) {
          await main.page.locator('#fs-lb-wording').selectOption(mode); await ready(main.page);
          await main.page.locator('.fs-card-text').evaluate(node => { node.open = true; });
          assert.equal(await main.page.locator('.fs-card-text .fs-token').count(), count);
          if (mode === 'images') {
            await main.page.waitForFunction(count => document.querySelectorAll('.fs-card-text .has-image').length === count, count);
            assert.equal(await main.page.locator('.fs-card-text .fs-token-image').count(), count);
            assert.ok(await main.page.locator('.fs-card-text .fs-token-image').evaluateAll(nodes => nodes.every(img => img.naturalWidth === 260 && img.getBoundingClientRect().width > 10)));
          }
          const fits = await main.page.locator('.fs-lb-imgwrap > img').evaluate(img => { const r = img.getBoundingClientRect(); return r.x >= 0 && r.y >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1; });
          assert.equal(fits, true);
          await main.page.screenshot({ path: path.join(output, `${name}-${mode}-${viewport.width}.png`), animations: 'disabled' });
        }
      }
    }
    console.log('PASS desktop/mobile cards, accessible token labels and original-image spans in both styles');
    await main.ctx.close();

    const slow = await context();
    await slow.page.addInitScript(() => localStorage.setItem('forbidden-stars.token-style', 'images'));
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await slow.page.route('**/pictures/tokens/forge.png', async route => { await gate; await route.continue(); });
    await slow.page.goto(mech, { waitUntil: 'domcontentloaded' });
    await slow.page.locator('.fs-lb-imgwrap.is-loading').waitFor();
    assert.equal(await slow.page.locator('.fs-lb-imgwrap > img').evaluate(img => getComputedStyle(img).visibility), 'hidden');
    release(); await ready(slow.page);
    await slow.ctx.close();
    console.log('PASS incomplete token-image loading keeps the card loader visible until composition completes');

    const failed = await context();
    await failed.page.addInitScript(() => localStorage.setItem('forbidden-stars.token-style', 'images'));
    let missing = true;
    await failed.page.route('**/pictures/tokens/forge.png', route => missing ? route.fulfill({ status: 404, body: '' }) : route.continue());
    await failed.page.goto(mech);
    await failed.page.locator('.fs-lb-imgwrap.is-error').waitFor();
    assert.equal(await failed.page.locator('.fs-lb-imgwrap > img').getAttribute('src'), null, 'Never return a partly rendered card with a missing token');
    missing = false;
    await failed.page.getByRole('button', { name: 'Повторить загрузку', exact: true }).click(); await ready(failed.page);
    await failed.ctx.close();
    console.log('PASS missing token images fail explicitly and retry successfully');
    assert.deepEqual(errors, []);
    console.log('PASS no JavaScript errors');
  } finally {
    await browser.close(); await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
