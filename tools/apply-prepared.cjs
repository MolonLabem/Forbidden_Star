/* Validate a complete staged preparation before applying any repository change. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {inputs,hash,stable,root,page,assetFile}=require('./template-inputs.cjs');
const args=process.argv.slice(2),i=args.indexOf('--from');
if(i<0||!args[i+1])throw new Error('Usage: node tools/apply-prepared.cjs --from <staging-directory> [--write]');
const stage=path.resolve(args[i+1]),results=JSON.parse(fs.readFileSync(path.join(stage,'results.json'),'utf8')),jobs=inputs(),writes=new Map();
assert.equal(Object.keys(results.jobs).length,jobs.length,'Expected a complete preparation set');
const profiles=JSON.parse(fs.readFileSync(path.join(page,'data/render-profiles.json'),'utf8'));
const assets={},groups={},docs=new Map(),originals=new Map();
const manifestPath=path.join(page,'data/prepared-templates.json'),profilesPath=path.join(page,'data/render-profiles.json'),previous=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
for(const file of [manifestPath,profilesPath])originals.set(file,hash(fs.readFileSync(file)));
const same=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
for(const job of jobs){
 const result=results.jobs[job.key];assert.ok(result,'Missing '+job.key);
 assert.equal(result.inputHash,job.inputHash,'Stale input: '+job.key);assert.equal(result.rendererHash,job.rendererHash,'Stale renderer');assert.deepEqual(result.sourceHashes,job.sourceHashes);
 assert.match(result.baselineRendererHash||'',/^[a-f0-9]{64}$/,'Original renderer evidence required');assert.equal(result.output,job.recipe.output);
 assert.equal(result.passed,true,'Visual difference: '+job.key);assert.deepEqual(result.comparisons.map(c=>c.mode),job.comparisons.map(c=>c.mode));assert.ok(result.comparisons.every(c=>c.changedPixels===0&&!c.error));
 assert.equal(result.file,path.basename(result.output));const bytes=fs.readFileSync(path.join(stage,result.file));assert.equal(hash(bytes),result.sha256,'PNG hash: '+job.key);
 assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(bytes.readUInt32BE(16),result.width);assert.equal(bytes.readUInt32BE(20),result.height);
 const output=assetFile(result.output);if(fs.existsSync(output)){const digest=hash(fs.readFileSync(output));assert.equal(digest,previous.assets[job.key]?.sha256,'Prepared asset was changed locally: '+job.key);originals.set(output,digest);}else originals.set(output,null);writes.set(output,bytes);
 const id=job.recipe.cardId.split('/').slice(0,2).join('/'),file=path.join(page,'factions',id,'cards.json');
 if(!docs.has(file)){const raw=fs.readFileSync(file);originals.set(file,hash(raw));docs.set(file,JSON.parse(raw));}
 const record=docs.get(file).cards.find(c=>c.id===job.recipe.cardId);assert.ok(record);
 const profile='prepared-'+(job.recipe.raster&&['orders','events'].includes(result.profile)?'native-':'')+result.profile;
 const template=Object.assign({},result.template,{preparedId:job.key},result.assetKind==='label-layer'?{titleLayer:result.output}:{picture:result.output});
 if(job.recipe.mode==='rnb'){
  record.render.template=record.render.template||{};record.render.template.variants=record.render.template.variants||{};record.render.template.variants[job.recipe.artSrc]=template;
 }else{
  const variants=record.render.template?.variants;record.render={...record.render,profile,template};if(variants)template.variants=variants;
  (groups[profile]||(groups[profile]=[])).push({template,record});
 }
 const {file:unused,template:layout,profile:dispatch,passed,...metadata}=result;assets[job.key]=metadata;
}
// Share the usual measured layout; retain actual source-specific exceptions.
for(const [id,items] of Object.entries(groups)){
 const common={};for(const key of Object.keys(items[0].template))if(!['preparedId','picture','titleLayer','variants','nativeCombatArea'].includes(key)&&items.every(x=>Object.hasOwn(x.template,key))){
  const counts=new Map();for(const item of items){const signature=JSON.stringify(stable(item.template[key])),entry=counts.get(signature)||{value:item.template[key],count:0};entry.count++;counts.set(signature,entry);}
  const usual=[...counts.values()].sort((a,b)=>b.count-a.count)[0];if(usual.count>1)common[key]=usual.value;
 }
 profiles.profiles[id]={kind:items[0].record.category==='faction_card'?'sheet':items[0].record.category,raster:false,template:common};
 for(const item of items)for(const key of Object.keys(common))if(same(item.template[key],common[key]))delete item.template[key];
}
const encode=x=>Buffer.from(JSON.stringify(x,null,2)+'\n');
writes.set(path.join(page,'data/render-profiles.json'),encode(profiles));writes.set(path.join(page,'data/prepared-templates.json'),encode({schemaVersion:1,description:'Locally reconstructed backgrounds/layers; original sources and offline recipes are retained. Not original clean masters.',assets}));
for(const [file,data] of docs)writes.set(file,encode(data));
for(const [file,digest] of originals)assert.equal(fs.existsSync(file)?hash(fs.readFileSync(file)):null,digest,'Concurrent edit: '+file);
if(args.includes('--write')){for(const [file,bytes] of writes){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);}console.log('Applied '+jobs.length+' verified prepared assets and '+docs.size+' faction records');}
else console.log('Validated '+jobs.length+' exact prepared assets; rerun with --write to apply');
