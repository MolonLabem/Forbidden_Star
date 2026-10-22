const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const review = read('upstream/fs-league-review.json');
const faq = read('page/data/FAQ.json');
const entries = faq.flatMap(c => c.items.flatMap(s => s.items.flatMap(f => f.items.map(q => ({ c, s, f, q })))));
const questions = entries.map(e => e.q);
const question = name => questions.find(q => q.Phrase === name);
const norm = text => text.toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/[^a-zа-я0-9]/g, '');

test('restored review matches the recorded live verification of all 336 sources', () => {
  const verified = read('upstream/fs-league-verification.json');
  assert.equal(verified.summary.retrieved, review.records.length);
  assert.equal(verified.summary.noteRecords, 140);
  assert.equal(verified.summary.errors, 0);
  const sources = new Map(verified.records.map(record => [record.source, record]));
  assert.equal(sources.size, review.records.length);
  for (const record of review.records) {
    const actual = sources.get(record.source);
    assert.ok(actual, record.card);
    assert.equal(actual.card, record.card);
    assert.equal(actual.noteSha256, record.noteSha256);
    assert.equal(actual.libraryCardSha256, record.libraryCardSha256);
    assert.ok(actual.titleMatches && actual.noteMatches && actual.cardMatches);
  }
});

test('the complete Classic inventory maps one-to-one to existing local card assets', () => {
  assert.equal(review.records.length, 336);
  assert.equal(new Set(review.records.map(r => r.card)).size, review.records.length);
  assert.equal(new Set(review.records.map(r => r.source)).size, review.records.length);
  assert.equal(new Set(review.records.map(r => r.faction)).size, 12);
  for (const record of review.records) {
    assert.ok(fs.existsSync(path.join(root, 'page/factions', record.card)), record.card);
    assert.doesNotMatch(record.card, /^dd\//);
    assert.match(record.noteSha256, /^[a-f0-9]{64}$/);
  }
  assert.equal(review.records.filter(r => r.note).length, 140);
  assert.equal(review.coverage.notRepresented.length, 4);
});

test('FAQ source identities, card titles, and categories agree with the reviewed card', () => {
  const bySource = new Map(review.records.map(r => [r.source, r]));
  const names = read('page/data/cardnames.json');
  const defaults = read('page/factions/general.json').filenames;
  const sections = { combat: 'Боевые карты', events: 'Карты событий', orders: ['Приказы', 'Улучшения приказов'] };
  for (const { s, q } of entries.filter(e => e.q.Card)) {
    const record = bySource.get(q.CardSource);
    assert.ok(record, q.Phrase); assert.equal(q.Card, record.card, q.Phrase);
    if (q.Source) { assert.equal(q.Source, q.CardSource); assert.equal(record.note, true); }
    const [exp, fac, category, file] = q.Card.split('/');
    if (category === 'faction_card') continue;
    assert.ok([].concat(sections[category]).includes(s.SubCategory), q.Phrase);
    const data = read(`page/factions/${exp}/${fac}/text.json`);
    const filenames = { ...defaults, ...data.filenames };
    let title = names[q.Card];
    if (category === 'combat') filenames.combat.forEach((files, tier) => {
      const i = files.indexOf(file); if (i >= 0) title = data.combatText?.[tier]?.[i]?.title || title;
    });
    else title = data[category === 'events' ? 'eventsText' : 'ordersText']?.[filenames[category].indexOf(file)]?.title || title;
    assert.equal(norm(q.Phrase), norm(title), q.Phrase + ' → ' + q.Card);
  }
});

test('card-specific fixes distinguish conversion, die types, ownership, and attack bonuses', () => {
  assert.match(question('Слава Императора').Main, /переверните.*\[M\]/i);
  assert.doesNotMatch(question('Слава Императора').Main, /Можно перебросить/);
  assert.match(question('Благословенная Броня').Main, /перевернуть.*\[S\]/i);
  assert.match(question('Мек Бойзы').Main, /верхнюю карту своей боевой колоды/);
  assert.match(question('Мек Бойзы').Main, /сама карта.*не добавляется/);
  assert.match(question('Гретчины').Main, /собственных|собственный/);
  assert.match(question('Поддержка Титана').Main, /переброса 1 \[B\]/);
  assert.match(question('Тяжелые Расчеты').Main, /1 ваш \[S\]/);
  assert.match(question('Шрайки').Main, /\+2 к значению атаки в следующем раунде/);
  assert.match(question('Тактический Гений').Main, /Порядок выбора по Note FS League/);
  assert.match(question('Тактический Гений').Main, /до того, как любой игрок выберет/);
  assert.match(question('Ударь и Беги').Main, /жетоны подкрепления.*нельзя/i);
  assert.equal(question('Ударь и Беги').RelatedSources.length, 1);
});

test('translated cards and FAQ retain current triggers and the newer Adeptus rules', () => {
  const mech = read('page/factions/sow/adeptusmechanicus/text.json');
  assert.equal(mech.combatText[0][0].title, 'СКИТАРИИ-РЕЙНДЖЕРЫ');
  assert.match(mech.combatText[0][0].general, /предыдущем раунде/);
  assert.equal(mech.combatText[0][3].title, 'СИКАРИЙЦЫ-ЛАЗУТЧИКИ');
  assert.match(mech.combatText[0][3].general, /закрытую боевую карту/);
  const martyrdom = read('page/factions/sow/adeptasororitas/text.json').combatText.flat().find(c => c.title === 'МУЧЕНИЧЕСТВО');
  assert.match(martyrdom.unit, /во время шага нанесения повреждений/);
  assert.match(question('Мученичество').Main, /именно на шаге нанесения повреждений/);
  assert.match(mech.ordersText[0].general, /раскрываете этот жетон приказа/);
  assert.match(question('Кибернетическая Принадлежность').Main, /при раскрытии/);
  assert.match(question('Превосходство Машины').Main, /1 жетон кузницы.*все свои отряды/);
  assert.ok(questions.filter(q => q.RuleSource).every(q => !q.Source && q.RuleSource.endsWith(read('upstream/sync.json').reviewedCommit)));
});

test('renamed, moved, and newly sourced answers retain their original permalink IDs', () => {
  const context = { window: {}, URLSearchParams };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'page/script/navigation.js'), 'utf8'), context);
  const expected = [
    ['Осквернение Хаоса (Доминирование)', 'Приказы', 'Хаос', 'Осквернение Хаоса (Доминирование)'],
    ['Рейд Корсаров', 'Боевые карты', 'Эльдар', 'Рейд Корсаров'],
    ['Обстрел', 'Приказы', 'Эльдар', 'Стремительный бег'],
  ];
  for (const [name, sub, faction, phrase] of expected) {
    assert.equal(question(name).Id, context.window.FSNav.faqId('База', sub, faction, phrase));
  }
});
