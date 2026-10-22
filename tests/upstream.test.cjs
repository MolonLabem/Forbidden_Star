const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { compareSnapshots, localPath, renderReport, supported } = require('../tools/upstream-sync.cjs');
const config = require('../upstream/sync.json');
const baseline = require('../upstream/baseline.json');
const adeptus = 'page/factions/sow/adeptus_mechanicus/text.json';

test('reviewed source is pinned and Darkest Dawn is permanently excluded', () => {
  assert.equal(config.reviewedCommit, baseline.commit);
  assert.ok(config.ignoredExpansions.includes('dd'));
  assert.equal(supported('page/factions/dd/worldeaters/text.json'), false);
  assert.equal(localPath('page/factions/dd/worldeaters/combat/s1.jpg'), null);
  assert.ok(Object.keys(baseline.documents).every(file => !file.includes('/dd/')));
});

test('a rule report identifies both Adeptus changes by filename, despite empty tiers', () => {
  const before = structuredClone(baseline);
  const data = before.documents[adeptus];
  data.ordersText[0].general = data.ordersText[0].general.replace('When you reveal this order token', 'After you resolve this order');
  data.combatText[3][0].general = data.combatText[3][0].general.replace('1 forge token to rally all of your units', '1 [M] to rally 1 of your units');
  const result = compareSnapshots(before, baseline);
  assert.equal(result.changes.length, 2);
  assert.deepEqual(result.changes.map(c => c.local).sort(), [
    'page/factions/sow/adeptusmechanicus/combat/t2_1.jpg',
    'page/factions/sow/adeptusmechanicus/orders/o_1.jpg',
  ]);
  const reordered = structuredClone(baseline);
  const manifest = reordered.documents['page/factions/general.json'].filenames.combat;
  manifest.splice(2, 1);
  for (const [file, document] of Object.entries(reordered.documents)) {
    if (file.includes('/sow/') && document.combatText) document.combatText.splice(2, 1);
  }
  assert.equal(compareSnapshots(baseline, reordered).changes.length, 0);
});

test('excluded expansion changes do not appear in reports, including shared metadata', () => {
  const after = structuredClone(baseline);
  after.documents['page/factions/dd/worldeaters/text.json'] = { ordersText: [{ title: 'EXCLUDED', general: 'Ignored' }] };
  after.assets['page/factions/dd/worldeaters/combat/s1.jpg'] = 'new-sha';
  after.documents['page/factions/general.json'].expansion.folder.push('dd');
  after.documents['page/factions/general.json'].expansion.name.push('Darkest Dawn');
  const report = renderReport(baseline, after);
  assert.match(report, /No upstream changes/);
  assert.doesNotMatch(report, /Darkest Dawn|EXCLUDED|worldeaters/);
});

test('image and non-rule metadata changes are surfaced for manual review', () => {
  const after = structuredClone(baseline);
  const file = 'page/factions/dl/adeptuscustodes/combat/s_1.jpg';
  after.assets[file] = 'new-image-sha';
  after.documents[adeptus].materialsText[0].value = '9';
  const result = compareSnapshots(baseline, after);
  assert.deepEqual(result.assets, [file]);
  assert.deepEqual(result.metadata, [adeptus]);
  assert.equal(localPath(file), 'page/factions/tdl/adeptuscustodes/combat/s1.jpg');
});
