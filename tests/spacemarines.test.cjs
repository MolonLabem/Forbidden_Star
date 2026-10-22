const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const page=path.resolve(__dirname,'../page');
const read=file=>JSON.parse(fs.readFileSync(path.join(page,file),'utf8'));
const data=read('factions/base/spacemarines/text.json'),files=read('factions/general.json').filenames;
const rows=['combat','orders','events'].flatMap(category=>files[category].flat().map((file,index)=>({
 category,file,id:category+'/'+file,text:data[category+'Text'].flat()[index],template:data.templates[category+'/'+file],
})));

test('Space Marines have exactly 27 structured cards in the established manifest order',()=>{
 assert.deepEqual([data.combatText.map(t=>t.length),data.ordersText.length,data.eventsText.length],[[5,4,3,2],5,8]);
 assert.equal(rows.length,27);assert.equal(Object.keys(data.templates).length,27);
 const names=read('data/cardnames.json');
 for(const row of rows){assert.equal(row.text.title,names['base/spacemarines/'+row.id]);assert.ok(row.text.general);if(row.category==='combat')assert.ok(row.text.unit);}
 assert.equal(data.cardAspect,451/640);
 assert.deepEqual(data.eventsText.map(t=>t.type),['ПЛАН','ПЛАН','ПЛАН','ПЛАН','ТАКТИКА','ТАКТИКА','ТАКТИКА','ТАКТИКА']);
});

test('the approved current-Russian wording preserves die types, actions and unit names',()=>{
 const lookup=id=>rows.find(r=>r.id===id).text;
 assert.match(lookup('orders/o_4.jpg').general,/перевернуть 1 ваш \[M\] на 1 \[B\]/);
 assert.match(lookup('orders/o_5.jpg').general,/потратить 2 \[S\]/);
 assert.match(lookup('combat/t2_2.jpg').general,/до 3 \[M\].*потраченный \[M\].*1 \[B\] или 1 \[S\]/);
 assert.match(lookup('combat/t3_2.jpg').unit,/Титан Полководец\/Боевая Баржа/);
 assert.match(lookup('combat/t3_2.jpg').unit,/переверните любые ваши кубы на \[M\]/);
 assert.match(lookup('events/e_4.jpg').general,/перевернуть все ваши кубы на \[B\] вместо броска/);
 assert.match(lookup('events/e_3.jpg').general,/восстановить 1 ваш отряд/);
 const wording=structuredClone({combatText:data.combatText,ordersText:data.ordersText,eventsText:data.eventsText});
 // Only this owner-requested title punctuation differs from the approved raster
 // wording. Keep the fingerprint protecting every other title and all rules.
 wording.combatText[1][3].title=wording.combatText[1][3].title.replace('Разведчики-Ветераны','Разведчики Ветераны');
 assert.equal(crypto.createHash('sha256').update(JSON.stringify(wording)).digest('hex'),'1e0263e8ca85b727f63f6ab66504212435cff5081d689f9d7cfb7731d760d898');
});

test('every migrated card cites its unchanged Russian image rather than library variants',()=>{
 assert.equal(data.wordingSource.kind,'current-russian-raster');
 assert.equal(Object.keys(data.wordingSource.imageSha256).length,27);
 for(const row of rows){
  const relative='factions/base/spacemarines/'+row.id,bytes=fs.readFileSync(path.join(page,relative));
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),data.wordingSource.imageSha256[row.id]);
  assert.equal(row.text.source,'https://github.com/MolonLabem/Forbidden_Star/blob/'+data.wordingSource.revision+'/page/'+relative);
  assert.doesNotMatch(JSON.stringify(row.text),/notion\.site|libraryText|[\uE100-\uE102]/);
 }
});

test('templates preserve native icon strips, white type plaques and valid source crops',()=>{
 for(const row of rows){
  assert.ok(row.template);
  for(const patch of row.template.patches){
   assert.ok(fs.existsSync(path.join(page,patch.texture.src)),patch.texture.src);
   for(const box of [patch.box,patch.texture.crop]){
    assert.equal(box.length,4);assert.ok(box.every(v=>Number.isFinite(v)&&v>=0&&v<=1));
    assert.ok(box[0]+box[2]<=1.001&&box[1]+box[3]<=1.001);
   }
  }
  if(row.category==='combat'){
   assert.equal(row.text.icons,'');assert.ok(row.template.combatArt.rail);
   const erasure=row.template.patches.find(p=>p.role==='combat-erasure');
   const crop=row.template.combatArt.crop;assert.ok(crop[1]+crop[3]<erasure.box[1]);
  }
  if(row.category==='events')assert.equal(row.template.patches.find(p=>p.role==='event-type').texture.src,'factions/base/spacemarines/'+row.id);
 }
});
