const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),page=path.join(root,'page');
const catalog=require('../page/script/catalog.js'),modes=require('../page/script/modes.js'),recipes=require('./preparation-manifest.json');
const read=p=>JSON.parse(fs.readFileSync(path.join(page,p),'utf8'));
const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().filter(k=>x[k]!==undefined).map(k=>[k,stable(x[k])])):x;
const hash=x=>crypto.createHash('sha256').update(typeof x==='string'||Buffer.isBuffer(x)?x:JSON.stringify(stable(x))).digest('hex');
function assetFile(relative){const target=path.resolve(page,relative.split('?')[0]);if(!target.startsWith(page+path.sep))throw new Error('Source path escapes page');return target;}
function sourceFiles(card){const files=new Set([card.artSrc||card.src]);if(card.template?.picture)files.add(card.template.picture);
 for(const patch of card.template?.patches||[])if(patch.texture?.src)files.add(patch.texture.src);
 if(card.text?.raster&&card.kind==='combat')files.add('pictures/background.png');
 return Object.fromEntries([...files].map(p=>[p.split('?')[0],hash(fs.readFileSync(assetFile(p)))]));}
function inputs(){
 const general=read('factions/general.json'),rnb=read('data/rnb.json'),cards=new Map();
 for(const exp of general.expansion.folder){const f=read('factions/'+exp+'/faction.json');for(const fac of f.folder){const data=read('factions/'+exp+'/'+fac+'/text.json');for(const card of catalog.factionCards(general,data,exp,fac,f.name[f.folder.indexOf(fac)]))cards.set(card.id,card);}}
 const rendererHash=hash(fs.readFileSync(path.join(page,'script/cardrender.js'),'utf8').replace(/\r\n/g,'\n')),jobs=[];
 for(const [key,recipe] of Object.entries(recipes.jobs)){
  const base=cards.get(recipe.cardId);if(!base)throw new Error('Missing preparation card '+key);
  const card=modes.apply(base,recipe.mode,recipe.mode==='rnb'?rnb:null),current=JSON.parse(JSON.stringify(card));
  if((card.artSrc||null)!==recipe.artSrc)throw new Error('Artwork override changed; review recipe '+key);
  card.template=recipe.template;card.text=Object.assign({},card.text,{raster:recipe.raster});
  // A sheet never had the text.raster dispatch flag in its normalized contract.
  if(card.kind==='sheet')delete card.text.raster;
  const sheet=card.text?.sheet;
  const geometry={recipe,source:card.src,crop:card.text?.crop,side:card.text?.side,
   regions:card.text?.regions?.map(r=>{const v=Object.assign({},r);delete v.value;return v;}),
   sheet:sheet?{layout:sheet.layout,units:sheet.units?.length,initialForces:sheet.initialForces?.length,objectives:sheet.objectives?.map(Boolean)}:null};
  const sourceHashes=sourceFiles(card),inputHash=hash({geometry,sourceHashes,rendererHash});
  const comparisons=recipe.mode==='rnb'?[{mode:'rnb',card,current}]:[{mode:'updated',card,current}];
  if(recipe.mode==='updated'&&rnb.cards[recipe.cardId]&&!rnb.cards[recipe.cardId].artSrc){const other=modes.apply(base,'rnb',rnb);other.template=recipe.template;other.text=Object.assign({},other.text,{raster:recipe.raster});comparisons.push({mode:'rnb',card:other,current:modes.apply(base,'rnb',rnb)});}
  jobs.push({key,recipe,card,inputHash,sourceHashes,rendererHash,comparisons});
 }
 return jobs;
}
module.exports={inputs,hash,stable,assetFile,root,page};
