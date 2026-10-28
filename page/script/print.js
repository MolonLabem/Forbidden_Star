/* Shared print selection, browser PDF export and the sheet preview. */
(function (root) {
  'use strict';
  var catalogAPI=typeof module!=='undefined' && module.exports?require('./catalog.js'):root.FSCatalog;
  var CARD_ID=/^(base|gif|sow)\/[a-z]+\/(combat|orders|events)\/[a-z0-9_]+$/;
  var TYPES={combat:'Боевая',orders:'Приказ',events:'Событие'};
  var DEFAULTS={paper:'a4',backs:true,flip:'long',marginMm:5,tokenStyle:'images'};
  function validateCart(value) {
    if(!value || typeof value!=='object' || Array.isArray(value)) throw new Error('Некорректный набор карт');
    Object.keys(value).forEach(function (id) {if(!CARD_ID.test(id) || !Number.isInteger(value[id]) || value[id]<1 || value[id]>20) throw new Error('Некорректная позиция набора: '+id);});
    return value;
  }
  function validOptions(value) {
    return value && (value.displayMode===undefined || root.FSModes.normalize(value.displayMode)===value.displayMode) &&
      ['long','short'].includes(value.flip) && ['images','icons'].includes(value.tokenStyle) &&
      Number.isFinite(value.marginMm) && value.marginMm>=5 && value.marginMm<=20 &&
      ['a4','letter'].includes(value.paper || 'a4') && (value.backs===undefined || typeof value.backs==='boolean');
  }
  function cardsFrom(spec,texts,general,docs) {return catalogAPI.printCatalog(spec,general,docs,texts).cards;}
  function dimensions(w,h,dpi,sw,sh) {
    var scale=Math.max(Math.ceil(w/25.4*dpi)/sw,Math.ceil(h/25.4*dpi)/sh);
    return {width:Math.ceil(sw*scale),height:Math.ceil(sh*scale)};
  }
  function selected(cards,quantities) {
    var byId=new Map(cards.map(function (c) {return [c.id,c];}));
    return Object.keys(quantities).filter(function (id) {
      var n=quantities[id];if(!Number.isInteger(n) || n<0 || n>20) throw new Error('Количество: целое число от 0 до 20');return n>0;
    }).map(function (id) {if(!byId.has(id)) throw new Error('Карта недоступна для печати: '+id);return byId.get(id);});
  }
  function total(cards,quantities) {return selected(cards,quantities).reduce(function (sum,c) {return sum+quantities[c.id];},0);}
  function qualityWarnings(card,quality) {
    var warnings=[];
    if(quality.dpi<300)warnings.push(card.title+': исходная иллюстрация '+Math.round(quality.dpi)+' DPI');
    if(quality.minimumTextPt!==null && quality.minimumTextPt<6)warnings.push(card.title+': текст '+quality.minimumTextPt.toFixed(1)+' пт');
    return warnings;
  }
  var api={cardsFrom:cardsFrom,dimensions:dimensions,selected:selected,total:total,qualityWarnings:qualityWarnings};
  if(typeof module!=='undefined' && module.exports) {module.exports=api;return;}
  root.FSPrint=api;
  var STORAGE='forbidden-stars.print-cart.v2',displayMode=root.FSModes.initial(location.hash),quantities={},unsavedCarts={},warning='',version=0,mode=false,loaded,available;
  function storageKey() {return STORAGE+(displayMode==='updated'?'':'.'+displayMode);}
  var printOptions=Object.assign({},DEFAULTS),importRequested=false;
  try {quantities=validateCart(JSON.parse(localStorage.getItem(storageKey())||'{}'));}
  catch(error) {warning='Сохранённый набор не прочитан. Выберите карты заново.';}
  try {
    var encoded=new URLSearchParams(location.hash.slice(1)).get('print');
    if(encoded) {
      var payload=JSON.parse(encoded),incoming=validateCart(payload.cards || payload);
      if(payload.displayMode!==undefined && root.FSModes.normalize(payload.displayMode)!==payload.displayMode)throw new Error();
      var importMode=payload.displayMode||displayMode,importRoute=new URLSearchParams(location.hash.slice(1));
      if(importRoute.has('mode') && root.FSModes.normalize(importRoute.get('mode'))!==importMode)throw new Error();
      if(payload.cards && !validOptions(payload)) throw new Error();
      if(Object.values(incoming).reduce(function (sum,n) {return sum+n;},0)>200) throw new Error();
      displayMode=importMode;quantities=incoming;importRequested=true;
      if(payload.cards) Object.keys(DEFAULTS).forEach(function (key) {if(payload[key]!==undefined) printOptions[key]=payload[key];});
      try {localStorage.setItem(storageKey(),JSON.stringify(quantities));} catch(error) {unsavedCarts[displayMode]=quantities;warning='Набор сохранится только до перезагрузки страницы.';}
    }
  } catch(error) {warning='Ссылка на набор повреждена. Сохранённый набор доступен.';}
  function element(tag,text,parent,className) {
    var node=document.createElement(tag);if(text) node.textContent=text;if(className) node.className=className;if(parent) parent.appendChild(node);return node;
  }
  function button(text,parent,action,className) {var node=element('button',text,parent,className);node.type='button';node.onclick=action;return node;}
  function load() {
    var requestedMode=displayMode;
    if(!loaded) loaded=catalogAPI.loadPrintCatalog(requestedMode).then(function (data) {
      if(requestedMode!==displayMode)throw new Error('Версия карт изменилась. Откройте печать заново.');
      available=new Map(data.cards.map(function (c) {return [c.id,c];}));sync();return data;
    }).catch(function (error) {if(requestedMode===displayMode)loaded=null;throw error;});
    return loaded;
  }
  api.load=load;
  api.displayMode=function () {return displayMode;};
  api.setDisplayMode=function (value) {
    value=root.FSModes.normalize(value);if(displayMode===value)return;
    var dialog=document.querySelector('.fs-print');if(dialog)dialog.close();
    displayMode=value;loaded=null;available=null;mode=false;version++;
    if(previews)previews.clear();
    // Failed writes remain available for this version throughout the session.
    if(unsavedCarts[displayMode]) {quantities=unsavedCarts[displayMode];warning='Набор сохранится только до перезагрузки страницы.';}
    else try {quantities=validateCart(JSON.parse(localStorage.getItem(storageKey())||'{}'));warning='';}
    catch(error) {quantities={};warning='Сохранённый набор этой версии не прочитан.';}
    sync();
  };
  api.count=function () {return Object.values(quantities).reduce(function (sum,n) {return sum+n;},0);};
  api.selection=function () {return Object.assign({},quantities);};
  function save(next) {
    quantities=validateCart(next);version++;
    try {localStorage.setItem(storageKey(),JSON.stringify(quantities));delete unsavedCarts[displayMode];warning='';} catch(error) {unsavedCarts[displayMode]=quantities;warning='Набор сохранится только до перезагрузки страницы.';}
    root.dispatchEvent(new Event('fs-print-change'));
  }
  api.setQuantity=function (id,n) {
    if(!Number.isInteger(n) || n<0 || n>20 || (n && !CARD_ID.test(id))) throw new Error('Допустимо от 0 до 20 экземпляров');
    var next=api.selection();if(n) next[id]=n;else delete next[id];
    var count=Object.values(next).reduce(function (sum,q) {return sum+q;},0);
    if(count>200 && count>api.count()) throw new Error('В одном PDF — до 200 экземпляров');
    save(next);
  };
  api.clear=function () {save({});};
  api.isMode=function () {return mode;};
  api.setMode=async function (value) {if(value) await load();mode=!!value;sync();};
  api.addFaction=async function (id) {
    var data=await load(),cards=data.cards.filter(function (c) {return c.factionId===id;});
    if(!cards.length) throw new Error('Эта фракция пока недоступна для печати');
    var next=api.selection(),added=0;
    cards.forEach(function (c) {if(!next[c.id]) {next[c.id]=1;added++;}});
    if(Object.values(next).reduce(function (sum,n) {return sum+n;},0)>200) throw new Error('Не хватает места: в одном PDF — до 200 экземпляров');
    if(added) save(next);return added;
  };
  function sync() {
    document.body.classList.toggle('fs-print-mode',mode);
    document.querySelectorAll('[data-print-id]').forEach(function (node) {
      var id=node.dataset.printId,n=quantities[id]||0,enabled=mode && available && available.has(id);
      node.classList.toggle('is-print-selected',!!n);node.classList.toggle('is-print-selectable',!!enabled);
      if(enabled) {node.setAttribute('role','checkbox');node.setAttribute('aria-checked',String(!!n));node.setAttribute('aria-label',node._printLabel+(n?' — '+n+' экз.':''));}
      else {node.removeAttribute('role');node.removeAttribute('aria-checked');node.setAttribute('aria-label',node._printLabel);}
      node.querySelector('.fs-print-check').textContent=n?(n>1?'✓ ×'+n:'✓'):'';
    });
    document.querySelectorAll('.fs-print-launch').forEach(function (node) {node.textContent='Печать'+(api.count()?' · '+api.count():'');});
    document.querySelectorAll('.fs-print-mode-toggle').forEach(function (node) {node.textContent='Режим печати';node.setAttribute('aria-pressed',String(mode));});
    document.querySelectorAll('.fs-print-modebar').forEach(function (node) {node.hidden=!mode;});
    document.querySelectorAll('.fs-print-mode-count').forEach(function (node) {node.textContent='Выбрано: '+api.count();});
  }
  root.addEventListener('fs-print-change',sync);
  api.decorateCard=function (node,card) {
    var match=/^factions\/((?:base|gif|sow)\/[a-z]+\/(?:combat|orders|events)\/[a-z0-9_]+)\.jpg$/.exec(card.src||'');
    if(!match) return node;
    node.dataset.printId=match[1];node._printLabel=card.label||card.title;
    element('span','',node,'fs-print-check').setAttribute('aria-hidden','true');
    node.addEventListener('click',function (event) {
      if(!mode || !available || !available.has(match[1])) return;
      event.preventDefault();event.stopImmediatePropagation();
      try {api.setQuantity(match[1],quantities[match[1]]?0:1);}
      catch(error) {var feedback=document.querySelector('.fs-print-modebar .fs-print-feedback');if(feedback) feedback.textContent=error.message;}
    },true);
    // New grids may be built while selection mode is already active.
    var n=quantities[match[1]]||0;
    if(mode && available && available.has(match[1])) {
      node.classList.add('is-print-selectable');node.classList.toggle('is-print-selected',!!n);
      node.setAttribute('role','checkbox');node.setAttribute('aria-checked',String(!!n));node.setAttribute('aria-label',node._printLabel);
      node.querySelector('.fs-print-check').textContent=n?(n>1?'✓ ×'+n:'✓'):'';
    }
    return node;
  };
  api.controls=function (factionId) {
    var tools=element('div','','','fs-print-tools'),feedback=element('span','',tools,'fs-print-feedback');feedback.setAttribute('role','status');
    var toggle=button('Режим печати',tools,async function () {
      toggle.disabled=true;feedback.textContent='';
      try {await api.setMode(!mode);} catch(error) {feedback.textContent=error.message;} finally {toggle.disabled=false;}
    },'fs-print-mode-toggle');toggle.setAttribute('aria-pressed',String(mode));
    button('Печать'+(api.count()?' · '+api.count():''),tools,function () {api.open({factionId:factionId});},'fs-print-launch');return tools;
  };
  api.factionBar=function (id) {
    var bar=element('div','','','fs-print-modebar');bar.hidden=!mode;
    element('span','Отметьте нужные карты',bar);element('strong','Выбрано: '+api.count(),bar,'fs-print-mode-count');
    var feedback=element('span','',bar,'fs-print-feedback');feedback.setAttribute('role','status');
    var add=button('Вся фракция',bar,async function () {
      add.disabled=true;
      try {var n=await api.addFaction(id);feedback.textContent=n?'Добавлено: '+n:'Фракция уже выбрана';}
      catch(error) {feedback.textContent=error.message;} finally {add.disabled=false;}
    },'fs-print-faction');add.disabled=!id || id.startsWith('dl/');
    if(id && id.startsWith('dl/')) feedback.textContent='Печатный формат TDL пока не подтверждён';return bar;
  };
  function image(src) {
    return new Promise(function (resolve,reject) {
      var img=new Image(),timer=setTimeout(function () {img.onload=img.onerror=null;img.removeAttribute('src');reject(new Error('Не завершена загрузка изображения'));},15000);
      img.onload=function () {clearTimeout(timer);resolve(img);};img.onerror=function () {clearTimeout(timer);reject(new Error('Не удалось загрузить '+src));};img.src=src;
    });
  }
  async function front(card,catalog,style) {
    var native=await image(card.artSrc||card.src),source=await image(card.renderMode==='raster'?card.src:card.artSrc||card.template?.picture||card.src);
    var size=dimensions(catalog.widthMm,catalog.heightMm,catalog.dpi,source.naturalWidth,source.naturalHeight);
    if(card.renderMode==='raster') {
      var canvas=document.createElement('canvas');canvas.width=size.width;canvas.height=size.height;
      canvas.getContext('2d').drawImage(native,0,0,canvas.width,canvas.height);
      return {png:canvas.toDataURL('image/png'),minimumTextPt:null,dpi:Math.min(native.naturalWidth/catalog.widthMm,native.naturalHeight/catalog.heightMm)*25.4};
    }
    var minimum=0,png=await root.FSCardRender.compose(Object.assign({},card,{wording:style}),{strict:true,width:size.width,height:size.height,onMetrics:function (m) {
      minimum=m.minimumBodyPx*Math.min(catalog.widthMm/size.width,catalog.heightMm/size.height)*72/25.4;
    }});
    if(!Number.isFinite(minimum) || minimum<=0 || !png.startsWith('data:image/png;base64,')) throw new Error('Не завершён рендер: '+card.title);
    return {png:png,minimumTextPt:minimum,dpi:Math.min(native.naturalWidth/catalog.widthMm,native.naturalHeight/catalog.heightMm)*25.4};
  }
  // Preserve the existing rendering request contract for local tooling.
  api.prepare=async function (catalog,cards,chosen,calibration,flip,progress,options) {
    var settings=Object.assign({},DEFAULTS,options||{},{flip:flip});if(!validOptions(settings)) throw new Error('Проверьте настройки печати');
    if(calibration) chosen=Object.fromEntries(catalog.calibrationIds.map(function (id) {return [id,1];}));
    var selection=selected(cards,chosen),count=total(cards,chosen);if(!count || count>200) throw new Error('Выберите от 1 до 200 экземпляров');
    var rendered=[];
    for(var i=0;i<selection.length;i++) {
      var card=selection[i];if(progress) progress('Карта '+(i+1)+' / '+selection.length);await image(card.backSrc);
      var result=await front(card,catalog,settings.tokenStyle);
      rendered.push({id:card.id,quantity:chosen[card.id],rendered:true,front:result.png,minimumTextPt:result.minimumTextPt,sourceVersion:card.sourceVersion});
    }
    return {catalogId:catalog.id,displayMode:catalog.displayMode||'updated',ruleVersion:catalog.ruleVersion||null,flip:flip,calibration:calibration,marginMm:settings.marginMm,cards:rendered};
  };
  async function jpeg(src) {
    var img=await image(src),canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
    var ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0);
    var blob=await new Promise(function (resolve) {canvas.toBlob(resolve,'image/jpeg',.96);});
    if(!blob) throw new Error('Браузер не смог подготовить изображение');
    var result={width:canvas.width,height:canvas.height,bytes:new Uint8Array(await blob.arrayBuffer())};canvas.width=canvas.height=0;return result;
  }
  api.exportPdf=async function (chosen,settings,progress,check,calibration) {
    if(!validOptions(settings)) throw new Error('Проверьте настройки печати');
    settings=Object.assign({},DEFAULTS,settings);check=check||function () {};
    if(settings.displayMode && settings.displayMode!==displayMode)throw new Error('Версия набора не совпадает с выбранной версией карт');
    var data=await load(),catalog=data.catalog;
    if(calibration) chosen=Object.fromEntries(catalog.calibrationIds.map(function (id) {return [id,1];}));
    var selection=selected(data.cards,chosen),count=total(data.cards,chosen);
    if(!count || count>200) throw new Error('Выберите от 1 до 200 экземпляров');
    var grid=root.FSPaper.layout(catalog,settings),images=new Map(),items=[],warnings=[],quality=[],bytes=0;
    for(var i=0;i<selection.length;i++) {
      check();var card=selection[i];if(progress) progress('Карта '+(i+1)+' / '+selection.length+' · '+card.title);
      var rendered=await front(card,catalog,settings.tokenStyle);check();
      var jpg=await jpeg(rendered.png);images.set(card.id,jpg);bytes+=jpg.bytes.length;
      warnings.push.apply(warnings,qualityWarnings(card,rendered));
      quality.push({id:card.id,dpi:rendered.dpi,minimumTextPt:rendered.minimumTextPt});
      if(settings.backs && !images.has(card.backSrc)) {var back=await jpeg(card.backSrc);images.set(card.backSrc,back);bytes+=back.bytes.length;}
      if(bytes>64*1024*1024) throw new Error('Набор слишком большой для браузера. Разделите его на несколько PDF.');
      for(var q=0;q<chosen[card.id];q++) items.push(card);
      // Let input events run between cards so cancellation stays responsive.
      await new Promise(function (resolve) {setTimeout(resolve,0);});
    }
    check();var pages=[];
    for(var sheet=0;sheet<Math.ceil(items.length/grid.capacity);sheet++) {
      pages.push({positions:root.FSPaper.placements(items,sheet,false,grid,settings.flip),calibration:calibration});
      if(settings.backs) pages.push({positions:root.FSPaper.placements(items,sheet,true,grid,settings.flip),calibration:calibration});
    }
    return {blob:root.FSPaper.pdf(pages,images,grid),pages:pages.length,count:count,warnings:warnings,quality:quality,layout:grid,displayMode:catalog.displayMode};
  };
  var previews=root.FSCache.create(24),previewQueue=[],previewRunning=0;
  function queuePreview(work) {
    return new Promise(function (resolve,reject) {previewQueue.push({work:work,resolve:resolve,reject:reject});drainPreviews();});
  }
  function drainPreviews() {
    while(previewRunning<2 && previewQueue.length){
      var task=previewQueue.shift();previewRunning++;
      Promise.resolve().then(task.work).then(task.resolve,task.reject).finally(function () {previewRunning--;drainPreviews();});
    }
  }
  function previewKey(card,style) {return card.id+'|'+card.displayMode+'|'+card.sourceVersion+'|'+style;}
  function previewImage(card,catalog,style) {
    var key=previewKey(card,style),cached=previews.get(key);if(cached) return cached;
    // Downsample the exact print render: rendering text in a differently shaped
    // thumbnail canvas can change line breaks compared with the exported PDF.
    var pending=queuePreview(async function () {
      var r=await front(card,catalog,style),full=await image(r.png),canvas=document.createElement('canvas');canvas.width=300;canvas.height=Math.round(300*full.naturalHeight/full.naturalWidth);
      canvas.getContext('2d').drawImage(full,0,0,canvas.width,canvas.height);
      var preview=await image(canvas.toDataURL('image/jpeg',.9));
      preview.fsQuality={dpi:r.dpi,minimumTextPt:r.minimumTextPt};return preview;
    }).catch(function (error) {if(previews.get(key)===pending)previews.delete(key);throw error;});
    return previews.set(key,pending);
  }
  api.open=async function (options) {
    if(document.querySelector('.fs-print')) return;
    options=options||{};
    var returnFocus=document.activeElement,dialog=element('dialog','','','fs-print');dialog.setAttribute('aria-labelledby','fs-print-title');
    var heading=element('header','',dialog,'fs-print-heading');element('h2','Печать карт',heading).id='fs-print-title';
    element('span',root.FSModes.label(displayMode),heading,'fs-mode-badge');
    var summary=element('p','Загрузка…',heading),closed=false,busy=false,pdfUrl=null,previewVersion=0,job=null,changed,thumbObserver=null,qualityJob=null;
    button('×',heading,function () {dialog.close();},'fs-print-close').setAttribute('aria-label','Закрыть печать');
    dialog.addEventListener('close',function () {
      closed=true;if(job) job.cancelled=true;if(qualityJob)qualityJob.cancelled=true;if(thumbObserver)thumbObserver.disconnect();previewVersion++;if(pdfUrl) URL.revokeObjectURL(pdfUrl);
      root.removeEventListener('fs-print-change',changed);dialog.remove();
      var focus=returnFocus?.isConnected?returnFocus:document.querySelector('.fs-print-launch');if(focus) focus.focus();
    });
    document.body.appendChild(dialog);dialog.showModal();
    var content=element('div','',dialog,'fs-print-content'),status=element('p','Загрузка каталога…',content);status.setAttribute('role','status');
    try {
      var data=await load(),catalog=data.catalog,cards=data.cards;if(closed) return;content.replaceChildren();
      heading.querySelector('.fs-mode-badge').textContent=root.FSModes.label(displayMode)+(catalog.ruleVersion?' · '+catalog.ruleVersion:'');
      var cart=element('section','',content,'fs-print-selection'),cartHead=element('div','',cart,'fs-print-cart-head');element('h3','Карты',cartHead);
      var chooseCards=button('Выбрать карты',cartHead,async function () {await api.setMode(true);dialog.close();});
      var list=element('div','',cart,'fs-print-cart fs-scroll'),rows=new Map();
      if(root.IntersectionObserver)thumbObserver=new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {if(entry.isIntersecting){thumbObserver.unobserve(entry.target);loadThumbnail(entry.target.querySelector('img'));}});
      },{root:list,rootMargin:'120px'});
      var empty=element('div','',cart,'fs-print-empty');element('p','Набор пуст',empty);element('small','Выберите карты галочками в картотеке.',empty);
      var cartActions=element('div','',cart,'fs-print-cart-actions');
      var addFaction=button('Вся фракция',cartActions,async function () {
        try {await api.addFaction(options.factionId);} catch(error) {status.textContent=error.message;}
      });addFaction.hidden=!catalog.factions.some(function (f) {return f.id===options.factionId;});addFaction.title='Боевые карты, приказы и события — по одному экземпляру';
      var clear=button('Очистить',cartActions,api.clear,'fs-print-quiet');
      var pane=element('section','',content,'fs-print-sheet-pane'),settings=element('div','',pane,'fs-print-settings');
      function select(label,values,value,parent) {
        var field=element('label',label,parent||settings),node=element('select','',field);node.setAttribute('aria-label',label);
        values.forEach(function (pair) {element('option',pair[1],node).value=pair[0];});node.value=value;return node;
      }
      var paper=select('Бумага',[['a4','A4 · 210 × 297 мм'],['letter','Letter · 216 × 279 мм']],printOptions.paper);
      var backLabel=element('label','',settings,'fs-print-back-toggle'),backs=element('input','',backLabel);backs.type='checkbox';backs.checked=printOptions.backs;backLabel.appendChild(document.createTextNode('С рубашками'));
      var advanced=element('details','',pane,'fs-print-options');element('summary','Настройки',advanced);
      var fields=element('div','',advanced,'fs-print-settings');
      var flip=select('Двусторонняя печать',[['long','Переворот по длинной стороне'],['short','Переворот по короткой стороне']],printOptions.flip,fields);
      var margin=element('input','',element('label','Поля, мм',fields));margin.type='number';margin.min='5';margin.max='20';margin.step='.5';margin.value=printOptions.marginMm;margin.setAttribute('aria-label','Поля, мм');
      var token=select('Жетоны',[['images','Изображения'],['icons','Чёрно-белые символы']],printOptions.tokenStyle,fields);
      element('p','Печатайте в масштабе 100%, без подгонки. Размер карты — 63 × 88 мм. Сначала проверьте совмещение сторон на контрольном листе.',advanced);
      var calibrate=button('Скачать контрольный лист',advanced,function () {run(true);},'fs-print-quiet');
      var sides=element('div','',pane,'fs-print-preview-sides'),sheet=0,back=false;
      var face=button('Лица',sides,function () {back=false;refreshPreview();}),reverse=button('Рубашки',sides,function () {back=true;refreshPreview();});
      var stage=element('div','',pane,'fs-print-paper'),canvas=element('canvas','',stage);canvas.width=630;canvas.setAttribute('role','img');canvas.setAttribute('aria-label','Предпросмотр раскладки карт на листе');
      var navigation=element('nav','',pane,'fs-print-preview-nav');navigation.setAttribute('aria-label','Листы для печати');
      var previous=button('‹',navigation,function () {sheet--;refreshPreview();});previous.setAttribute('aria-label','Предыдущий лист');
      var pageLabel=element('span','',navigation);pageLabel.setAttribute('aria-live','polite');
      var next=button('›',navigation,function () {sheet++;refreshPreview();});next.setAttribute('aria-label','Следующий лист');
      var layoutLabel=element('p','',pane,'fs-print-layout-label');
      var duplexLabel=element('p','',pane,'fs-print-layout-label');
      var quality=element('details','',pane,'fs-print-quality');quality.hidden=true;
      var qualityResults=new Map(),qualityError='',qualitySelection=null;
      var footer=element('footer','',dialog,'fs-print-footer');status=element('p',warning||'',footer);status.setAttribute('role','status');status.setAttribute('aria-live','polite');
      var generate=button('Скачать PDF',footer,function () {if(busy) {job.cancelled=true;status.textContent='Отмена…';} else run(false);},'fs-print-primary');
      function currentOptions() {return {paper:paper.value,backs:backs.checked,flip:flip.value,marginMm:Number(margin.value),tokenStyle:token.value,displayMode:displayMode};}
      function items() {
        var result=[];selected(cards,quantities).forEach(function (c) {for(var i=0;i<quantities[c.id];i++) result.push(c);});return result;
      }
      function valid() {return !!margin.value && margin.validity.valid && validOptions(currentOptions()) && Array.from(list.querySelectorAll('input')).every(function (i) {return !!i.value && i.validity.valid;});}
      function invalidate() {if(pdfUrl) URL.revokeObjectURL(pdfUrl);pdfUrl=null;}
      function rememberQuality(card,preview,style) {
        qualityResults.set(card.id,{style:style,value:preview.fsQuality});showQuality();
      }
      function showQuality() {
        if(closed||busy)return;
        var chosen,checked=0,unmeasured=0,warnings=[];
        try{chosen=qualitySelection||selected(cards,quantities);}catch(error){quality.hidden=true;return;}
        chosen.forEach(function (card) {var result=qualityResults.get(card.id);if(result?.style===token.value){checked++;if(result.value.minimumTextPt===null)unmeasured++;warnings.push.apply(warnings,qualityWarnings(card,result.value));}});
        quality.hidden=!chosen.length;quality.replaceChildren();if(!chosen.length)return;
        element('summary',(qualitySelection?'Качество контрольного листа':'Качество перед печатью')+' · '+checked+' / '+chosen.length,quality);
        element('p','Проверяются текст и иллюстрации лиц. Совмещение сторон и читаемость подтвердите контрольной печатью в масштабе 100%.',quality);
        if(warnings.length){var warningList=element('ul','',quality);warnings.forEach(function (text) {element('li',text,warningList);});}
        else if(checked===chosen.length&&!unmeasured)element('p','Нет текста меньше 6 пт или иллюстраций ниже 300 DPI. Это не заменяет контрольную печать.',quality);
        if(unmeasured)element('p','Размер печатного текста на исходных изображениях ('+unmeasured+') не измеряется автоматически. Проверьте его на контрольном отпечатке.',quality);
        if(qualityError)element('p',qualityError,quality).setAttribute('role','alert');
        if(checked<chosen.length||qualityJob)button(qualityJob?'Отменить проверку':'Проверить весь набор',quality,checkQuality,'fs-print-quiet');
      }
      async function checkQuality() {
        if(qualityJob){qualityJob.cancelled=true;qualityJob=null;showQuality();return;}
        if(busy||!valid())return;
        var task={cancelled:false,style:token.value,ids:Object.keys(quantities).sort().join('|')};qualityJob=task;qualityError='';showQuality();
        try{
          for(var card of selected(cards,quantities)){
            var cached=qualityResults.get(card.id);if(cached?.style===task.style)continue;
            if(closed||task.cancelled)return;
            var preview=await previewImage(card,catalog,task.style);
            if(closed||task.cancelled)return;rememberQuality(card,preview,task.style);
          }
        }catch(error){if(!closed&&!task.cancelled)qualityError=error.message;}
        finally{if(qualityJob===task){qualityJob=null;showQuality();if(!closed&&!task.cancelled&&!qualityError)refreshPreview();}}
      }
      async function loadThumbnail(thumb) {
        var card=thumb.fsCard,style=token.value,key=previewKey(card,style);if(thumb.dataset.previewKey===key)return;
        thumb.dataset.previewKey=key;thumb.hidden=true;thumb.parentElement.setAttribute('aria-busy','true');thumb.fsRetry.hidden=true;
        try{
          var preview=await previewImage(card,catalog,style);
          if(closed||!thumb.isConnected||thumb.dataset.previewKey!==key||token.value!==style)return;
          thumb.src=preview.src;thumb.hidden=false;rememberQuality(card,preview,style);return true;
        }catch(error){if(!closed&&thumb.isConnected&&thumb.dataset.previewKey===key&&token.value===style){thumb.fsRetry.hidden=false;thumb.fsRetry.title=error.message;}}
        finally{if(thumb.dataset.previewKey===key&&token.value===style)thumb.parentElement.setAttribute('aria-busy','false');}
      }
      async function refreshPreview() {
        var revision=++previewVersion;invalidate();
        try {
          if(!valid()) throw new Error('Укажите целое количество от 1 до 20 и поля от 5 до 20 мм');
          var opts=currentOptions();printOptions=opts;var grid=root.FSPaper.layout(catalog,opts),chosen=items();
          var sheets=Math.max(1,Math.ceil(chosen.length/grid.capacity));sheet=Math.max(0,Math.min(sheet,sheets-1));if(!opts.backs) back=false;
          previous.disabled=busy||!sheet;next.disabled=busy||sheet>=sheets-1;
          reverse.hidden=!opts.backs;face.setAttribute('aria-pressed',String(!back));reverse.setAttribute('aria-pressed',String(back));
          pageLabel.textContent='Лист '+(sheet+1)+' из '+sheets;
          layoutLabel.textContent=(opts.paper==='a4'?'A4':'Letter')+' · '+grid.columns+' × '+grid.rows+' · 63 × 88 мм';
          duplexLabel.hidden=!opts.backs;
          duplexLabel.textContent='PDF: '+(sheet*2+1)+' — лица, '+(sheet*2+2)+' — рубашки · переворот по '+(opts.flip==='long'?'длинной':'короткой')+' стороне';
          reverse.title='Расположение рубашек зеркальное: при перевороте листа они совмещаются с лицами карт.';
          canvas.setAttribute('aria-label',layoutLabel.textContent+' · '+(back?'рубашки':'лица')+' · лист '+(sheet+1));
          var positions=root.FSPaper.placements(chosen,sheet,back,grid,opts.flip),images=new Map();
          root.FSPaper.drawPreview(canvas,grid,positions,images,false);canvas.setAttribute('aria-busy','true');
          await Promise.all(positions.map(async function (p) {
            var card=available.get(p.id),img=back?await image(card.backSrc):await previewImage(card,catalog,opts.tokenStyle);images.set(p.key,img);
            if(!back&&!closed&&revision===previewVersion)rememberQuality(card,img,opts.tokenStyle);
          }));
          if(closed || revision!==previewVersion) return;
          root.FSPaper.drawPreview(canvas,grid,positions,images,false);canvas.setAttribute('aria-busy','false');
          if(!busy) status.textContent=warning||'';
        } catch(error) {if(!closed && revision===previewVersion) {status.textContent=error.message;canvas.setAttribute('aria-busy','false');}}
      }
      function updateCart() {
        invalidate();qualitySelection=null;var ids=Object.keys(quantities);
        if(qualityJob&&(qualityJob.style!==token.value||qualityJob.ids!==ids.slice().sort().join('|'))){qualityJob.cancelled=true;qualityJob=null;}
        qualityError='';
        rows.forEach(function (row,id) {if(!ids.includes(id)) {var holder=row.querySelector('.fs-print-thumb');if(thumbObserver&&holder)thumbObserver.unobserve(holder);row.remove();rows.delete(id);}});
        ids.forEach(function (id) {
          var card=available.get(id),row=rows.get(id);
          if(!row) {
            row=element('div','',list,'fs-print-row');row.dataset.cartId=id;rows.set(id,row);
            if(card) {
              var holder=element('span','',row,'fs-print-thumb'),thumb=element('img','',holder);thumb.alt='';thumb.decoding='async';thumb.fsCard=card;
              var retry=button('↻',holder,async function () {thumb.dataset.previewKey='';if(await loadThumbnail(thumb))refreshPreview();},'fs-print-thumb-retry');retry.hidden=true;retry.setAttribute('aria-label','Повторить миниатюру: '+card.title);thumb.fsRetry=retry;
            }
            var label=element('div','',row,'fs-print-row-name');element('strong',card?card.title:id,label);element('small',card?card.factionTitle+' · '+TYPES[card.category]:'Нет печатного источника',label);
            var stepper=element('div','',row,'fs-print-stepper');
            function adjust(delta) {try {api.setQuantity(id,quantities[id]+delta);} catch(error) {status.textContent=error.message;}}
            var minus=button('−',stepper,function () {adjust(-1);});minus.setAttribute('aria-label','Уменьшить: '+(card?card.title:id));
            var input=element('input','',stepper);input.type='number';input.min='1';input.max='20';input.step='1';input.setAttribute('aria-label','Экземпляры: '+(card?card.title:id));
            input.oninput=function () {
              if(!input.value || !input.validity.valid) {generate.disabled=true;previewVersion++;invalidate();status.textContent='Количество: целое число от 1 до 20';return;}
              try {api.setQuantity(id,Number(input.value));} catch(error) {generate.disabled=true;status.textContent=error.message;previewVersion++;invalidate();}
            };
            var plus=button('+',stepper,function () {adjust(1);});plus.setAttribute('aria-label','Увеличить: '+(card?card.title:id));
            button('×',row,function () {api.setQuantity(id,0);},'fs-print-remove').setAttribute('aria-label','Убрать: '+(card?card.title:id));
          }
          var input=row.querySelector('input');if(input!==document.activeElement) input.value=quantities[id];
          row.querySelector('.fs-print-stepper button:last-child').disabled=busy||quantities[id]>=20;
          var imageNode=row.querySelector('img');
          if(imageNode&&imageNode.dataset.previewKey!==previewKey(card,token.value)){
            imageNode.hidden=true;imageNode.removeAttribute('src');
            if(thumbObserver)thumbObserver.observe(imageNode.parentElement);else loadThumbnail(imageNode);
          }
        });
        empty.hidden=!!ids.length;list.hidden=!ids.length;clear.disabled=busy||!ids.length;
        chooseCards.textContent=ids.length?'Выбрать ещё':'Выбрать карты';
        try {
          var count=total(cards,quantities),grid=root.FSPaper.layout(catalog,currentOptions());
          summary.textContent=count+' экз. · '+ids.length+' разных карт'+(count?' · '+Math.ceil(count/grid.capacity)+' лист.':'');
          generate.disabled=!busy && (!count || count>200 || !valid());calibrate.disabled=busy||!valid();
        } catch(error) {summary.textContent='Проверьте набор';status.textContent=error.message;generate.disabled=true;}
        showQuality();refreshPreview();
      }
      changed=updateCart;root.addEventListener('fs-print-change',changed);
      [paper,backs,flip,token].forEach(function (control) {control.onchange=updateCart;});margin.oninput=updateCart;
      async function run(calibration) {
        if(busy || !valid()) return;busy=true;invalidate();var snapshot=version;job={cancelled:false};var task=job;
        if(qualityJob){qualityJob.cancelled=true;qualityJob=null;}
        dialog.querySelectorAll('button,input,select').forEach(function (control) {if(control!==generate && !control.classList.contains('fs-print-close')) control.disabled=true;});
        generate.disabled=false;generate.textContent='Отменить';
        try {
          var result=await api.exportPdf(api.selection(),currentOptions(),function (text) {if(!closed) status.textContent=text;},function () {
            if(closed || task.cancelled) throw new Error('Создание PDF отменено');if(snapshot!==version) throw new Error('Набор изменился. Подготовьте PDF заново.');
          },calibration);
          if(closed || task.cancelled) throw new Error('Создание PDF отменено');
          pdfUrl=URL.createObjectURL(result.blob);
          var link=element('a','',dialog);link.href=pdfUrl;link.download='forbidden-stars-'+displayMode+(catalog.ruleVersion?'-'+catalog.ruleVersion:'')+'-'+(calibration?'control-':'')+paper.value+'-'+flip.value+'.pdf';link.click();link.remove();
          result.quality.forEach(function (entry) {qualityResults.set(entry.id,{style:currentOptions().tokenStyle,value:entry});});
          qualitySelection=calibration?catalog.calibrationIds.map(function (id) {return available.get(id);}):null;
          status.textContent='PDF готов · '+result.count+' экз. · '+result.pages+' стр. Масштаб 100%'+(backs.checked?' · переворот по '+(flip.value==='long'?'длинной':'короткой')+' стороне.':'.');
        } catch(error) {if(!closed) status.textContent=error.message;}
        finally {
          busy=false;job=null;
          if(!closed) {
            generate.textContent='Скачать PDF';dialog.querySelectorAll('button,input,select').forEach(function (c) {c.disabled=false;});
            clear.disabled=!api.count();generate.disabled=!api.count()||!valid();previous.disabled=!sheet;
            try {next.disabled=sheet>=Math.ceil(items().length/root.FSPaper.layout(catalog,currentOptions()).capacity)-1;} catch(error) {generate.disabled=true;}
            rows.forEach(function (row,id) {row.querySelector('.fs-print-stepper button:last-child').disabled=quantities[id]>=20;});
            showQuality();
          }
        }
      }
      updateCart();
    } catch(error) {
      status.textContent=error.message;button('Повторить',content,function (event) {
        event.currentTarget.disabled=true;
        // The existing close handler removes the old dialog and restores focus.
        dialog.addEventListener('close',function () {api.open(options);},{once:true});
        dialog.close();
      });
    }
  };
  if(importRequested) {
    if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',function () {api.open();},{once:true});else api.open();
  }
})(typeof window!=='undefined'?window:globalThis);
