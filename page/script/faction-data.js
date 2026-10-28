/* Canonical faction records. Asset identity, wording and rendering are separate.
 * Legacy array documents remain readable through catalog.js for local tooling. */
(function (root) {
  'use strict';
  var definitions=typeof module!=='undefined'&&module.exports?require('../data/render-profiles.json'):null;
  var prepared=typeof module!=='undefined'&&module.exports?require('../data/prepared-templates.json'):null;
  var folders={combat:'combat',orders:'orders',events:'events',backs:'backs',faction_card:'faction_card',map:'maps'};
  function fail(message) {throw new Error('Некорректные данные фракции: '+message);}
  function setProfiles(value) {
    if(!value||value.schemaVersion!==1||!value.profiles)fail('профили рендеринга');
    Object.keys(value.profiles).forEach(function (id) {
      var p=value.profiles[id];
      if(!p||![null,'combat','orders','events','sheet','overlay'].includes(p.kind)||typeof p.raster!=='boolean')fail('профиль '+id);
    });
    definitions=value;return value;
  }
  if(definitions)setProfiles(definitions);
  function setPrepared(value) {
    if(!value||value.schemaVersion!==1||!value.assets||Array.isArray(value.assets))fail('манифест готовых шаблонов');
    prepared=value;return value;
  }
  if(prepared)setPrepared(prepared);
  function box(value,name) {
    if(!Array.isArray(value)||value.length!==4||value.some(function(n){return !Number.isFinite(n)||n<0;})||!value[2]||!value[3]||value[0]+value[2]>1.00000001||value[1]+value[3]>1.00000001)fail(name);
  }
  function validate(data) {
    if(!definitions)fail('профили не загружены');
    if(!data||data.schemaVersion!==2||!/^(base|gif|sow|dl)\/[a-z]+$/.test(data.id)||!Array.isArray(data.cards)||!Array.isArray(data.groups)||!data.groups.length)fail('заголовок документа');
    var groups=new Set(),ids=new Set(),routes=new Set();
    data.groups.forEach(function(g){if(!g||typeof g.id!=='string'||!g.id||groups.has(g.id)||typeof g.label!=='string'||!g.label)fail('группа');groups.add(g.id);});
    data.cards.forEach(function(c){
      if(!c||!Object.hasOwn(folders,c.category)||!c.asset||!new RegExp('^'+folders[c.category]+'/[a-zA-Z0-9_.-]+\\.jpg$').test(c.asset.file))fail('исходный файл '+(c&&c.id));
      if(!['printed','template'].includes(c.asset.sourceText))fail('тип исходного текста '+c.id);
      var query=c.asset.query||'';
      if(query&&query!=='?side=back')fail('маршрут '+c.id);
      var expected=data.id+'/'+c.asset.file.slice(0,-4)+(query?'/back':'');
      if(c.id!==expected||ids.has(c.id)||routes.has(c.asset.file+query))fail('ID/маршрут '+c.id);
      ids.add(c.id);routes.add(c.asset.file+query);
      if(c.category==='combat'&&!groups.has(c.group))fail('группа карты '+c.id);
      var p=c.render&&definitions.profiles[c.render.profile];
      if(!p)fail('профиль карты '+c.id);
      if(c.render.template?.preparedId){
        var asset=prepared?.assets[c.render.template.preparedId];
        if(!asset||asset.output!==c.render.template.picture||!/^[a-f0-9]{64}$/.test(asset.sha256))fail('готовый шаблон '+c.id);
      }
      if(p.kind&&(!c.text||typeof c.text.title!=='string'||!c.text.title))fail('текст карты '+c.id);
      if(c.asset.crop)box(c.asset.crop,'область исходного листа '+c.id);
      if(c.asset.side&&!['front','back'].includes(c.asset.side))fail('сторона '+c.id);
      if(c.render.regions){
        if(!Array.isArray(c.render.regions))fail('области '+c.id);
        c.render.regions.forEach(function(r){box(r.box,'область '+c.id);if(r.content&&(!c.text.regionText||typeof c.text.regionText[r.content]!=='string'))fail('текст области '+c.id);});
      }
      if(p.kind==='sheet'&&(!data.factionSheet||!data.factionSheet.abilities?.length))fail('лист фракции '+c.id);
    });
    return data;
  }
  function manifest(data) {
    validate(data);
    var result={combat:data.groups.map(function(){return [];}),orders:[],events:[],backs:[],faction_card:[],map:[]};
    data.cards.forEach(function(c){var file=c.asset.file.split('/').pop(),list=c.category==='combat'?result.combat[data.groups.findIndex(function(g){return g.id===c.group;})]:result[c.category];if(!list.includes(file))list.push(file);});
    return result;
  }
  function cards(general,data,exp,fac,factionTitle) {
    validate(data);if(data.id!==exp+'/'+fac)fail('путь документа '+data.id);
    var counters={},physicalIndices={};
    return data.cards.map(function(c){
      var p=definitions.profiles[c.render.profile],tier=c.category==='combat'?data.groups.findIndex(function(g){return g.id===c.group;}):0;
      var counter=c.category+'/'+tier,physical=counter+'/'+c.asset.file;
      if(!Object.hasOwn(physicalIndices,physical)){physicalIndices[physical]=counters[counter]||0;counters[counter]=(counters[counter]||0)+1;}
      var text=c.text?Object.assign({},c.text):null;
      if(text&&c.category==='combat')text={title:text.title,background:text.general,foreground:text.unit,icons:text.icons,source:text.source,aspect:text.aspect,raster:p.raster};
      else if(text&&['orders','events'].includes(c.category))text.raster=p.raster;
      if(text){
        delete text.regionText;
        if(c.asset.side)text.side=c.asset.side;
        if(c.asset.crop)text.crop=c.asset.crop;
        if(c.render.regions)text.regions=c.render.regions.map(function(r){var region=Object.assign({},r);delete region.content;if(r.content)region.value=c.text.regionText[r.content];return region;});
        if(p.kind==='sheet'){
          text.sheet=Object.assign({},data.factionSheet,data.renderDefaults?.sheetLayout?{layout:data.renderDefaults.sheetLayout}:{});
          text.general=text.sheet.abilities.map(function(a){return a.title+': '+a.text;}).join(' *newpara* ');
        }
      }
      var template=c.render.template||null;
      if(c.category==='combat'&&data.renderDefaults?.combatFrame)template=Object.assign({},template,{frame:data.renderDefaults.combatFrame});
      var label=text&&text.title||c.label;
      if(!label)fail('название '+c.id);
      return {id:c.id,factionId:data.id,exp:exp,fac:fac,category:c.category,file:c.asset.file.split('/').pop(),tier:tier,index:physicalIndices[physical],
        title:label,label:label,tierLabel:data.groups[tier].label,src:'factions/'+data.id+'/'+c.asset.file+(c.asset.query||''),kind:p.kind,text:text,
        template:template,aspect:['combat','orders','events'].includes(c.category)?c.asset.aspect||null:null,factionTitle:factionTitle||fac,nativeText:c.asset.sourceText==='printed'};
    });
  }
  var api={setProfiles:setProfiles,setPrepared:setPrepared,validate:validate,manifest:manifest,cards:cards};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FSFactionData=api;
})(typeof window!=='undefined'?window:globalThis);
