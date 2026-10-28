const test=require('node:test'),assert=require('node:assert/strict');
const model=require('../page/script/faction-data.js');
function document(){return {schemaVersion:2,id:'base/chaos',groups:[{id:'starter',label:'Стартовые'}],cards:[{id:'base/chaos/combat/s1',category:'combat',group:'starter',asset:{file:'combat/s1.jpg',sourceText:'printed'},text:{title:'Карта',general:'Получите 1 [D].',unit:'',icons:'BS'},render:{profile:'combat'}}]};}
test('explicit identity maps to the existing route and normalized combat contract',()=>{
 const data=document(),[card]=model.cards({},data,'base','chaos','Хаос');
 assert.equal(card.src,'factions/base/chaos/combat/s1.jpg');assert.equal(card.text.background,'Получите 1 [D].');assert.equal(card.nativeText,true);assert.equal(card.tierLabel,'Стартовые');
 assert.deepEqual(model.manifest(data).combat,[['s1.jpg']]);
});
test('duplicate IDs, mismatched file identity and unknown groups/profiles fail',()=>{
 for(const mutate of [d=>d.cards.push(d.cards[0]),d=>d.cards[0].id='base/chaos/combat/s2',d=>d.cards[0].group='missing',d=>d.cards[0].render.profile='missing']){const data=document();mutate(data);assert.throws(()=>model.validate(data));}
});
test('region text binds by stable key, not parallel array position',()=>{
 const data=document();data.cards=[{id:'base/chaos/maps/map_A',category:'map',asset:{file:'maps/map_A.jpg',sourceText:'printed'},text:{title:'Карта A',regionText:{system:'Мир'}},render:{profile:'overlay',regions:[{box:[.1,.2,.3,.4],content:'system',role:'heading'}]}}];
 assert.equal(model.cards({},data,'base','chaos','Хаос')[0].text.regions[0].value,'Мир');
 data.cards[0].render.regions[0].content='missing';assert.throws(()=>model.validate(data));
});
test('invalid crops and wrong faction paths fail',()=>{
 const data=document();data.cards[0].asset.crop=[.8,0,.3,1];assert.throws(()=>model.validate(data));delete data.cards[0].asset.crop;
 assert.throws(()=>model.cards({},data,'base','eldar','Эльдар'));
});

test('shared layout defaults merge without changing another card; prepared references are checked',()=>{
 const profiles=require('../page/data/render-profiles.json'),assets=require('../page/data/prepared-templates.json');
 model.setProfiles({schemaVersion:1,profiles:{sample:{kind:'combat',raster:false,template:{body:{box:[.1,.2,.7,.5]},sampling:'canvas'}}}});
 model.setPrepared({schemaVersion:1,assets:{sample:{cardId:'base/chaos/combat/s1',output:'pictures/prepared/sample.png',sha256:'a'.repeat(64)}}});
 try{
  const data=document();data.cards[0].render={profile:'sample',template:{preparedId:'sample',titleLayer:'pictures/prepared/sample.png',nativeCombatArea:{top:.6,bottom:.9}}};
  const card=model.cards({},data,'base','chaos','Chaos')[0];assert.equal(card.template.sampling,'canvas');assert.deepEqual(card.template.body.box,[.1,.2,.7,.5]);assert.equal(data.cards[0].render.template.body,undefined);
  data.cards[0].render.template.titleLayer='pictures/prepared/missing.png';assert.throws(()=>model.validate(data));
 }finally{model.setProfiles(profiles);model.setPrepared(assets);}
});
