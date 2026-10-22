const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const page=path.resolve(__dirname,'../page'),read=p=>JSON.parse(fs.readFileSync(path.join(page,p),'utf8'));
const hashes={
 'base/chaos':'99925849b1c50d91e8196de4967710b8a91b91ae8522dda4ce87f224bca49b5c',
 'base/ork':'5eecea8859f39a41502dd89b25c9a70b15b010e363b851727abdc5b7119dc579',
 'base/eldar':'e3a5a9df1c6a1e794dd9f2834e5c5c97c2595b60efeb1a99881dcaa7fcc835e4',
 'gif/ig':'7dad38d99c9b71f64d50d7897a782d56ffcbf8ec0c0a6c659cb6aa444c2db77f',
 'gif/necron':'63567b8403ce69007e84a353d7814e57614966024a295d733ecb5833ecb8b38a',
 'gif/tau':'245dc73d0c355b2ea72169aebaee90307ca50e88834511bf246ab66e6340b5a4',
 'gif/tyranid':'df5833246a6ab4c0558ca6d0a572629fe4cc40771fd4ec43531b773423257321',
};
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const defaults=read('factions/general.json').filenames,names=read('data/cardnames.json');
function dimensions(b){
 if(b.toString('ascii',1,4)==='PNG')return [b.readUInt32BE(16),b.readUInt32BE(20)];
 assert.equal(b.readUInt16BE(0),0xffd8);
 for(let i=2;i<b.length;){
  assert.equal(b[i],0xff);const marker=b[i+1],size=b.readUInt16BE(i+2);
  if([0xc0,0xc1,0xc2].includes(marker))return [b.readUInt16BE(i+7),b.readUInt16BE(i+5)];
  i+=2+size;
 }
 throw Error('Missing native dimensions');
}
for(const [fac,hash] of Object.entries(hashes))test(fac+': complete Russian-only migration, unchanged faces and native rendering proportions',()=>{
 const d=read('factions/'+fac+'/text.json'),files={...defaults,...d.filenames};
 assert.deepEqual(d.combatText.map(t=>t.length),[5,4,3,2]);assert.equal(d.ordersText.length,5);assert.equal(d.eventsText.length,8);
 assert.equal(Object.keys(d.templates).length,27);assert.equal(Object.keys(d.wordingSource.imageSha256).length,27);
 assert.equal(d.wordingSource.kind,'current-russian-raster');
 // This fingerprint guards the manually read transcription; it does not assert
 // that the underlying Russian translation or game rule has been audited.
 assert.equal(sha(JSON.stringify(Object.fromEntries(['combatText','ordersText','eventsText'].map(c=>[c,d[c]])))),hash);
 for(const cat of ['combat','orders','events'])for(const [index,file] of files[cat].flat().entries()){
  const rel=cat+'/'+file,id=fac+'/'+rel,row=d[cat+'Text'].flat()[index],t=d.templates[rel],source='factions/'+id;
  assert.equal(row.title,names[id]);assert.ok(row.general||row.unit);assert.ok(t);
  assert.doesNotMatch(JSON.stringify({row,t}),/notion\.site|libraryText|\.\.\/reports\/|[\uE100-\uE102]/);
  const original=fs.readFileSync(path.join(page,source));
  assert.equal(sha(original),d.wordingSource.imageSha256[rel]);assert.deepEqual(dimensions(original),d.wordingSource.imageDimensions[rel]);
  assert.equal(row.source,'https://github.com/MolonLabem/Forbidden_Star/blob/'+d.wordingSource.revision+'/page/'+source);
  const [w,h]=dimensions(fs.readFileSync(path.join(page,t.picture||source)));assert.equal(row.aspect,w/h);
  for(const p of t.patches){
   assert.ok(fs.existsSync(path.join(page,p.texture.src)),id+' donor');
   for(const b of [p.box,p.texture.crop]){assert.equal(b.length,4);assert.ok(b.every(v=>Number.isFinite(v)&&v>=0&&v<=1));assert.ok(b[0]+b[2]<=1.001&&b[1]+b[3]<=1.001);}
  }
  if(cat==='combat'){
   assert.equal(row.icons,'');assert.ok(t.combatArt.rail);
   const c=t.combatArt.crop,erase=t.patches.find(p=>p.role==='combat-erasure');assert.ok(c[1]+c[3]<erase.box[1]);
  }
  if(cat==='events')assert.ok(['ПЛАН','ТАКТИКА'].includes(row.type));
 }
});
test('single-effect cards and faction-specific restrictions preserve their printed scope',()=>{
 const ork=read('factions/base/ork/text.json'),eldar=read('factions/base/eldar/text.json'),necron=read('factions/gif/necron/text.json'),tau=read('factions/gif/tau/text.json'),ig=read('factions/gif/ig/text.json'),tyranid=read('factions/gif/tyranid/text.json');
 assert.equal(ork.combatText[1][1].unit,'');for(const r of [ork.combatText[2][2],...ork.combatText[3]])assert.equal(r.general,'');
 assert.equal(eldar.combatText[0][3].unit,'');assert.equal(necron.combatText[0][0].general,'');assert.equal(necron.combatText[0][1].general,'');
 assert.deepEqual(necron.eventsText.map(r=>r.type),['ПЛАН','ПЛАН','ПЛАН','ПЛАН','ПЛАН','ПЛАН','ТАКТИКА','ТАКТИКА']);
 for(const row of tau.eventsText.slice(0,4))assert.match(row.general,/прочие планы, кроме 1\./);
 assert.equal(tau.combatText[0][4].general,'');assert.equal(tyranid.combatText[0][1].general,'');
 assert.match(tyranid.ordersText[4].general,/ТРЕБУЕТ УЛЬИ-ФАБРИКИ/);
 assert.match(ig.ordersText[1].general,/ОДИН РАЗ ЗА РАУНД\..*Вместимость/);
 assert.equal(ig.ordersText[1].general.match(/ОДИН РАЗ ЗА РАУНД/g).length,1);
});
test('runtime paper and approved Tau images have traceable, unchanged source assets',()=>{
 const assets=read('pictures/templates/sources.json').assets;assert.equal(assets.length,11);
 for(const a of assets){
  assert.equal(sha(fs.readFileSync(path.join(page,a.asset))),a.sha256);
  if(a.source.startsWith('https://')){assert.match(a.source,/Frytkownica\/Forbidden_Star\/a31d0e9/);assert.equal(a.sha256,a.sourceSha256);}
  else assert.equal(sha(fs.readFileSync(path.join(page,a.source))),a.sourceSha256);
 }
 const tau=read('factions/gif/tau/text.json');
 assert.equal(Object.values(tau.templates).filter(t=>t.picture).length,5);
 for(const t of Object.values(tau.templates).filter(t=>t.picture))assert.ok(assets.some(a=>a.asset===t.picture&&a.role==='approved-tau-sample-template-and-paper-donor'));
});
