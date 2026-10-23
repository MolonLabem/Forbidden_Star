/* Display variants share card identities, manifests and rendering. */
(function (root) {
  'use strict';
  var definitions=[
    {id:'classic',label:'Классический',description:'Исходные изображения карт. На пустых шаблонах SoW текст остаётся динамическим.'},
    {id:'updated',label:'Обновлённый',description:'Текущие русские тексты и динамическая вёрстка.'},
    {id:'rnb',label:'RNB',description:'Правила модификации RNB из FS League. Для TDL используется обновлённая версия.'},
  ];
  function normalize(value) {return definitions.some(function (m) {return m.id===value;})?value:'updated';}
  function label(value) {return definitions.find(function (m) {return m.id===normalize(value);}).label;}
  function initial(hash) {
    var p=new URLSearchParams((hash||'').replace(/^#/,''));
    if(!p.has('mode') && p.has('print')) {
      try {return normalize(JSON.parse(p.get('print')).displayMode);} catch(error) {return 'updated';}
    }
    // A version belongs to its link or imported print set. New visits start Updated.
    return normalize(p.get('mode'));
  }
  function load(value) {
    if(normalize(value)!=='rnb')return Promise.resolve(null);
    return root.FSCache.json('data/rnb.json').then(function (data) {
      if(data.schemaVersion!==1 || !data.cards || !data.factions)throw new Error('Некорректные правила RNB');
      return data;
    });
  }
  function apply(card,value,data) {
    var mode=normalize(value),result=Object.assign({},card,{displayMode:mode,renderMode:'composite'});
    if(mode==='classic' && card.nativeText!==false)result.renderMode='raster';
    if(mode!=='rnb')return result;
    if(!data || data.schemaVersion!==1 || !data.cards || !data.factions)throw new Error('Не загружены правила RNB');
    var faction=data.factions[card.factionId];
    if(!faction) {result.displayMode='updated';result.modeFallback=true;return result;}
    var patch=data.cards[card.id];
    if(['combat','orders','events'].includes(card.category) && !patch) {result.displayMode='updated';result.modeFallback=true;return result;}
    if(patch) {
      result.text=Object.assign({},card.text,patch.text);
      result.title=result.label=result.text.title;
      if(result.title!==card.title)result.originalTitle=card.title;
      result.ruleSource=patch.source;
      if(patch.artSrc)result.artSrc=patch.artSrc;
    }
    if(card.kind==='sheet')result.ruleSource=faction.source;
    return result;
  }
  var api={definitions:definitions,normalize:normalize,label:label,initial:initial,load:load,apply:apply};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FSModes=api;
})(typeof window!=='undefined'?window:globalThis);
