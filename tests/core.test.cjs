const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const page = path.resolve(__dirname, '../page');
const context = { window: {}, URLSearchParams };
for (const file of ['cache', 'wording', 'navigation', 'faq']) vm.runInNewContext(fs.readFileSync(path.join(page, 'script', file + '.js'), 'utf8'), context);
const { FSCache, FSWord, FSNav, FS_FAQ } = context.window;

test('token wording handles Russian cases, English aliases, shared nouns, and quantities', () => {
  assert.equal(FSWord.format('Потратьте 1 жетон кузницы.', 'icons'), 'Потратьте 1\u00a0\uE100.');
  assert.equal(FSWord.format('2 жетона подкрепления; жетоны подкреплений', 'icons'), '2\u00a0\uE101; \uE101');
  assert.equal(FSWord.format('ЖЕТОН СКЛАДА, жетон запасов', 'icons'), '\uE102, \uE102');
  assert.equal(FSWord.format('жетоны склада/кузницы', 'icons'), '\uE102/\uE100');
  assert.equal(FSWord.format('1 forge token, 2 reinforcement tokens, cache tokens', 'icons'), '1\u00a0\uE100, 2\u00a0\uE101, \uE102');
  const explicit = 'Получите 1 жетон запасов и 1 жетон кузницы.';
  assert.equal(FSWord.format(explicit, 'explicit'), explicit);
  assert.equal(FSWord.format('жетон приказа из запаса; жетон подкреплениями', 'icons'), 'жетон приказа из запаса; жетон подкреплениями');
  assert.equal(FSWord.format('[FORGE] [REINFORCE] [CACHE]', 'explicit'), 'жетон кузницы жетон подкрепления жетон запасов');
  assert.equal(FSWord.format('1 жетон кузницы'), '1\u00a0\uE100');
  assert.equal(FSWord.format('1 жетон кузницы', 'images'), FSWord.format('1 жетон кузницы', 'icons'));
});

test('both token styles share canonical identities and real obverse image assets', () => {
  assert.equal(new Set(FSWord.tokens.map(t => t.image)).size, 3);
  for (const token of FSWord.tokens) {
    const bytes = fs.readFileSync(path.join(page, token.image));
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [260, 260]);
    assert.equal(bytes[25], 6, 'RGBA disc with transparent corners');
    assert.equal(FSWord.plain(FSWord.format(token.label, 'images')), token.label);
  }
});

test('Russian search is independent of ё/е, hyphenation, line-break markup, and token presentation', () => {
  assert.equal(FSWord.normalize('СЁСТРЫ *newpara* БИТВЫ'), FSWord.normalize('сестры битвы'));
  for (const name of ['Сикарийцы-Лазутчики', 'Сикарийцы\u2011Лазутчики', 'Сикарийцы – Лазутчики']) {
    assert.equal(FSWord.normalize(name), FSWord.normalize('сикарийцы лазутчики'));
  }
  assert.equal(FSWord.normalize('1 \uE100'), FSWord.normalize('1 жетон кузницы'));
  assert.equal(FSWord.plain('Текст *newline* Продолжение'), 'Текст\nПродолжение');
});

test('bounded caches evict the least recently used entry, including after reads', () => {
  const cache = FSCache.create(2);
  cache.set('a', 1); cache.set('b', 2); cache.get('a'); cache.set('c', 3);
  assert.equal(cache.get('b'), undefined); assert.equal(cache.get('a'), 1);
  for (let i = 0; i < 1000; i++) cache.set(String(i), i);
  assert.equal(cache.size, 2); cache.clear(); assert.equal(cache.size, 0);
});

test('card and FAQ routes round-trip Unicode searches and real asset filenames', () => {
  const state = { view: 'codex', expansion: 'sow', faction: 'adeptusmechanicus', category: 'combat', cardQuery: 'кузницы & отряды' };
  const card = 'factions/sow/adeptusmechanicus/combat/t2_1.jpg';
  const restored = FSNav.read(FSNav.write(state, card));
  assert.equal(restored.card, card); assert.equal(restored.cardQuery, state.cardQuery);
  assert.equal(restored.expansion, 'sow'); assert.equal(restored.category, 'combat');
  const faq = FSNav.read(FSNav.write({ view: 'faq', faqTopic: 'all', faqQuery: 'ё/е' }, null, 'note-123'));
  assert.equal(faq.view, 'faq'); assert.equal(faq.faqQuery, 'ё/е'); assert.equal(faq.question, 'note-123');
});

test('FAQ identities are unique and survive insertion before existing questions', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(page, 'data/FAQ.json'), 'utf8'));
  const flatten = data => FS_FAQ.flatten(data).cats.flatMap(c => c.subs.flatMap(s => s.factions.flatMap(f => f.items)));
  const before = flatten(raw);
  assert.equal(new Set(before.map(q => q.id)).size, before.length);
  raw[0].items[0].items[0].items.unshift({ Phrase: 'Новый тестовый вопрос', Main: 'Ответ' });
  const after = flatten(raw).slice(1);
  before.forEach((q, i) => assert.equal(after[i].id, q.id));
});

test('every generated thumbnail matches an existing source asset and its byte size', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(page, 'thumbnails/manifest.json'), 'utf8'));
  assert.ok(Object.keys(manifest).length > 400);
  for (const [file, entry] of Object.entries(manifest)) {
    assert.equal(fs.statSync(path.join(page, file)).size, entry.sourceBytes, 'Rebuild changed source: ' + file);
    assert.equal(fs.statSync(path.join(page, 'thumbnails', file)).size, entry.thumbnailBytes);
    assert.ok(entry.thumbnailBytes < entry.sourceBytes, file);
  }
});
