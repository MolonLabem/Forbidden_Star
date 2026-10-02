const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const page = path.resolve(__dirname, '../page');
const read = relative => JSON.parse(fs.readFileSync(path.join(page, relative), 'utf8'));
const names = read('data/cardnames.json');
const faq = read('data/FAQ.json');
const questions = faq.flatMap(c => c.items.flatMap(s => s.items.flatMap(f => f.items)));

for (const faction of read('factions/tdl/faction.json').folder) {
  test(`TDL ${faction}: manifests reference real images and searchable starter names`, () => {
    const filenames = read(`factions/tdl/${faction}/text.json`).filenames;
    const folders = { combat: 'combat', orders: 'orders', events: 'events', backs: 'backs', faction_card: 'faction_card', map: 'maps' };
    for (const [category, folder] of Object.entries(folders)) {
      const files = category === 'combat' ? filenames.combat.flat() : filenames[category];
      assert.ok(files.length, `Empty ${category}`);
      for (const file of files) {
        assert.ok(fs.existsSync(path.join(page, 'factions/tdl', faction, folder, file)), `Missing ${folder}/${file}`);
      }
    }
    for (const file of filenames.combat[0]) assert.ok(names[`tdl/${faction}/combat/${file}`], `Missing name for ${file}`);
  });
}

test('FAQ preserves Note provenance through flattening and excludes mod content', () => {
  const sourced = questions.filter(q => q.Source);
  assert.equal(sourced.length, 139);
  assert.equal(new Set(sourced.map(q => q.Source)).size, sourced.length);
  for (const q of questions) {
    assert.ok(q.Phrase && q.Main);
    assert.doesNotMatch(q.Phrase + ' ' + q.Main, /RNB|\bTTS\b|\bmod\b|\bмод\b/i);
    if (q.Source) assert.match(q.Source, /^https:\/\/fixed-crane-287\.notion\.site\/[a-f0-9]{32}$/);
  }
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(page, 'script/faq.js'), 'utf8'), context);
  const flattened = context.window.FS_FAQ.flatten(faq);
  const items = flattened.cats.flatMap(c => c.subs.flatMap(s => s.factions.flatMap(f => f.items)));
  assert.equal(flattened.count.all, questions.length);
  assert.equal(items.length, questions.length);
  questions.forEach((q, i) => {
    assert.equal(items[i].q, q.Phrase);
    assert.equal(items[i].a, q.Main);
    assert.equal(items[i].source, q.Source || '');
  });
});

test('sourced Symphony of War card titles follow text.json', () => {
  const factions = { 'Сёстры Битвы': 'adeptasororitas', 'Тёмные Эльдар': 'darkeldar', 'Адептус Механикус': 'adeptusmechanicus', 'Инквизиция': 'inquisition' };
  for (const sub of faq.find(c => c.Category.startsWith('Symphony')).items) {
    if (sub.SubCategory === 'Способности фракций') continue;
    for (const faction of sub.items) {
      const data = read(`factions/sow/${factions[faction.Faction]}/text.json`);
      const titles = ['combatText', 'ordersText', 'eventsText'].flatMap(k => data[k].flat().map(c => c.title.toLocaleLowerCase('ru')));
      for (const item of faction.items.filter(i => i.Source)) assert.ok(titles.includes(item.Phrase.toLocaleLowerCase('ru')), item.Phrase);
    }
  }
});
