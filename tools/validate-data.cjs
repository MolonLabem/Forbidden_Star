const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),page=path.join(root,'page');
const catalog=require('../page/script/catalog.js'),model=require('../page/script/faction-data.js'),legacy=require('./export-legacy.cjs');
const read=p=>JSON.parse(fs.readFileSync(path.join(page,p),'utf8'));
const digest=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function localAsset(relative){const file=path.resolve(page,relative);assert.ok(file.startsWith(page+path.sep),'Asset escapes page: '+relative);assert.ok(fs.statSync(file).isFile(),'Missing asset: '+relative);return file;}
function validate(){
 const general=read('factions/general.json'),docs={},texts={},allIds=new Set();let total=0,hashes=0;
 for(const exp of general.expansion.folder){const doc=docs[exp]=read('factions/'+exp+'/faction.json');for(const fac of doc.folder){
  const id=exp+'/'+fac,data=texts[id]=read('factions/'+id+'/cards.json');model.validate(data);
  const cards=catalog.factionCards(general,data,exp,fac,doc.name[doc.folder.indexOf(fac)]);
  for(const card of cards){assert.ok(!allIds.has(card.id),'Duplicate card ID: '+card.id);allIds.add(card.id);localAsset(card.src.split('?')[0]);
   const t=card.template;if(t?.picture)localAsset(t.picture);if(t?.artwork){assert.equal(digest(localAsset(t.artwork.src)),t.artwork.sha256,'Artwork hash: '+card.id);hashes++;}
   if(t?.frame)localAsset(t.frame.picture);
  }
  for(const [file,hash] of Object.entries(data.provenance?.wordingSource?.imageSha256||{})){assert.equal(digest(localAsset('factions/'+id+'/'+file)),hash,'Original raster hash: '+id+'/'+file);hashes++;}
  for(const asset of Object.values(data.provenance?.assetSources||{})){assert.match(asset.sha256,/^[a-f0-9]{64}$/);}
  total+=cards.length;
 }}
 const spec=read('data/print-catalog.json'),rnb=read('data/rnb.json');
 for(const mode of ['classic','updated','rnb']){const print=catalog.printCatalog(spec,general,docs,texts,mode,mode==='rnb'?rnb:null);assert.equal(print.cards.length,324,'Print eligibility changed');assert.ok(print.cards.every(c=>c.exp!=='dl'),'DL printing remains excluded');}
 for(const [id,shape] of Object.entries({'dl/adeptuscustodes':[5,4,3,2],'dl/leaguesofvotann':[5,5,4,3]}))assert.deepEqual(catalog.manifest(general,texts[id]).combat.map(g=>g.length),shape,id+' combat groups');
 assert.equal(catalog.manifest(general,texts['dl/adeptuscustodes']).orders.length,6);
 assert.equal(catalog.manifest(general,texts['dl/genestealercult']).orders.length,6);
 assert.equal(catalog.manifest(general,texts['dl/leaguesofvotann']).orders.length,6);
 assert.equal(catalog.manifest(general,texts['dl/thousandsons']).events.length,9);
 for(const [id,data] of Object.entries(texts)){
  const manifest=catalog.manifest(general,data);if(id.startsWith('dl/'))assert.deepEqual(manifest.map,['map_A.jpg','map_B.jpg']);
  assert.equal(data.cards.filter(c=>c.category==='faction_card').length,2,id+' sheet sides');
 }
 const prepared=read('data/prepared-templates.json'),jobs=require('./template-inputs.cjs').inputs();
 assert.equal(Object.keys(prepared.assets).length,jobs.length,'Prepared asset cardinality');
 for(const job of jobs){const asset=prepared.assets[job.key];assert.ok(asset,'Missing prepared asset '+job.key);assert.equal(asset.inputHash,job.inputHash,'Stale prepared input '+job.key);assert.equal(asset.rendererHash,job.rendererHash);assert.equal(asset.output,job.recipe.output);assert.equal(digest(localAsset(asset.output)),asset.sha256,'Prepared PNG hash '+job.key);assert.deepEqual(asset.sourceHashes,job.sourceHashes);assert.ok(asset.comparisons.every(c=>c.changedPixels===0&&!c.error));}
 for(const data of Object.values(texts))for(const record of data.cards){assert.ok(!record.render.template?.patches,'Runtime repair recipe '+record.id);assert.ok(!record.render.profile.startsWith('baked-'),'Runtime raster cleanup '+record.id);}
 for(const [id,patch] of Object.entries(rnb.cards))if(patch.artSrc&&jobs.some(j=>j.recipe.cardId===id)){const record=texts[id.split('/').slice(0,2).join('/')].cards.find(c=>c.id===id);assert.ok(record.render.template?.variants?.[patch.artSrc],'Missing prepared artwork variant '+id);}
 legacy.run(false);
 console.log('Verified '+jobs.length+' prepared outputs, source hashes, recipe fingerprints and zero-difference evidence');
 console.log('Validated '+Object.keys(texts).length+' factions, '+total+' stable records, '+hashes+' source/artwork hashes and all 3 print modes');
 return {factions:Object.keys(texts).length,cards:total,hashes};
}
if(require.main===module)validate();
module.exports={validate,localAsset,digest};
