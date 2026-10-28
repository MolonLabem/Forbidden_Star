const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const page=path.resolve(__dirname,'../page'),catalog=require('../page/script/catalog.js'),modes=require('../page/script/modes.js'),{legacyDocument}=require('../tools/export-legacy.cjs');
const read=p=>JSON.parse(fs.readFileSync(path.join(page,p),'utf8'));
const semantic=x=>Array.isArray(x)?x.map(semantic):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().filter(k=>!['template','raster'].includes(k)&&x[k]!==undefined).map(k=>[k,semantic(x[k])])):x;
test('one text.json per faction preserves the cached legacy contract in every mode',()=>{
 const general=read('factions/general.json'),rnb=read('data/rnb.json');let count=0,factions=0;
 for(const exp of general.expansion.folder){const doc=read('factions/'+exp+'/faction.json');for(const fac of doc.folder){
  const id=exp+'/'+fac,data=read('factions/'+id+'/text.json'),old=legacyDocument(data),name=doc.name[doc.folder.indexOf(fac)];
  assert.equal(fs.existsSync(path.join(page,'factions',id,'cards.json')),false,'No duplicate source '+id);
  assert.equal(data.id,id);assert.deepEqual(catalog.manifest(general,data),catalog.manifest(general,old));
  const current=catalog.factionCards(general,data,exp,fac,name),legacy=catalog.factionCards(general,old,exp,fac,name);
  for(const mode of ['classic','updated','rnb'])assert.deepEqual(semantic(current.map(c=>modes.apply(c,mode,mode==='rnb'?rnb:null))),semantic(legacy.map(c=>modes.apply(c,mode,mode==='rnb'?rnb:null))),id+' '+mode);
  count+=current.length;factions++;
 }}assert.equal(factions,16);assert.equal(count,551);
});
test('print fingerprints include the sole faction source and shared runtime inputs',()=>{
 for(const mode of ['classic','updated','rnb']){const paths=catalog.sourcePaths('base','chaos',mode);assert.ok(paths.includes('factions/base/chaos/text.json'));assert.ok(paths.includes('data/prepared-templates.json'));assert.ok(paths.includes('data/render-profiles.json'));assert.equal(paths.some(p=>p.endsWith('/cards.json')),false);assert.equal(paths.includes('data/rnb.json'),mode==='rnb');assert.equal(new Set(paths).size,paths.length);}
});
