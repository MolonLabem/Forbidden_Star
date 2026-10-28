/* Generated compatibility views only. Edit cards.json, then export/check. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),page=path.join(root,'page');
const catalog=require('../page/script/catalog.js');
const clone=x=>JSON.parse(JSON.stringify(x));
const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
function legacyView(general,data,previous){
 const [exp,fac]=data.id.split('/'),cards=catalog.factionCards(general,data,exp,fac,fac),byId=new Map(data.cards.map(c=>[c.id,c]));
 const result=clone(previous),files=catalog.manifest(general,data);
 result.filenames=files;result.tierLabels=data.groups.map(g=>g.label);
 if(data.materials)result.materialsText=clone(data.materials);
 if(data.factionSheet)result.factionSheet=Object.assign(clone(data.factionSheet),data.renderDefaults?.sheetLayout?{layout:data.renderDefaults.sheetLayout}:{});
 if(data.renderDefaults?.combatFrame)result.combatFrame=clone(data.renderDefaults.combatFrame);
 for(const [key,value] of Object.entries(data.provenance||{}))if(key!=='originalDocument')result[key]=clone(value);
 const oldCards=catalog.factionCards(general,previous,exp,fac,fac),oldById=new Map(oldCards.map(c=>[c.id,c]));
 for(const category of ['combat','orders','events']){
  const groups=category==='combat'?data.groups.map(()=>[]):[[]];
  cards.filter(c=>c.category===category).forEach(c=>{
   const record=byId.get(c.id),old=oldById.get(c.id);
   const prior=category==='combat'?previous.combatText?.[old?.tier]?.[old?.index]:previous[category+'Text']?.[old?.index];
   const raw=Object.assign({},prior||{},record.text);delete raw.regionText;
   const sourceDefault=previous.sourceText?.[category]||'printed';
   if(record.asset.sourceText!==sourceDefault)raw.sourceText=record.asset.sourceText;
   groups[category==='combat'?c.tier:0].push(raw);
  });
  result[category+'Text']=category==='combat'?groups:groups[0];
 }
 const components={};
 for(const c of cards.filter(c=>['sheet','overlay'].includes(c.kind))){
  const record=byId.get(c.id),file=record.asset.file,prior=previous.componentsText?.[file];
  const previousView=prior?.views?prior.views.find(v=>v.side===record.asset.side):prior;
  const payload=Object.assign({},previousView||{});
  if(c.kind==='overlay')for(const [key,value] of Object.entries(record.text||{}))if(key!=='regionText')payload[key]=clone(value);
  if(c.text.regions)payload.regions=clone(c.text.regions);
  if(record.asset.side)payload.side=record.asset.side;
  if(record.asset.crop)payload.crop=clone(record.asset.crop);
  if(record.text?.source)payload.source=record.text.source;
  if(prior?.views||record.asset.query){if(!components[file])components[file]={views:[]};components[file].views.push(payload);}
  else components[file]=payload;
 }
 result.componentsText=components;
 return result;
}
function run(write){
 const general=read(path.join(page,'factions/general.json'));let count=0;
 for(const exp of general.expansion.folder){const factions=read(path.join(page,'factions',exp,'faction.json'));for(const fac of factions.folder){
  const folder=path.join(page,'factions',exp,fac),data=read(path.join(folder,'cards.json')),file=path.join(folder,'text.json'),previous=read(file),result=legacyView(general,data,previous);
  if(write)fs.writeFileSync(file,JSON.stringify(result,null,2)+'\n');else assert.deepEqual(stable(previous),stable(result),data.id+': regenerate text.json with node tools/export-legacy.cjs --write');count++;
 }}
 console.log((write?'Generated':'Verified')+' '+count+' legacy text.json views');
}
if(require.main===module)run(process.argv.includes('--write'));
module.exports={legacyView,run};
