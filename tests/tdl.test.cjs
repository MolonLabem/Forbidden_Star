const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const read = p => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const review = read('reports/tdl/translations.json');
const before = read('reports/tdl/sync-before.json');
const baseline = read('upstream/baseline.json');
const { localPath } = require('../tools/upstream-sync.cjs');
const counts = { adeptuscustodes:[14,6,8], genestealercult:[14,6,8], thousandsons:[14,5,9], leaguesofvotann:[17,6,8] };

test('all 143 pinned TDL sources match their Git blobs and preserve established URLs', () => {
  assert.equal(before.assets.length,143);
  assert.equal(read('upstream/sync.json').reviewedCommit, review.commit);
  for (const item of before.assets) {
    assert.equal(localPath(item.upstream),item.local,item.upstream);
    const bytes=fs.readFileSync(path.join(root,item.local));
    const sha=crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    assert.equal(sha,item.after,item.local);
    assert.equal(sha,baseline.assets[item.upstream]);
  }
});

test('115 Russian fronts align with manifests, source transcripts and card names', () => {
  const names=read('page/data/cardnames.json'), ids=[];
  for (const [fac,expected] of Object.entries(counts)) {
    const d=read(`page/factions/tdl/${fac}/text.json`);
    assert.ok(d.rasterText);
    assert.equal(d.tierLabels.length,d.filenames.combat.length);
    ['combat','orders','events'].forEach((cat,i)=>{
      const files=d.filenames[cat].flat(),texts=d[cat+'Text'].flat();
      assert.equal(files.length,expected[i]);assert.equal(texts.length,files.length);
      files.forEach((file,j)=>{
        const id=`tdl/${fac}/${cat}/${file}`,text=texts[j],record=review.cards[id];ids.push(id);
        assert.ok(record,id);assert.match(text.title,/[А-ЯЁ]/);
        assert.equal(names[id].toLocaleUpperCase('ru'),text.title.toLocaleUpperCase('ru'));
        for (const field of ['title','general',...(cat==='combat'?['unit']:[])]) assert.equal(text[field],record.ru[field],id+' '+field);
        assert.equal(text.source,record.source);
        assert.match(record.source,new RegExp(`/blob/${review.commit}/page/factions/dl/`));
        assert.equal(record.status,'draft-for-approval');
        assert.ok(record.en.title && (record.en.general || record.en.unit));
        for (const s of Object.values(text).filter(v=>typeof v==='string')) {
          assert.doesNotMatch(s,/[\uE100-\uE102]/,'Canonical data must use explicit token names');
          for (const marker of s.matchAll(/\[([A-Z]+)\]/g)) assert.ok(['D','M','B','S','FORGE','REINFORCE','CACHE'].includes(marker[1]),id);
        }
      });
    });
  }
  assert.equal(ids.length,115);assert.equal(new Set(ids).size,115);
  assert.deepEqual(new Set(ids),new Set(Object.keys(review.cards)));
});

test('faction sheets, maps and miniature counts have Russian text without replacing source images', () => {
  for (const fac of Object.keys(counts)) {
    const d=read(`page/factions/tdl/${fac}/text.json`),up=baseline.documents[`page/factions/dl/${fac}/text.json`];
    assert.deepEqual(d.materialsText.map(x=>x.value),up.materialsText.map(x=>x.value));
    assert.equal(Object.keys(d.componentsText).length,4);
    for (const [file,component] of Object.entries(d.componentsText)) {
      assert.ok(fs.existsSync(path.join(root,`page/factions/tdl/${fac}/${file}`)));
      assert.ok(component.aspect>0);
      if (file.startsWith('maps/')) {
        assert.ok(component.notice); assert.match(component.general,/[А-Яа-яЁё]/);
        assert.equal(component.general,component.names.map(n=>n.originalName+' — '+n.ruDraft).join(' *newpara* '));
        assert.deepEqual(component.names,review.maps[fac][path.basename(file)]);
      }
      else { assert.ok(component.regions.length); assert.equal(component.general,component.regions.map(r=>r.value).join(' *newpara* ')); }
      for (const r of component.regions) {
        assert.ok(r.box.every(n=>Number.isFinite(n)&&n>=0&&n<=1));
        assert.ok(r.box[0]+r.box[2]<=1 && r.box[1]+r.box[3]<=1);
        assert.match(r.value,/[А-Яа-яЁё]/);
      }
    }
  }
});

test('translation preserves critical TDL distinctions identified in source review', () => {
  const c=review.cards;
  assert.match(c['tdl/adeptuscustodes/combat/t3_1.jpg'].ru.unit,/12/);
  assert.match(c['tdl/adeptuscustodes/orders/o_1.jpg'].ru.general,/ОДИН РАЗ ЗА ИГРУ/);
  assert.doesNotMatch(c['tdl/thousandsons/events/e_1.jpg'].ru.general,/прочие планы/);
  assert.match(c['tdl/thousandsons/combat/t2_3.jpg'].ru.unit,/\[M\] противника/);
  assert.match(c['tdl/leaguesofvotann/combat/s1.jpg'].ru.general,/1 \(S\).*1 \[S\]/);
  assert.match(c['tdl/leaguesofvotann/orders/o_6.jpg'].ru.general,/2 \[S\]/);
  assert.match(c['tdl/genestealercult/combat/t2_2.jpg'].ru.unit,/недеморализованным.*уровнем 0/);
});
