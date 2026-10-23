/* Shared cart; existing FSCardRender and BoardGame.Printing own rendering/layout. */
(function (root) {
  'use strict';
  var catalogAPI = typeof module!=='undefined' && module.exports ? require('./catalog.js') : root.FSCatalog;
  var TYPES = {combat:'Боевая', orders:'Приказ', events:'Событие'};
  var CARD_ID = /^(base|gif|sow)\/[a-z]+\/(combat|orders|events)\/[a-z0-9_]+$/;
  function validateCart(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Некорректный набор карт');
    Object.keys(value).forEach(function (id) {
      if (!CARD_ID.test(id) || !Number.isInteger(value[id]) || value[id] < 1 || value[id] > 20) throw new Error('Некорректная позиция набора: ' + id);
    });
    return value;
  }
  function validOptions(value) {
    return value && ['long','short'].includes(value.flip) && ['images','icons'].includes(value.tokenStyle) && Number.isFinite(value.marginMm) && value.marginMm >= 5 && value.marginMm <= 20;
  }
  function cardsFrom(spec,texts,general,factionDocs) { return catalogAPI.printCatalog(spec,general,factionDocs,texts).cards; }
  function dimensions(w, h, dpi, sw, sh) {
    var scale = Math.max(Math.ceil(w/25.4*dpi)/sw, Math.ceil(h/25.4*dpi)/sh);
    return {width:Math.ceil(sw*scale), height:Math.ceil(sh*scale)};
  }
  function selected(cards, quantities) {
    var byId = new Map(cards.map(function (c) { return [c.id,c]; }));
    return Object.keys(quantities).filter(function (id) {
      var n = quantities[id];
      if (!Number.isInteger(n) || n < 0 || n > 20) throw new Error('Количество должно быть целым числом от 0 до 20: ' + id);
      return n > 0;
    }).map(function (id) {
      if (!byId.has(id)) throw new Error('Карта недоступна для русской печати: ' + id);
      return byId.get(id);
    });
  }
  function total(cards, quantities) { return selected(cards,quantities).reduce(function (sum,c) { return sum + quantities[c.id]; },0); }
  var api = {cardsFrom:cardsFrom, dimensions:dimensions, selected:selected, total:total};
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
  root.FSPrint = api;
  var STORAGE = 'forbidden-stars.print-cart.v2', quantities = {}, storageWarning = '', version = 0;
  try { quantities = validateCart(JSON.parse(localStorage.getItem(STORAGE) || '{}')); }
  catch (error) { quantities = {}; storageWarning = 'Не удалось прочитать сохранённый набор. Выберите карты заново.'; }
  var importRequested = false, printOptions = {flip:'long',marginMm:5,tokenStyle:'images'};
  try {
    var encoded = new URLSearchParams(location.hash.slice(1)).get('print');
    if (encoded) {
      importRequested = true;
      var payload = JSON.parse(encoded);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error();
      var incoming = validateCart(payload.cards || payload);
      if (payload.cards) {
        if (!validOptions(payload)) throw new Error();
      }
      if (Object.values(incoming).reduce(function (sum,n) { return sum+n; },0) > 200) throw new Error();
      if (payload.cards) printOptions = {flip:payload.flip,marginMm:payload.marginMm,tokenStyle:payload.tokenStyle};
      quantities = incoming;
      try { localStorage.setItem(STORAGE,JSON.stringify(quantities)); } catch (error) { storageWarning = 'Набор сохранится только до перезагрузки страницы.'; }
    }
  } catch (error) { storageWarning = 'Не удалось импортировать набор по ссылке. Сохранённый набор доступен для проверки.'; }
  var loaded;
  function json(url) { return root.FSCache.json(url,{fresh:url.indexOf('api/')===0}); }
  function load() {
    if (!loaded) loaded=catalogAPI.loadPrintCatalog().catch(function (error) { loaded=null; throw error; });
    return loaded;
  }
  api.load=load;
  function image(src) {
    return new Promise(function (resolve,reject) {
      var img = new Image(), timer = setTimeout(function () {
        img.onload = img.onerror = null; img.removeAttribute('src'); reject(new Error('Не завершена загрузка ' + src));
      },15000);
      img.onload = function () { clearTimeout(timer); resolve(img); };
      img.onerror = function () { clearTimeout(timer); reject(new Error('Отсутствует изображение ' + src)); }; img.src = src;
    });
  }
  function element(tag,text,parent) { var node = document.createElement(tag); if (text) node.textContent = text; if (parent) parent.appendChild(node); return node; }
  api.count = function () { return Object.values(quantities).reduce(function (n,q) { return n + (Number.isInteger(q) && q > 0 ? q : 0); },0); };
  api.selection = function () { return Object.assign({},quantities); };
  api.setQuantity = function (id,n) {
    if (!Number.isInteger(n) || n < 0 || n > 20) throw new Error('Допустимо от 0 до 20 экземпляров');
    if (n && !CARD_ID.test(id)) throw new Error('Некорректный идентификатор карты');
    if (n) quantities[id] = n; else delete quantities[id]; version++;
    try { localStorage.setItem(STORAGE,JSON.stringify(quantities)); } catch (error) { storageWarning = 'Набор сохранится только до перезагрузки страницы.'; }
    root.dispatchEvent(new Event('fs-print-change'));
  };
  api.clear = function () { quantities = {}; api.setQuantity('',0); };
  function syncButtons() {
    document.querySelectorAll('[data-print-id]').forEach(function (button) {
      var n = quantities[button.dataset.printId] || 0;
      if (button.dataset.printAction === 'add') button.textContent = n ? 'Ещё +1 (' + n + ')' : 'Добавить';
      else { button.textContent = n ? 'В наборе (' + n + ')' : 'В печать'; button.setAttribute('aria-pressed',String(!!n)); }
    });
    document.querySelectorAll('.fs-print-launch').forEach(function (button) { button.textContent = 'Печать (' + api.count() + ')'; });
  }
  root.addEventListener('fs-print-change',syncButtons);
  api.cardButton = function (card) {
    var match = /^(?:\.\/)?factions\/((?:base|gif|sow|dl)\/[a-z]+)\/(combat|orders|events)\/([a-z0-9_]+)\.jpg$/.exec(card.src || '');
    if (!match) return null;
    var button = element('button','В печать'); button.className = 'fs-print-card'; button.type = 'button'; button.disabled = true;
    if (match[1].startsWith('dl/')) { button.textContent = 'Печать TDL пока недоступна'; button.title = 'Русский перевод есть в справочнике; печатный формат и контрольный комплект TDL ещё не подтверждены.'; return button; }
    var id = match[1] + '/' + match[2] + '/' + match[3];
    load().then(function (data) {
      var entry = data.cards.find(function (c) { return c.id === id; });
      if (!entry) { button.title = 'Нет подтверждённого печатного источника'; return; }
      button.disabled = false; button.dataset.printId = id; button.setAttribute('aria-label','В печать: ' + entry.title + ' · ' + entry.factionTitle);
      button.onclick = function (event) { event.stopPropagation(); api.setQuantity(id,quantities[id] ? 0 : 1); }; syncButtons();
    }).catch(function (error) { button.title = error.message; button.textContent = 'Печать недоступна'; });
    return button;
  };
  api.prepare = async function (catalog,cards,chosen,calibration,flip,progress,options) {
    options = options || {};
    var settings = {flip:flip,marginMm:options.marginMm === undefined ? 5 : options.marginMm,tokenStyle:options.tokenStyle || 'images'};
    if (!validOptions(settings)) throw new Error('Проверьте переворот, вид жетонов и поля от 5 до 20 мм');
    var selection = calibration ? catalog.calibrationIds.map(function (id) { var c = cards.find(function (card) { return card.id === id; }); if (!c) throw new Error('Нет контрольной карты: ' + id); return c; }) : selected(cards,chosen);
    if (!calibration && (!total(cards,chosen) || total(cards,chosen) > 200)) throw new Error('Выберите от 1 до 200 экземпляров');
    var rendered = [];
    for (var i=0; i<selection.length; i++) {
      var card = selection[i]; if (progress) progress('Подготовка ' + (i+1) + '/' + selection.length + ': ' + card.title);
      await image(card.src); await image(card.backSrc);
      var source = await image(card.template && card.template.picture || card.src);
      var front = null, minimumTextPt = 0;
      if (card.renderMode === 'composite') {
        var size = dimensions(catalog.widthMm,catalog.heightMm,catalog.dpi,source.naturalWidth,source.naturalHeight);
        front = await root.FSCardRender.compose(Object.assign({},card,{wording:options.tokenStyle || 'images'}),{width:size.width,height:size.height,strict:true,onMetrics:function (metrics) {
          minimumTextPt = metrics.minimumBodyPx * Math.min(catalog.widthMm/size.width,catalog.heightMm/size.height) * 72/25.4;
        }});
        if (!Number.isFinite(minimumTextPt) || minimumTextPt <= 0) throw new Error('Не завершено измерение текста: ' + card.id);
        if (!front.startsWith('data:image/png;base64,')) throw new Error('Рендер вернул шаблон: ' + card.id);
      }
      rendered.push({id:card.id,quantity:calibration ? 1 : chosen[card.id],rendered:true,front:front,minimumTextPt:minimumTextPt,sourceVersion:card.sourceVersion});
    }
    return {catalogId:catalog.id,flip:flip,calibration:calibration,marginMm:settings.marginMm,cards:rendered};
  };
  api.open = async function (options) {
    if (document.querySelector('.fs-print')) return;
    options = options || {};
    var returnFocus = document.activeElement, dialog = element('dialog'); dialog.className = 'fs-print'; dialog.setAttribute('aria-labelledby','fs-print-title');
    element('h2','Набор для печати',dialog).id = 'fs-print-title';
    var close = element('button','Закрыть',dialog); close.className = 'fs-print-close'; close.type = 'button';
    var pdfUrl = null, busy = false, changed;
    close.onclick = function () { if (!busy) dialog.close(); };
    dialog.addEventListener('cancel',function (e) { if (busy) e.preventDefault(); });
    dialog.addEventListener('close',function () { if (pdfUrl) URL.revokeObjectURL(pdfUrl); root.removeEventListener('fs-print-change',changed); dialog.remove(); if (returnFocus && returnFocus.isConnected) returnFocus.focus(); });
    document.body.appendChild(dialog); dialog.showModal();
    var status = element('p','Загрузка каталога…',dialog); status.setAttribute('role','status'); status.setAttribute('aria-live','polite');
    try {
      var data = await load(), catalog = data.catalog, cards = data.cards;
      if (!dialog.open) return;
      element('p','Добавляйте отдельные карты разных фракций и типов. Набор сохраняется при переходах и перезагрузке.',dialog);
      element('p','A4 · 63×88 мм · 300 DPI · без вылетов. Физическая проверка пока не проведена.',dialog);
      var info=element('details','',dialog); element('summary','Качество, ограничения и настройки печати',info);
      element('p','Книжная ориентация; укажите поля вашего принтера; печать 100%, без подгонки. Номинальный формат и совмещение сторон проверьте на контрольном листе. Изображения низкого DPI и мелкий текст будут перечислены перед скачиванием.',info);
      var evidence = element('p','Русская печать: база, Galaxy in Flames и Symphony of War. Печатный формат TDL ещё не подтверждён; его русский перевод доступен в справочнике. ',info);
      var source = element('a','Источник номинального размера',evidence); source.href = catalog.sizeEvidence[0].url; source.target = '_blank'; source.rel = 'noopener';
      var localEngine = location.hostname === '127.0.0.1' && location.port === '5274';
      var setup = element('details','',dialog); setup.open=!localEngine;
      element('summary','Локальный модуль печати',setup);
      element('p','PDF создаёт BoardGame.Printing на вашем компьютере. Запустите модуль из его папки и откройте набор по ссылке ниже. На публичном сайте PDF не генерируется.',setup);
      element('pre','dotnet run -- --serve --site ../Forbidden_Star/page',setup);
      var localLink=element('a','Открыть этот набор в локальном модуле',setup); localLink.target='_blank'; localLink.rel='noopener';
      var controls = element('div','',dialog); controls.className = 'fs-print-controls'; element('button','Очистить набор',controls).onclick = api.clear;
      var flip = element('select','',element('label','Переворот листа: ',controls)); flip.setAttribute('aria-label','Переворот листа');
      [['long','По длинной стороне'],['short','По короткой стороне']].forEach(function (o) { element('option',o[1],flip).value=o[0]; });
      var margin=element('input','',element('label','Поля принтера, мм: ',controls)); margin.type='number'; margin.min='5'; margin.max='20'; margin.step='0.5'; margin.value=printOptions.marginMm; margin.setAttribute('aria-label','Поля принтера, мм');
      var token=element('select','',element('label','Жетоны в PDF: ',controls)); token.setAttribute('aria-label','Жетоны в PDF');
      [['images','Изображения'],['icons','Чёрно-белые символы']].forEach(function (o) { element('option',o[1],token).value=o[0]; });
      flip.value=printOptions.flip; token.value=printOptions.tokenStyle;
      element('h3','Выбранные карты',dialog);
      var table = element('table','',dialog); table.className='fs-print-cart';
      var header = element('tr','',element('thead','',table)); ['Карта / фракция','Копии','Рубашка',''].forEach(function (text) { element('th',text,header).scope='col'; });
      var body = element('tbody','',table), rows = new Map(), summary = element('p','',dialog); summary.className='fs-print-summary';
      var details = element('details','',dialog); details.open = !api.count(); element('summary','Добавить отдельные карты',details);
      var filters = element('div','',details); filters.className='fs-print-controls';
      var faction = element('select','',element('label','Фракция: ',filters)); faction.setAttribute('aria-label','Фракция для печати'); element('option','Все фракции',faction).value='';
      catalog.factions.forEach(function (f) { element('option',f.title+' · '+f.expansion,faction).value=f.id; });
      if (catalog.factions.some(function (f) { return f.id===options.factionId; })) faction.value=options.factionId;
      var category = element('select','',element('label','Тип: ',filters)); category.setAttribute('aria-label','Тип карт для печати'); element('option','Все типы',category).value='';
      Object.keys(TYPES).forEach(function (key) { element('option',TYPES[key],category).value=key; });
      var search=element('input','',element('label','Поиск: ',filters)); search.type='search'; search.setAttribute('aria-label','Поиск карт для печати');
      var list=element('div','',details); list.className='fs-print-picker';
      function renderPicker() {
        list.replaceChildren(); var query=search.value.toLocaleLowerCase('ru').replace(/ё/g,'е');
        cards.filter(function (c) { return (!faction.value || c.factionId===faction.value) && (!category.value || c.category===category.value) && (c.title+' '+c.id+' '+c.factionTitle).toLocaleLowerCase('ru').replace(/ё/g,'е').includes(query); }).forEach(function (c) {
          var row=element('div','',list); row.className='fs-print-picker-row'; var name=element('span',c.title,row); element('small',c.factionTitle+' · '+TYPES[c.category],name);
          var add=element('button','Добавить',row); add.dataset.printId=c.id; add.dataset.printAction='add'; add.setAttribute('aria-label','Добавить в печать: '+c.title+' · '+c.factionTitle);
          add.onclick=function () { if ((quantities[c.id]||0)>=20) { status.textContent='Не более 20 копий одной карты'; return; } api.setQuantity(c.id,(quantities[c.id]||0)+1); };
        });
        if (!list.children.length) element('p','Карты не найдены',list); syncButtons();
      }
      faction.onchange=category.onchange=search.oninput=renderPicker;
      var actions=element('div','',dialog); actions.className='fs-print-controls';
      var generate=element('button','Подготовить PDF и предпросмотр',actions), calibrate=element('button','Контрольный лист — '+catalog.calibrationIds.length+' карт',actions);
      var warnings=element('div','',dialog); warnings.className='fs-print-warnings'; warnings.setAttribute('role','region'); warnings.setAttribute('aria-label','Проверка качества');
      var download=element('a','Скачать PDF',dialog); download.hidden=true; download.className='fs-print-download';
      var openPreview=element('a','Открыть все страницы PDF в отдельной вкладке',dialog); openPreview.hidden=true; openPreview.target='_blank'; openPreview.rel='noopener';
      var preview=element('div','',dialog); preview.className='fs-print-preview'; preview.setAttribute('aria-label','Предпросмотр лицевых и оборотных страниц'); preview.hidden=true;
      element('p','Страницы: 1 — лицо первого листа, 2 — его оборот, затем следующая пара. В драйвере выберите тот же переворот. Сначала проверьте контрольный лист: линейку 100 мм, карты 63×88 мм, подписи и рубашки на просвет. Физическая печать пока не проверена.',dialog);
      function invalidate() {
        var current = {flip:flip.value,marginMm:Number(margin.value),tokenStyle:token.value};
        if (margin.value && margin.validity.valid && validOptions(current)) printOptions = current;
        updateTransferLink();
        if (status.textContent.startsWith('PDF готов')) status.textContent='Набор или параметры изменены. Подготовьте PDF заново.';
        if (pdfUrl) URL.revokeObjectURL(pdfUrl); pdfUrl=null;
        [download,openPreview].forEach(function (a) { a.hidden=true; a.removeAttribute('href'); }); preview.hidden=true; preview.replaceChildren(); warnings.replaceChildren();
      }
      function updateTransferLink() {
        var valid = !!margin.value && margin.validity.valid && Array.from(body.querySelectorAll('input')).every(function (input) { return !!input.value && input.validity.valid; });
        try { valid = valid && total(cards,quantities) <= 200; } catch (e) { valid = false; }
        localLink.setAttribute('aria-disabled',String(!valid)); localLink.tabIndex = valid ? 0 : -1;
        if (valid) localLink.href='http://127.0.0.1:5274/#print='+encodeURIComponent(JSON.stringify(Object.assign({cards:api.selection()},printOptions)));
        else localLink.removeAttribute('href');
      }
      function updateCart() {
        var ids=Object.keys(quantities), error='';
        rows.forEach(function (row,id) { if (!ids.includes(id)) { row.remove(); rows.delete(id); } });
        ids.forEach(function (id) {
          var c=cards.find(function (card) { return card.id===id; });
          if (!rows.has(id)) {
            var row=element('tr','',body); row.dataset.cartId=id; rows.set(id,row);
            var name=element('td',c ? c.title : id,row); element('small',c ? c.factionTitle+' · '+TYPES[c.category] : 'Нет печатного источника',name); element('small',id,name);
            var input=element('input','',element('td','',row)); input.type='number'; input.min='1'; input.max='20'; input.step='1'; input.setAttribute('aria-label','Экземпляры: '+(c ? c.title+' · '+c.factionTitle : id));
            input.oninput=function () {
              if (!input.value) { generate.disabled=true; invalidate(); return; }
              try { api.setQuantity(id,Number(input.value)); } catch (e) { status.textContent=e.message; generate.disabled=true; invalidate(); }
            };
            var back=element('td','',row);
            if (c) { var thumbnail=element('img','',back); thumbnail.src=c.backSrc; thumbnail.alt='Рубашка: '+c.factionTitle+', '+TYPES[c.category]; thumbnail.className='fs-print-back'; element('small',TYPES[c.category]+' · '+c.back,back); }
            var remove=element('button','Удалить',element('td','',row)); remove.setAttribute('aria-label','Удалить из печати: '+(c ? c.title+' · '+c.factionTitle : id)); remove.onclick=function () { api.setQuantity(id,0); };
          }
          var input=rows.get(id).querySelector('input');
          if (input._quantity !== quantities[id] && input !== document.activeElement) input.value=quantities[id];
          input._quantity = quantities[id];
        });
        try { var count=total(cards,quantities); summary.textContent=ids.length ? ids.length+' разных карт · '+count+' экземпляров' : 'Набор пуст. Добавьте отдельные карты ниже или в картотеке.'; generate.disabled=busy || !localEngine || !count || count>200; if (count>200) error='В одном PDF допустимо до 200 экземпляров'; }
        catch (e) { error=e.message; generate.disabled=true; }
        if (Array.from(body.querySelectorAll('input')).some(function (input) { return !input.value || !input.validity.valid; })) { error='Укажите целое количество от 1 до 20 для каждой карты'; generate.disabled=true; }
        if (!margin.validity.valid || !margin.value) { error='Укажите поля от 5 до 20 мм'; generate.disabled=true; }
        calibrate.disabled=busy || !localEngine || !margin.validity.valid || !margin.value;
        updateTransferLink();
        if (error) { status.textContent=error; generate.disabled=true; }
      }
      changed=function () { invalidate(); updateCart(); }; root.addEventListener('fs-print-change',changed); flip.onchange=token.onchange=function () { invalidate(); updateCart(); }; margin.oninput=function () { invalidate(); updateCart(); };
      async function run(calibration) {
        invalidate(); busy=true; var jobVersion=version;
        var controls=dialog.querySelectorAll('button,input,select'); controls.forEach(function (control) { control.disabled=true; });
        try {
          var engine;
          try { engine=await json('api/print/status'); } catch (e) { throw new Error('Локальный модуль не запущен. В BoardGame.Printing выполните: dotnet run -- --serve --site /путь/Forbidden_Star/page. Откройте http://127.0.0.1:5274.'); }
          if (engine.protocol!==4 || engine.catalogId!==catalog.id) throw new Error('Обновите локальный модуль BoardGame.Printing: требуется протокол 4');
          var request=await api.prepare(catalog,cards,api.selection(),calibration,flip.value,function (text) { status.textContent=text; },{marginMm:Number(margin.value),tokenStyle:token.value}); status.textContent='BoardGame.Printing формирует PDF…';
          var requestBody=JSON.stringify(request);
          if (new Blob([requestBody]).size>64*1024*1024) throw new Error('Набор превышает 64 MiB. Разделите его на несколько PDF. Выбранные карты сохранены.');
          var response=await fetch('api/print/pdf',{method:'POST',headers:{'Content-Type':'application/json','X-Print-Token':engine.token},body:requestBody,signal:AbortSignal.timeout(120000)});
          var result=await response.json(); if (!response.ok) throw new Error(result.error || 'Ошибка PDF: '+response.status);
          if (version!==jobVersion) throw new Error('Набор изменился во время экспорта. Подготовьте PDF заново.');
          if (!Array.isArray(result.previews) || result.previews.length!==result.pages) throw new Error('Не завершён предпросмотр всех страниц');
          var bytes=Uint8Array.from(atob(result.pdfBase64),function (c) { return c.charCodeAt(0); }); pdfUrl=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
          download.href=pdfUrl; download.download=(calibration ? 'mixed-calibration-' : 'mixed-cards-')+flip.value+'.pdf';
          preview.hidden=false; openPreview.href=pdfUrl; openPreview.hidden=false; download.hidden=false;
          result.previews.forEach(function (url,index) {
            var figure=element('figure','',preview);
            element('figcaption','Лист '+(Math.floor(index/2)+1)+' · '+(index%2 ? 'оборот' : 'лицо')+' · страница '+(index+1),figure);
            var img=element('img','',figure); img.src=url; img.alt='Страница '+(index+1)+': '+(index%2 ? 'рубашки' : 'лица');
          });
          element('p',(calibration ? 'Контрольный лист. ' : 'Ваш набор. ')+result.cards+' карт, '+result.pages+' страниц. Переворот '+(flip.value==='long' ? 'по длинной стороне.' : 'по короткой стороне.')+' Предпросмотр и PDF используют одну раскладку. Поля принтера '+request.marginMm+' мм; сетка '+result.layout.columns+'×'+result.layout.rows+'; размер карты 63×88 мм.',warnings);
          var list=element('ul','',warnings); result.warnings.forEach(function (w) { element('li',w,list); }); status.textContent='PDF готов. Проверьте обе стороны и предупреждения перед скачиванием.';
        } catch (e) { status.textContent=e.message; }
        finally { busy=false; controls.forEach(function (control) { control.disabled=false; }); updateCart(); }
      }
      generate.onclick=function () { run(false); }; calibrate.onclick=function () { run(true); }; renderPicker(); updateCart();
      if (status.textContent==='Загрузка каталога…') status.textContent=storageWarning || (localEngine ? 'Добавьте карты и подготовьте PDF.' : 'Для экспорта откройте набор в локальном модуле.');
    } catch (error) { status.textContent=error.message; }
  };
  if (importRequested) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',function () { api.open(); },{once:true});
    else api.open();
  }
})(typeof window !== 'undefined' ? window : globalThis);
