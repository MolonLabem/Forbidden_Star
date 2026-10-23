/* Forbidden Stars — Картотека карточек
 * Ванильный, управляемый данными браузер карточек. Без фреймворков и сборки.
 *
 * Структура данных (в page/factions/):
 *   general.json                       — дополнения (+color), категории, labels, filenames
 *   <expansion>/faction.json           — фракции (+color), имена
 *   <expansion>/<faction>/text.json    — метаданные: необязательные filenames и текст карточек
 *   <expansion>/<faction>/<folder>/<file>  — изображения карточек
 *
 * Загрузка и ошибки изображений показываются явно, с возможностью повторить.
 */
(function () {
  'use strict';

  var ACCENT = 'amber'; // amber | steel | crimson
  var DENSITY = 5;

  function density() {
    var w = window.innerWidth || 1200;
    if (w <= 480) return 2;
    if (w <= 720) return 3;
    if (w <= 1024) return 4;
    if (w <= 1440) return DENSITY;
    return DENSITY + 1;
  }

  // ключ категории → папка на диске
  var FOLDER = window.FSCatalog.folders;

  var DOT_FALLBACK = '#857f74';
  var ACCENT_FALLBACK = '#d8a657';

  var ACC = {
    amber:   { a: 'oklch(0.80 0.12 80)',  fg: '#1c1810' },
    steel:   { a: 'oklch(0.72 0.10 232)', fg: '#0b1019' },
    crimson: { a: 'oklch(0.62 0.185 25)', fg: '#1c0d0c' },
  };

  /* ---- Высокое разрешение карточек ---- */

  var CARD_RESOLUTION_KEY = 'forbidden-stars.high-resolution-cards';
  var useHighRes = (function () {
    try { return localStorage.getItem(CARD_RESOLUTION_KEY) === 'true'; } catch (e) { return false; }
  })();
  var TOKEN_STYLE_KEY = 'forbidden-stars.token-style';
  var tokenStyle = (function () {
    try { return localStorage.getItem(TOKEN_STYLE_KEY) === 'icons' ? 'icons' : 'images'; } catch (e) { return 'images'; }
  })();

  function applyResolution(hi) {
    useHighRes = hi;
    try { localStorage.setItem(CARD_RESOLUTION_KEY, String(hi)); } catch (e) {}
  }

  // Применяем сохранённое значение при запуске
  applyResolution(useHighRes);

  /* ---- Хранилище данных ---- */

  var DATA = {
    general:   null,
    expansions: [],
    categories: [],
    defaults:  null,
    factions:  {},
    manifest:  {},
    text:      {},
    cards:     {},
    faq:       null,
    cardnames: {},
    loading:   {},
    errors:    {},
  };

  // Напечатанное название карточки (из cardnames.json) или запасной вариант
  function cardName(exp, fac, cat, file, fallback) {
    var n = DATA.cardnames[exp + '/' + fac + '/' + cat + '/' + file];
    return n || fallback;
  }

  function ensureFaq() {
    if (DATA.faq || DATA.loading.faq || DATA.errors.faq || !window.FS_FAQ) return;
    DATA.loading.faq = true;
    fetchJSON(window.FS_FAQ.src).then(function (raw) {
      if (DATA.expansions.length) {
        window.FS_FAQ.dots = [ACCENT_FALLBACK].concat(DATA.expansions.map(function (e) { return e.color; }));
      }
      DATA.faq = window.FS_FAQ.flatten(raw);
      DATA.loading.faq = false;
      render();
    }).catch(function (e) {
      console.error('Ошибка загрузки FAQ', e);
      DATA.loading.faq = false;
      DATA.errors.faq = true;
      render();
    });
  }

  var initialRoute = window.FSNav.read(location.hash);
  var lastSeenHash = location.hash;
  var pendingCard = initialRoute.card;
  var pendingQuestion = initialRoute.question;
  var returnCard = null, returnFocus = null, oldOverflow = null;
  var lazyObserver = null, imageQueue = [], runningImages = 0, imagePump = false;
  var state = {
    expansion: null, faction: null, category: 'combat',
    lb: null, lbFull: false,
    view: 'codex',
    faqTopic: 'all', faqQuery: '', faqOpen: {},
    expOpen: null,
    cardQuery: '',
    faqQuestion: null, settingsOpen: false, navOpen: false, faqNavOpen: false,
  };
  ['view', 'expansion', 'faction', 'category', 'cardQuery', 'faqQuery', 'faqTopic'].forEach(function (key) { state[key] = initialRoute[key]; });
  state.expOpen = state.expansion;
  state.faqQuestion = initialRoute.question;
  if (pendingQuestion) state.faqOpen[pendingQuestion] = true;
  var flat = [];

  function updateURL(replace) {
    var card = state.lb !== null && flat[state.lb] ? flat[state.lb].src : pendingCard;
    var hash = window.FSNav.write(state, card, state.faqQuestion);
    if (hash !== location.hash) history[replace ? 'replaceState' : 'pushState'](null, '', location.pathname + location.search + hash);
    lastSeenHash = location.hash;
  }

  function setState(patch, replace) {
    if (patch.lb === null) pendingCard = null;
    for (var k in patch) { if (patch.hasOwnProperty(k)) state[k] = patch[k]; }
    render();
    updateURL(replace);
  }

  function restoreRoute() {
    if (lastSeenHash === location.hash) return;
    lastSeenHash = location.hash;
    var wasModal = state.lb !== null;
    var route = window.FSNav.read(location.hash);
    releaseModal();
    ['view', 'expansion', 'faction', 'category', 'cardQuery', 'faqQuery', 'faqTopic'].forEach(function (key) { state[key] = route[key]; });
    state.lb = null; state.lbFull = false;
    state.expOpen = route.expansion; state.faqQuestion = route.question;
    pendingCard = route.card; pendingQuestion = route.question;
    if (route.question) state.faqOpen[route.question] = true;
    render();
    if (wasModal && state.lb === null && returnCard) {
      var target = document.querySelector('[data-card-id="' + returnCard + '"]');
      if (target) target.focus({ preventScroll: true });
    }
  }
  window.addEventListener('popstate', restoreRoute);
  window.addEventListener('hashchange', restoreRoute);

  // Монтирует дерево в #app, сохраняя фокус поля поиска при перерисовке
  function mountApp(app) {
    var root = document.getElementById('app');
    var ae = document.activeElement, sel = null, focusId = ae && ae.id;
    if (ae && ae.classList && ae.classList.contains('fs-faq-search')) {
      sel = { s: ae.selectionStart, e: ae.selectionEnd };
    }
    if (pendingCard && state.view === 'codex') {
      var index = flat.findIndex(function (card) { return card.src === pendingCard; });
      if (index >= 0) { state.lb = index; returnCard = flat[index].src; pendingCard = null; }
    }
    if (state.lb !== null && state.view === 'codex') appendLightbox(app);
    if (lazyObserver) lazyObserver.disconnect();
    imageQueue = [];
    root.innerHTML = '';
    root.appendChild(app);
    observeCards(root);
    var modalImage = root.querySelector('.fs-lb-imgwrap > img');
    if (modalImage) loadCardImage(modalImage, false);
    if (sel) {
      var inp = root.querySelector('.fs-faq-search');
      if (inp) { inp.focus(); try { inp.setSelectionRange(sel.s, sel.e); } catch (e) {} }
    } else if (focusId) {
      var target = document.getElementById(focusId); if (target) target.focus({ preventScroll: true });
    }
    if (state.lb !== null) focusModal();
    else releaseModal();
    if (pendingQuestion && DATA.faq) {
      var question = document.getElementById('question-' + pendingQuestion);
      if (question) { question.scrollIntoView({ block: 'center' }); question.querySelector('button').focus({ preventScroll: true }); }
      pendingQuestion = null;
    }
  }

  function fetchJSON(url) { return window.FSCache.json(url); }

  /* ---- Вспомогательные функции ---- */

  // Склонение числительных в русском языке
  function ruPlural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  }

  function factionDot(fj, index) {
    var c = fj.color && fj.color[index];
    if (typeof c === 'string') return c;
    if (c && c.accent) return c.accent;
    return DOT_FALLBACK;
  }

  function tierLabel(ti) {
    var tiers = (DATA.general && DATA.general.labels && DATA.general.labels.tiers) || [];
    return tiers[ti] || ('Набор ' + (ti + 1));
  }

  function backLabel(file) {
    var key = file.replace(/\.[a-z]+$/i, '');
    var backs = (DATA.general && DATA.general.labels && DATA.general.labels.backs) || {};
    return backs[key] || 'Задник';
  }

  function expColor(key) {
    var e = findKey(DATA.expansions, key);
    return (e && e.color) || DOT_FALLBACK;
  }

  function ensureFactions(exp) {
    if (DATA.factions[exp] || DATA.loading['fac:' + exp] || DATA.errors['fac:' + exp]) return;
    DATA.loading['fac:' + exp] = true;
    fetchJSON('factions/' + exp + '/faction.json').then(function (fj) {
      var list = (fj.folder || []).map(function (key, i) {
        return { key: key, name: (fj.name && fj.name[i]) || key, dot: factionDot(fj, i) };
      });
      DATA.factions[exp] = list;
      DATA.loading['fac:' + exp] = false;
      list.forEach(function (f) { ensureManifest(exp, f.key); });
      if (state.expansion === exp && !state.faction && list[0]) state.faction = list[0].key;
      render();
    }).catch(function (e) {
      DATA.loading['fac:' + exp] = false;
      DATA.errors['fac:' + exp] = true;
      console.error(e);
      render();
    });
  }

  function retryFactions(exp) {
    delete DATA.errors['fac:' + exp];
    ensureFactions(exp);
    render();
  }

  // Манифест нужен до показа карточек: часть изображений содержит только шаблон.
  function ensureManifest(exp, fac) {
    var id = exp + '/' + fac;
    if (DATA.manifest[id] || DATA.loading['man:' + id] || DATA.errors['man:' + id]) return;
    DATA.loading['man:' + id] = true;
    fetchJSON('factions/' + exp + '/' + fac + '/text.json').then(function (t) {
      DATA.manifest[id] = window.FSCatalog.manifest(DATA.general,t);
      DATA.cards[id] = window.FSCatalog.factionCards(DATA.general,t,exp,fac,facNameOf(exp,fac));
      DATA.text[id] = {
        materials: (t && t.materialsText) || null,
      };
      DATA.loading['man:' + id] = false;
      render();
    }).catch(function (e) {
      console.error('Ошибка загрузки карточек', e);
      DATA.loading['man:' + id] = false;
      DATA.errors['man:' + id] = true;
      render();
    });
  }

  function manifestCount(man) {
    if (!man) return null;
    var n = 0;
    (man.combat || []).forEach(function (tier) { n += tier.length; });
    // Счётчик фракции включает только боевые карты, приказы и события.
    ['orders', 'events'].forEach(function (k) { n += (man[k] || []).length; });
    return n;
  }

  /* ---- Справочные функции ---- */

  function facList() { return DATA.factions[state.expansion] || []; }
  function facName(k) { var f = findKey(facList(), k); return f ? f.name : ''; }
  function catName(k) {
    var labels = (DATA.general && DATA.general.labels) || {};
    if (k === 'material' && labels.material) return labels.material;
    var c = findKey(DATA.categories, k);
    return c ? c.name : '';
  }
  function expName(k) { var e = findKey(DATA.expansions, k); return e ? e.name : ''; }
  function findKey(list, key) {
    for (var i = 0; i < list.length; i++) { if (list[i].key === key) return list[i]; }
    return null;
  }

  /* ---- Строитель элементов DOM ---- */

  function el(tag, props, children) {
    var node = document.createElement(tag);
    props = props || {};
    for (var key in props) {
      if (!props.hasOwnProperty(key)) continue;
      var val = props[key];
      if (val == null) continue;
      if (key === 'class') node.className = val;
      else if (key === 'html') node.innerHTML = val;
      else if (key === 'text') node.textContent = val;
      else if (key.indexOf('on') === 0 && typeof val === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), val);
      } else {
        node.setAttribute(key, val);
      }
    }
    if (children) {
      if (!Array.isArray(children)) children = [children];
      for (var i = 0; i < children.length; i++) {
        var c = children[i];
        if (c == null || c === false) continue;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      }
    }
    return node;
  }

  function loadError(message, retry) {
    return el('div', { class: 'fs-load-error', role: 'alert' }, [
      el('p', { class: 'fs-note', text: message }),
      el('button', { class: 'fs-empty-btn', text: 'Повторить загрузку', onclick: retry }),
    ]);
  }

  function openFaq() {
    delete DATA.errors.faq;
    setState({ view: 'faq', cardQuery: '', lb: null });
  }

  function renderSettings() {
    var mode = el('select', { id: 'fs-wording', onchange: function (e) {
      setTokenStyle(e.target.value);
    } }, [el('option', { value: 'icons', text: 'Чёрно-белые' }), el('option', { value: 'images', text: 'Изображения' })]);
    mode.value = tokenStyle;
    var input = el('input', { type: 'checkbox', id: 'fs-res-toggle', checked: useHighRes ? 'checked' : null,
      onchange: function (e) { applyResolution(e.target.checked); render(); } });
    var legend = el('div', { class: 'fs-token-legend' }, window.FSWord.tokens.map(function (token) {
      return el('div', {}, [window.FSWord.append(el('span'), token.glyph, tokenStyle), ' — ' + token.label]);
    }));
    return el('details', { class: 'fs-settings', open: state.settingsOpen ? '' : null,
      ontoggle: function (e) { state.settingsOpen = e.target.open; } }, [
      el('summary', { 'aria-label': 'Отображение' }, [
        el('span', { class: 'fs-settings-label', text: 'Отображение' }),
        el('span', { class: 'fs-settings-short', text: 'Вид', 'aria-hidden': 'true' }),
      ]),
      el('div', { class: 'fs-settings-panel' }, [
        el('label', { for: 'fs-wording', text: 'Вид жетонов' }), mode,
        el('label', { class: 'fs-resolution-option' }, [input, ' Повышенная чёткость открытых карт']), legend,
      ]),
    ]);
  }

  function setTokenStyle(mode) {
    tokenStyle = mode === 'images' ? 'images' : 'icons';
    try { localStorage.setItem(TOKEN_STYLE_KEY, tokenStyle); } catch (error) {}
    render();
  }

  function mobileNavigation(nav, label, key, id) {
    nav.id = id;
    nav.classList.add('fs-mobile-nav');
    nav.classList.toggle('is-mobile-open', state[key]);
    return el('button', { type: 'button', class: 'fs-mobile-nav-toggle',
      'aria-expanded': String(state[key]), 'aria-controls': id,
      onclick: function (e) {
        state[key] = !state[key];
        nav.classList.toggle('is-mobile-open', state[key]);
        e.currentTarget.setAttribute('aria-expanded', String(state[key]));
      },
    }, [el('span', { text: label }), el('span', { class: 'fs-mobile-nav-chevron', text: '⌄', 'aria-hidden': 'true' })]);
  }

  /* ---- Композитинг / растрирование карточек ---- */

  function cardRatio(card) {
    return card.aspect || card.text && card.text.aspect || 450 / 650;
  }

  // Reserve provisional space, then fit the decoded image inside the viewport.
  function fitViewer(wrap, card, ratio) {
    ratio = ratio || cardRatio(card);
    var mobile = window.innerWidth <= 720;
    var sheet = card.kind === 'sheet';
    var availableWidth = mobile ? window.innerWidth - 24 : (state.lbFull || sheet ? window.innerWidth - 192 : Math.min(1100, window.innerWidth - 192)) - (card.text && !sheet ? 304 : 0);
    var availableHeight = window.innerHeight - (mobile ? (state.lbFull ? 220 : 280) : (state.lbFull ? 128 : sheet ? 235 : 190));
    var width = Math.max(1, Math.min(availableWidth, availableHeight * ratio, state.lbFull || ratio > 1 ? Infinity : 500));
    wrap.style.setProperty('--fs-lb-width', width + 'px');
    wrap.style.setProperty('--fs-lb-ratio', ratio);
  }

  function displayPixels(img, thumbnail) {
    // Layout pixels exclude the viewer's entrance/hover transforms.
    var width = img.parentNode.offsetWidth;
    // The grid is a preview, independent of device DPI and the viewer HD setting.
    if (thumbnail) {
      var limit=['faction_card','map'].includes(img._fsCard.category)?640:320;
      return {w:Math.min(limit,Math.max(256,Math.ceil(width/32)*32))};
    }
    // Supersample text even on a 1× screen. Buckets keep the bounded cache useful
    // across small viewport changes; the optional setting adds rendering detail.
    var scale = Math.max(useHighRes ? 3 : 2, window.devicePixelRatio || 1);
    var w = Math.ceil(Math.max(900, width * scale) / 64) * 64;
    if (img._fsCard.kind === 'overlay') w = Math.max(1600, w);
    return { w: w };
  }

  function isCardShaped(card) {
    if (card.kind) return true;
    return /\/(combat|orders|events|backs)\//.test(card.src || '');
  }

  async function cardImageURL(imgEl, card, thumbnail) {
    var pixels = displayPixels(imgEl, thumbnail);
    if (card.kind === 'sheet' && !thumbnail) {
      var source = await window.FSCardRender.sourceInfo(card);
      // Conservative resampling for the art; all translated glyphs are redrawn.
      var scale = card.exp === 'sow' ? 1.4 : card.exp === 'dl' ? 1 : 1.15;
      pixels.w = Math.round(source.width * scale);
    }
    if (card.text && card.kind && window.FSCardRender) {
      // Render the text directly at display resolution, losslessly, from the full
      // template. Enlarging the precomposed 270px JPEG loses the small letterforms.
      return window.FSCardRender.compose({ src: card.src,
        kind: card.kind, text: card.text, template: card.template, wording: tokenStyle,
        width: pixels.w, thumbnail:thumbnail,
      }, { rejectOnError: true });
    }
    // Baked cards retain their native detail and proportions; resampling them to
    // a larger PNG cannot improve quality. Small grids may still use thumbnails.
    return Promise.resolve(thumbnail && pixels.w <= 320 && isCardShaped(card) ? 'thumbnails/' + card.src : card.src);
  }

  function prepareCard(img, card, modal) {
    img._fsCard = card;
    img.className = 'fs-card-image';
    var wrap = img.parentNode;
    wrap.classList.add('is-loading');
    wrap.setAttribute('aria-busy', 'true');
    if (!modal) wrap.setAttribute('aria-label', card.label);
    if (!modal && (card.aspect || card.text && card.text.aspect)) wrap.style.aspectRatio = String(cardRatio(card));
    var status = el('span', { class: 'fs-image-status', role: modal ? 'status' : null }, [
      el('span', { class: 'fs-image-spinner', 'aria-hidden': 'true' }),
      el('span', { class: 'fs-image-label', text: 'Загрузка карточки…' }),
    ]);
    if (modal) status.appendChild(el('button', { class: 'fs-image-retry', text: 'Повторить загрузку', hidden: '',
      onclick: function () { loadCardImage(img, false); } }));
    else wrap.addEventListener('click', function (event) {
      if (!wrap.classList.contains('is-error')) return;
      event.preventDefault(); event.stopImmediatePropagation();
      loadCardImage(img, true);
    }, true);
    wrap.appendChild(status);
  }

  async function loadCardImage(img, thumbnail) {
    var wrap = img.parentNode, status = wrap.querySelector('.fs-image-status');
    var label = status.querySelector('.fs-image-label'), retry = status.querySelector('button');
    var zoom = wrap.closest('.fs-lb')?.querySelector('.fs-lb-zoom');
    if (zoom) zoom.disabled = true;
    var attempt = img._fsAttempt = (img._fsAttempt || 0) + 1;
    wrap.classList.remove('is-ready', 'is-error'); wrap.classList.add('is-loading');
    wrap.setAttribute('aria-busy', 'true');
    label.textContent = 'Загрузка карточки…';
    if (retry) retry.hidden = true;
    var timer;
    try {
      await Promise.race([
        (async function () {
          var url = await cardImageURL(img, img._fsCard, thumbnail);
          if (!img.isConnected || img._fsAttempt !== attempt) return;
          img.src = url;
          await img.decode();
        })(),
        new Promise(function (_, reject) { timer = setTimeout(function () { reject(new Error('Image loading timed out')); }, 20000); }),
      ]);
      if (!img.isConnected || img._fsAttempt !== attempt) return;
      var nativeRatio=img.naturalWidth/img.naturalHeight;
      img._fsCard.aspect=nativeRatio;
      if (!thumbnail) fitViewer(wrap, img._fsCard, nativeRatio);
      else if(isCardShaped(img._fsCard))wrap.style.aspectRatio=String(nativeRatio);
      wrap.classList.remove('is-loading'); wrap.classList.add('is-ready');
      wrap.setAttribute('aria-busy', 'false');
      if (zoom) zoom.disabled = false;
      // Preserve keyboard focus if retry was the active modal control.
      if (retry && document.activeElement === retry) document.querySelector('.fs-lb-close').focus();
      if (retry) retry.hidden = true;
    } catch (error) {
      if (!img.isConnected || img._fsAttempt !== attempt) return;
      img._fsAttempt++; // Ignore a source that completes after the timeout.
      img.removeAttribute('src');
      wrap.classList.remove('is-loading'); wrap.classList.add('is-error');
      wrap.setAttribute('aria-busy', 'false');
      label.textContent = thumbnail ? 'Не удалось загрузить. Нажмите, чтобы повторить.' : 'Не удалось загрузить карточку.';
      if (retry) retry.hidden = false;
    } finally { clearTimeout(timer); }
  }

  function drainImages() {
    if (state.lb !== null) return; // The opened card has priority over the hidden grid.
    while (runningImages < 3 && imageQueue.length) {
      var img = imageQueue.shift();
      if (!img.isConnected) continue;
      runningImages++;
      loadCardImage(img, true).finally(function () { runningImages--; scheduleImages(); });
    }
  }

  function scheduleImages() {
    if (imagePump) return;
    imagePump = true;
    // Let decoded previews paint before another batch of canvas work starts.
    requestAnimationFrame(function () { setTimeout(function () { imagePump=false;drainImages(); },0); });
  }

  function observeCards(root) {
    var images = root.querySelectorAll('.fs-card img');
    function queue(img) { imageQueue.push(img); scheduleImages(); }
    if (!window.IntersectionObserver) { [].forEach.call(images, queue); return; }
    lazyObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        lazyObserver.unobserve(entry.target); queue(entry.target);
      });
    }, { rootMargin: '200px 0px' });
    [].forEach.call(images, function (img) { lazyObserver.observe(img); });
  }

  /* ---- Карточка «Состав фракции» (таблица) ---- */

  function renderMaterial(materials) {
    var body;
    if (materials && materials.length) {
      body = el('div', { class: 'fs-material-body' }, materials.map(function (item) {
        if (typeof item === 'string') return el('div', { class: 'fs-material-line', text: item });
        return el('div', { class: 'fs-material-line' }, [
          el('span', { class: 'fs-material-label', text: (item && item.label) || '' }),
          el('span', { class: 'fs-material-value', text: (item && item.value != null) ? String(item.value) : '' }),
        ]);
      }));
    } else {
      body = el('div', { class: 'fs-material-body' }, [
        el('p', { class: 'fs-note', text: 'Данные о составе недоступны для этой фракции.' }),
      ]);
    }
    return el('div', { class: 'fs-material-card' }, [
      el('div', { class: 'fs-material-heading', text: 'Фигурки' }),
      body,
    ]);
  }

  /* ---- Модель карточек ---- */

  function decorateCard(card) {
    return Object.assign({},card,{
      label:cardName(card.exp,card.fac,card.category,card.file,card.label),
      facName:facNameOf(card.exp,card.fac),expName:expName(card.exp),catName:catName(card.category),
    });
  }

  function build() {
    var id=state.expansion+'/'+state.faction, man=DATA.manifest[id], txt=DATA.text[id], groups=[];
    flat=[];
    if (!man || !state.faction) return {groups:groups,ready:false};
    if (state.category==='material') return {groups:groups,ready:true,material:txt && txt.materials || null};
    flat=(DATA.cards[id] || []).filter(function (card) { return card.category===state.category; }).map(function (card,index) {
      return Object.assign(decorateCard(card),{index:index});
    });
    if (state.category==='combat') {
      man.combat.forEach(function (_,tier) {
        var cards=flat.filter(function (card) { return card.tier===tier; });
        if (cards.length) groups.push({label:cards[0].tierLabel,sub:cards.length+' '+ruPlural(cards.length,'карточка','карточки','карточек'),cards:cards});
      });
    } else if (flat.length) groups.push({label:null,sub:'',cards:flat});
    return {groups:groups,ready:true};
  }

  function facNameOf(exp, fac) { var f = findKey(DATA.factions[exp] || [], fac); return f ? f.name : fac; }

  function collectFaction(exp,fac) { return (DATA.cards[exp+'/'+fac] || []).map(decorateCard); }

  /* ---- Лайтбокс ---- */

  function viewerIsFullscreen() {
    return document.fullscreenElement === document.getElementById('app');
  }

  function viewerFeedback(message) {
    var status = document.querySelector('.fs-lb-feedback');
    if (status) { clearTimeout(status._fsTimer); status.textContent = message; }
    return status;
  }

  function syncViewerFullscreen() {
    state.lbFull = state.lb !== null && viewerIsFullscreen();
    var modal = document.querySelector('.fs-lb'), card = flat[state.lb];
    if (!modal || !card) return;
    modal.classList.toggle('is-fullscreen', state.lbFull);
    modal.querySelector('.fs-lb-fig').classList.toggle('is-full', state.lbFull);
    var button = modal.querySelector('.fs-lb-full');
    button.setAttribute('aria-pressed', String(state.lbFull));
    button.setAttribute('aria-label', state.lbFull ? 'Выйти из полноэкранного режима' : 'На весь экран');
    button.setAttribute('data-tip', state.lbFull ? 'Выйти из полноэкранного режима' : 'На весь экран');
    button.innerHTML = state.lbFull ? '&#10532;' : '&#10530;';
    var img = modal.querySelector('.fs-lb-imgwrap > img');
    fitViewer(img.parentNode, card, img.naturalWidth ? img.naturalWidth / img.naturalHeight : cardRatio(card));
    loadCardImage(img, false);
  }
  document.addEventListener('fullscreenchange', syncViewerFullscreen);

  async function toggleViewerFullscreen() {
    try {
      if (viewerIsFullscreen()) await document.exitFullscreen();
      else await document.getElementById('app').requestFullscreen();
    } catch (error) {
      viewerFeedback('Не удалось включить полноэкранный режим.');
    }
  }

  function copyWithSelection(url, modal) {
    var field = el('textarea', { readonly: '', tabindex: '-1', 'aria-label': 'Ссылка на карту' });
    field.value = url;
    field.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
    var focus = document.activeElement, selection = window.getSelection(), ranges = [];
    for (var i = 0; selection && i < selection.rangeCount; i++) ranges.push(selection.getRangeAt(i).cloneRange());
    modal.appendChild(field);
    try { field.focus(); field.select(); return document.execCommand('copy'); }
    finally {
      field.remove();
      if (focus && focus.isConnected) focus.focus({ preventScroll: true });
      if (selection) { selection.removeAllRanges(); ranges.forEach(function (range) { selection.addRange(range); }); }
    }
  }

  async function copyCardLink(card) {
    var url = new URL(window.FSNav.write({ view: 'codex', expansion: card.exp, faction: card.fac,
      category: card.src.split('/')[3] === 'maps' ? 'map' : card.src.split('/')[3], cardQuery: '' }, card.src), location.href).href;
    var modal = document.querySelector('.fs-lb'), copied = false;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try { await navigator.clipboard.writeText(url); copied = true; } catch (error) {}
    }
    if (!modal.isConnected) return;
    if (!copied) { try { copied = copyWithSelection(url, modal); } catch (error) {} }
    var status = viewerFeedback(copied ? 'Ссылка скопирована' : 'Скопируйте ссылку вручную:');
    if (!status) return;
    if (copied) {
      status._fsTimer = setTimeout(function () { if (status.isConnected) status.textContent = ''; }, 3000);
    } else {
      var field = el('input', { type: 'text', readonly: '', 'aria-label': 'Ссылка на карту' });
      field.value = url; status.appendChild(field); field.focus(); field.select();
    }
  }

  function showLightbox() {
    var appEl = document.querySelector('.fs-app');
    if (!appEl) { render(); return; }
    var old = appEl.querySelector('.fs-lb'); if (old) old.remove();
    appendLightbox(appEl);
    var img = appEl.querySelector('.fs-lb-imgwrap > img');
    if (img) loadCardImage(img, false);
    focusModal();
  }
  function hideLightbox() { var lb = document.querySelector('.fs-lb'); if (lb) lb.remove(); }

  function focusModal() {
    var app = document.querySelector('.fs-app');
    if (!app) return;
    [].forEach.call(app.children, function (node) { if (!node.classList.contains('fs-lb')) node.inert = true; });
    if (oldOverflow === null) { oldOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; }
    var close = app.querySelector('.fs-lb-close');
    var modal = app.querySelector('.fs-lb');
    if (close && !modal.contains(document.activeElement)) close.focus({ preventScroll: true });
  }
  function releaseModal() {
    var app = document.querySelector('.fs-app');
    if (app) [].forEach.call(app.children, function (node) { node.inert = false; });
    if (oldOverflow !== null) { document.body.style.overflow = oldOverflow; oldOverflow = null; }
    state.lbFull = false;
    if (viewerIsFullscreen()) document.exitFullscreen().catch(function () {});
  }
  function openLb(idx) {
    returnFocus = document.activeElement; returnCard = flat[idx] && flat[idx].src;
    state.lb = idx; state.lbFull = false; showLightbox(); updateURL();
  }
  function closeLb() {
    state.lb = null; pendingCard = null; hideLightbox(); releaseModal(); updateURL();
    scheduleImages();
    var target = returnFocus && returnFocus.isConnected ? returnFocus : document.querySelector('[data-card-id="' + returnCard + '"]');
    if (target) target.focus({ preventScroll: true });
  }
  function step(d) {
    if (!flat.length || state.lb === null) return;
    state.lb = (state.lb + d + flat.length) % flat.length;
    showLightbox();
    updateURL(true);
  }

  document.addEventListener('keydown', function (e) {
    if (state.lb === null || document.querySelector('.fs-print[open]')) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (document.querySelector('.fs-lb-imgwrap.is-zoomed')) toggleSheetZoom();
      else if (viewerIsFullscreen()) toggleViewerFullscreen();
      else closeLb();
    }
    else if (e.key === 'Tab') {
      var modal = document.querySelector('.fs-lb');
      var nodes = [].filter.call(modal.querySelectorAll('button, a, summary, input, select, [tabindex="0"]'), function (node) { return !node.disabled && node.getClientRects().length > 0; });
      var first = nodes[0], last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    } else if (!/INPUT|SELECT|TEXTAREA/.test(e.target.tagName) && !String(window.getSelection())) {
      if (e.target.classList.contains('is-zoomed')) return; // Arrow keys pan the scrollable sheet.
      if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    }
  });

  /* ---- Вид FAQ (Полевой устав) ---- */

  function faqTopicName(k) {
    var ts = (DATA.faq && DATA.faq.navTopics) || [];
    var t = findKey(ts, k);
    return t ? t.name : 'Все вопросы';
  }

  // Одна строка аккордеона — ответ скрыт/показан через CSS без перерисовки
  function faqItemNode(it) {
    var open = !!state.faqOpen[it.id];
    var icon = el('span', { class: 'fs-faq-icon' + (open ? ' is-open' : '') });
    var headId = 'question-heading-' + it.id, answerId = 'answer-' + it.id;
    var head = el('button', { class: 'fs-faq-qbtn', id: headId,
      'aria-expanded': String(open), 'aria-controls': answerId, onclick: function (e) {
      var o = !state.faqOpen[it.id];
      state.faqOpen[it.id] = o;
      state.faqQuestion = o ? it.id : null;
      e.currentTarget.setAttribute('aria-expanded', String(o));
      answer.hidden = !o;
      e.currentTarget.parentNode.classList.toggle('is-open', o);
      icon.classList.toggle('is-open', o);
      updateURL(true);
    } }, [
      window.FSWord.append(el('span', { class: 'fs-faq-q' }), it.q, tokenStyle),
      icon,
    ]);
    var answer = el('div', { class: 'fs-faq-answer', id: answerId, 'aria-labelledby': headId }, [
      window.FSWord.append(el('p', { class: 'fs-faq-atext' }), it.a, tokenStyle),
    ]);
    answer.hidden = !open;
    if (/^(base|gif|sow|dl|tdl)\/[a-z0-9_-]+\/(combat|orders|events|faction_card|maps|backs)\/[a-zA-Z0-9_.-]+\.jpg$/.test(it.card)) {
      var parts = it.card.split('/');
      answer.appendChild(el('a', { class: 'fs-share fs-faq-card', text: 'Карточка', href: window.FSNav.write({
        view: 'codex', expansion: parts[0], faction: parts[1], category: parts[2] === 'maps' ? 'map' : parts[2], cardQuery: '',
      }, 'factions/' + it.card) }));
    }
    var librarySource = it.source || it.cardSource;
    if (/^https:\/\/fixed-crane-287\.notion\.site\/[a-f0-9]{32}$/.test(librarySource)) {
      answer.appendChild(el('a', {
        class: 'fs-faq-source', href: librarySource, target: '_blank', rel: 'noopener noreferrer',
        text: it.source ? 'Источник: FS League — Note' : it.ruleSource ? 'Библиотека: прежняя редакция' : 'Текст карточки: FS League',
      }));
    }
    (it.relatedSources || []).forEach(function (url) {
      if (!/^https:\/\/fixed-crane-287\.notion\.site\/[a-f0-9]{32}$/.test(url)) return;
      answer.appendChild(el('a', { class: 'fs-faq-source', href: url, target: '_blank', rel: 'noopener noreferrer', text: 'Связанное уточнение: FS League' }));
    });
    if (/^https:\/\/github\.com\/Frytkownica\/Forbidden_Star\/commit\/[a-f0-9]{40}$/.test(it.ruleSource)) {
      answer.appendChild(el('a', { class: 'fs-faq-source', href: it.ruleSource, target: '_blank', rel: 'noopener noreferrer', text: 'Актуальная редакция: оригинал' }));
    }
    if (/^https:\/\/github\.com\/Frytkownica\/Forbidden_Star\/blob\/[a-f0-9]{40}\/page\/data\/FAQ\.json$/.test(it.legacySource)) {
      answer.appendChild(el('a', { class: 'fs-faq-source', href: it.legacySource, target: '_blank', rel: 'noopener noreferrer', text: 'FAQ оригинального проекта' }));
    }
    return el('div', { id: 'question-' + it.id, class: 'fs-faq-item' + (open ? ' is-open' : '') }, [head, answer]);
  }

  function renderFaqView() {
    ensureFaq();
    var hero = (window.FS_FAQ && window.FS_FAQ.hero) || {};
    var FAQ = DATA.faq || { navTopics: [], cats: [], count: {} };
    var ready = !!DATA.faq;
    var topic = state.faqTopic;
    if (ready && !findKey(FAQ.navTopics, topic)) topic = state.faqTopic = 'all';
    var q = window.FSWord.normalize(state.faqQuery);
    var matches = function (it) { return !q || window.FSWord.normalize(it.q + ' ' + it.a).indexOf(q) >= 0; };

    var app = el('div', { class: 'fs-app', 'data-accent': ACCENT });

    var search = el('input', {
      class: 'fs-faq-search', type: 'text', value: state.faqQuery,
      placeholder: 'Поиск по вопросам…', spellcheck: 'false', 'aria-label': 'Поиск по вопросам и ответам',
      oninput: function (e) { setState({ faqQuery: e.target.value, faqQuestion: null }, true); },
    });
    var header = el('header', { class: 'fs-header fs-faq-header' }, [
      el('button', { type: 'button', class: 'fs-brand fs-brand-link', title: 'На главную', onclick: goHome }, [
        el('div', { class: 'fs-logo' }, [el('div', { class: 'fs-logo-ring' }), el('div', { class: 'fs-logo-core' })]),
        el('div', { class: 'fs-brand-text' }, [
          el('span', { class: 'fs-brand-title', text: 'FORBIDDEN STARS' }),
          el('span', { class: 'fs-brand-sub', text: 'FAQ' }),
        ]),
      ]),
      el('div', { class: 'fs-header-spacer' }),
      el('div', { class: 'fs-faq-searchwrap' }, [
        el('span', { class: 'fs-faq-searchicon', html: '&#9906;' }),
        search,
      ]),
      el('div', { class: 'fs-header-spacer' }),
      renderSettings(),
    ]);

    var topicsNav = el('nav', { class: 'fs-nav' },
      FAQ.navTopics.map(function (t) {
        var active = topic === t.key;
        var cls = (t.kind === 'sub') ? ('fs-faq-subnav' + (active ? ' is-active' : ''))
          : ('fs-fac' + (t.kind === 'cat' ? ' fs-faq-catnav' : '') + (active ? ' is-active' : ''));
        var kids = [];
        if (t.kind !== 'sub') kids.push(el('span', { class: 'fs-fac-dot fs-faq-dot', style: 'background:' + (t.dot || 'var(--fs-accent)') + ';' }));
        kids.push(el('span', { class: 'fs-fac-name', text: t.name }));
        kids.push(el('span', { class: 'fs-fac-count', text: String(FAQ.count[t.key] || 0) }));
        return el('button', { class: cls, onclick: (function (key) { return function () { setState({ faqTopic: key, faqQuestion: null, faqNavOpen: false }); }; })(t.key) }, kids);
      })
    );
    var sidebar = el('aside', { class: 'fs-sidebar fs-scroll' }, [
      el('div', { class: 'fs-sidebar-label', text: 'Темы' }),
      mobileNavigation(topicsNav, 'Темы FAQ', 'faqNavOpen', 'faq-navigation'),
      el('button', { class: 'fs-mobile-back', text: 'К картам', onclick: function () { setState({ view: 'codex', cardQuery: '' }); } }),
      topicsNav,
      el('div', { class: 'fs-sidebar-foot' }, [
        el('button', { class: 'fs-faq-link fs-faq-back', html: '&larr; Назад в картотеку',
          onclick: function () { setState({ view: 'codex', cardQuery: '' }); } }),
        el('p', { html: 'FAN PROJECT &middot; NON&#8209;COMMERCIAL<br>Artwork &copy; Games Workshop' }),
      ]),
    ]);

    var showAll = topic === 'all';
    var sections = [];
    var shown = 0;
    FAQ.cats.forEach(function (cat) {
      var catSelected = showAll || topic === cat.key || topic.indexOf(cat.key + '_') === 0;
      if (!catSelected) return;
      var subNodes = [];
      cat.subs.forEach(function (sub) {
        if (!showAll && topic !== cat.key && topic !== sub.key) return;
        var facNodes = [];
        sub.factions.forEach(function (fac) {
          var its = fac.items.filter(matches);
          if (!its.length) return;
          shown += its.length;
          facNodes.push(el('div', { class: 'fs-faq-facgroup' }, [
            el('div', { class: 'fs-faq-fachead' }, [
              el('span', { class: 'fs-faq-facname', text: fac.faction || sub.name }),
              el('span', { class: 'fs-faq-faccount', text: String(its.length) }),
              fac.picture ? el('img', { class: 'fs-faq-facicon', src: fac.picture, alt: '', loading: 'lazy' }) : null,
            ]),
            el('div', { class: 'fs-faq-list' }, its.map(faqItemNode)),
          ]));
        });
        if (facNodes.length) {
          var subKids = (topic === sub.key) ? [] : [el('div', { class: 'fs-faq-sublabel', text: sub.name })];
          subNodes.push(el('div', { class: 'fs-faq-subsection' }, subKids.concat(facNodes)));
        }
      });
      if (subNodes.length) {
        var catChildren = [];
        if (showAll) catChildren.push(el('h2', { class: 'fs-faq-cathead' }, [
          el('span', { class: 'fs-faq-catdot', style: 'background:' + cat.dot + ';' }),
          cat.name,
        ]));
        sections.push(el('div', { class: 'fs-faq-catblock' }, catChildren.concat(subNodes)));
      }
    });

    var contentInner;
    if (DATA.errors.faq) {
      contentInner = loadError('Не удалось загрузить FAQ. Проверьте соединение и попробуйте снова.', openFaq);
    } else if (!ready) {
      contentInner = el('div', { class: 'fs-note', text: 'Загрузка…' });
    } else if (shown) {
      contentInner = el('div', { class: 'fs-faq-sections' }, sections);
    } else {
      contentInner = el('div', { class: 'fs-faq-empty' }, [
        el('div', { class: 'fs-faq-empty-glyph' }, [el('div', { class: 'ring' })]),
        el('p', { class: 'fs-note', text: q
          ? ('Нет вопросов по запросу «' + state.faqQuery + '». Попробуйте другой запрос или очистите строку поиска.')
          : 'Нет вопросов в этом разделе.' }),
      ]);
    }

    var body = [
      el('div', { class: 'fs-faq-hero' }, [
        el('span', { class: 'fs-faq-kicker', text: hero.kicker || '' }),
        el('h1', { class: 'fs-faq-title', text: hero.title || '' }),
        el('p', { class: 'fs-faq-blurb', text: hero.blurb || '' }),
      ]),
      el('div', { class: 'fs-faq-content' }, [
        el('div', { class: 'fs-faq-sectionrow' }, [
          el('span', { class: 'fs-faq-sectionlabel', text: faqTopicName(topic) }),
          el('span', { class: 'fs-faq-countlabel', text: shown + ' ' + ruPlural(shown, 'вопрос', 'вопроса', 'вопросов') }),
        ]),
        contentInner,
      ]),
    ];
    var main = el('main', { class: 'fs-main fs-scroll fs-faq-main' }, body);

    app.appendChild(header);
    app.appendChild(el('div', { class: 'fs-body' }, [sidebar, main]));
    mountApp(app);
  }

  /* ---- Главная отрисовка ---- */

  function render() {
    if (state.view === 'faq') { renderFaqView(); return; }
    if (DATA.general && state.expansion && !findKey(DATA.expansions, state.expansion)) {
      state.expansion = null; state.faction = null; pendingCard = null;
    }
    if (state.expansion && DATA.factions[state.expansion] && !findKey(DATA.factions[state.expansion], state.faction)) {
      var firstFaction = DATA.factions[state.expansion][0]; state.faction = firstFaction ? firstFaction.key : null;
    }
    if (!FOLDER[state.category] && state.category !== 'material') state.category = 'combat';
    if (state.lb !== null) {
      pendingCard = flat[state.lb] ? flat[state.lb].src : null;
      state.lb = null;
    }
    var cols = Math.max(2, Math.min(8, density()));
    var cat = state.category;

    var built = build();
    var groups = built.groups;

    // Faction Card и Maps — без принудительного соотношения сторон
    // Orders/events have up to four bounded columns; mobile keeps cards legible.
    var naturalCard = (cat === 'faction_card' || cat === 'map');
    var gridCols, gridJustify, cardAspect;
    if (cat === 'faction_card') {
      gridCols = 'repeat(1, minmax(0, 920px))'; gridJustify = 'center'; cardAspect = '';
    } else if (cat === 'map') {
      gridCols = 'repeat(1, minmax(0, 920px))'; gridJustify = 'center'; cardAspect = '';
    } else if (cat === 'events') {
      gridCols = 'repeat(' + Math.min(4, cols) + ', minmax(0, 320px))'; gridJustify = 'start'; cardAspect = '450 / 650';
    } else if (cat === 'orders') {
      gridCols = 'repeat(' + Math.min(4, cols) + ', minmax(0, 320px))'; gridJustify = 'start'; cardAspect = '450 / 650';
    } else {
      gridCols = 'repeat(' + cols + ', minmax(0, 1fr))'; gridJustify = 'start'; cardAspect = '450 / 650';
    }

    var app = el('div', { class: 'fs-app', 'data-accent': ACCENT });

    /* ---- Заголовок ---- */
    var header = el('header', { class: 'fs-header fs-faq-header' }, [
      el('button', { type: 'button', class: 'fs-brand fs-brand-link', title: 'На главную', onclick: goHome }, [
        el('div', { class: 'fs-logo' }, [
          el('div', { class: 'fs-logo-ring' }),
          el('div', { class: 'fs-logo-core' }),
        ]),
        el('div', { class: 'fs-brand-text' }, [
          el('span', { class: 'fs-brand-title', text: 'FORBIDDEN STARS' }),
          el('span', { class: 'fs-brand-sub', text: 'Картотека' }),
        ]),
      ]),
      el('div', { class: 'fs-header-spacer' }),
      el('div', { class: 'fs-faq-searchwrap' }, [
        el('span', { class: 'fs-faq-searchicon', html: '&#9906;' }),
        el('input', {
          class: 'fs-faq-search', type: 'text', value: state.cardQuery,
          placeholder: 'Поиск по названиям и тексту…', spellcheck: 'false', 'aria-label': 'Поиск по названиям и тексту карточек',
          oninput: function (e) { setState({ cardQuery: e.target.value, lb: null }, true); },
        }),
      ]),
      el('div', { class: 'fs-header-spacer' }),
      renderSettings(),
    ]);

    /* ---- Боковая панель: навигация Игра › Дополнение › Фракция ---- */
    if (window.FSPrint) header.appendChild(window.FSPrint.controls(state.faction && !state.cardQuery.trim() ? state.expansion + '/' + state.faction : null));
    var libNav = el('nav', { class: 'fs-nav' },
      DATA.expansions.map(function (e) {
        ensureFactions(e.key);
        var facs = DATA.factions[e.key] || [];
        var expActive = state.expansion === e.key;
        var open = state.expOpen === e.key;

        var chevron = el('span', { class: 'fs-exp-chevron' + (open ? ' open' : ''), html: '&rsaquo;' });
        var expHeader = el('button', {
          class: 'fs-fac fs-faq-catnav fs-exp-head' + (expActive ? ' is-active' : ''),
          'aria-expanded': String(open), 'aria-controls': 'factions-' + e.key,
          onclick: (function (key) {
            return function (ev) {
              state.expOpen = (state.expOpen === key) ? null : key;
              var nav = ev.currentTarget.closest('.fs-nav');
              [].forEach.call(nav.querySelectorAll('.fs-nav-group'), function (g) {
                var isOpen = g.getAttribute('data-exp') === state.expOpen;
                var s = g.querySelector('.fs-nav-subs'); if (s) s.classList.toggle('collapsed', !isOpen);
                var c = g.querySelector('.fs-exp-chevron'); if (c) c.classList.toggle('open', isOpen);
                g.querySelector('.fs-exp-head').setAttribute('aria-expanded', String(isOpen));
              });
            };
          })(e.key),
        }, [
          el('span', { class: 'fs-fac-dot fs-faq-dot', style: 'background:' + expColor(e.key) + ';' }),
          el('span', { class: 'fs-fac-name', text: e.name }),
          chevron,
        ]);

        var subs = el('div', { id: 'factions-' + e.key, class: 'fs-nav-subs' + (open ? '' : ' collapsed') },
          facs.map(function (f) {
            var cnt = manifestCount(DATA.manifest[e.key + '/' + f.key]);
            var facActive = expActive && state.faction === f.key;
            return el('button', {
              class: 'fs-faq-subnav fs-fac-sub' + (facActive ? ' is-active' : ''),
              onclick: (function (ek, fk) { return function () {
                delete DATA.errors['man:' + ek + '/' + fk];
                ensureManifest(ek, fk);
                setState({ expansion: ek, faction: fk, lb: null, expOpen: ek, cardQuery: '', navOpen: false });
              }; })(e.key, f.key),
            }, [
              el('span', { class: 'fs-fac-dot fs-fac-subdot', style: 'background:' + f.dot + ';' }),
              el('span', { class: 'fs-fac-name', text: f.name }),
              el('span', { class: 'fs-fac-count', text: cnt == null ? '' : String(cnt) }),
            ]);
          })
        );
        if (DATA.errors['fac:' + e.key]) subs.appendChild(loadError('Не удалось загрузить список фракций.', function () { retryFactions(e.key); }));

        return el('div', { class: 'fs-nav-group', 'data-exp': e.key }, [expHeader, subs]);
      })
    );

    var sidebar = el('aside', { class: 'fs-sidebar fs-scroll' }, [
      el('div', { class: 'fs-sidebar-label', text: 'База и дополнения' }),
      mobileNavigation(libNav, 'Фракции' + (state.faction ? ' · ' + facName(state.faction) : ''), 'navOpen', 'catalog-navigation'),
      libNav,
      el('div', { class: 'fs-sidebar-section fs-faq-section' }, [
        el('div', { class: 'fs-sidebar-label', text: 'Справочник' }),
        el('button', { class: 'fs-fac fs-faq-entry', onclick: openFaq }, [
          el('span', { class: 'fs-fac-dot fs-faq-dot', style: 'background:var(--fs-accent);' }),
          el('span', { class: 'fs-fac-name', text: 'FAQ' }),
          el('span', { class: 'fs-fac-count', html: '&rsaquo;' }),
        ]),
      ]),
      el('div', { class: 'fs-sidebar-foot' }, [
        el('p', { html: 'FAN PROJECT &middot; NON&#8209;COMMERCIAL<br>Artwork &copy; Games Workshop' }),
      ]),
    ]);

    /* ---- Основная область ---- */
    var main = el('main', { class: 'fs-main' });
    if (window.FSPrint) main.appendChild(window.FSPrint.factionBar(state.faction && !state.cardQuery.trim() ? state.expansion + '/' + state.faction : null));

    // ---- Глобальный поиск по карточкам, сгруппированный по дополнению → фракции ----
    if (state.cardQuery.trim()) {
      var q = window.FSWord.normalize(state.cardQuery);
      flat = [];
      var match = function (c) {
        return window.FSWord.normalize([c.label, c.facName, c.expName].concat(c.text ? Object.values(c.text) : []).join(' ')).indexOf(q) >= 0;
      };
      var sres = el('div', { class: 'fs-scrollarea fs-scroll' });
      var failed = [];
      var pending = false;
      DATA.expansions.forEach(function (e) {
        if (DATA.loading['fac:' + e.key] && !DATA.factions[e.key]) pending = true;
        if (DATA.errors['fac:' + e.key]) failed.push({ exp: e.key, fac: null });
        var facs = DATA.factions[e.key] || [];
        var facBlocks = [];
        var expCount = 0;
        facs.forEach(function (f) {
          var id = e.key + '/' + f.key;
          if (DATA.errors['man:' + id]) failed.push({ exp: e.key, fac: f.key });
          if (DATA.loading['man:' + id]) pending = true;
          var hits = collectFaction(e.key, f.key).filter(match);
          if (!hits.length) return;
          expCount += hits.length;
          var grid = el('div', {
            class: 'fs-grid',
            style: 'grid-template-columns:repeat(' + cols + ', minmax(0, 1fr));justify-content:start;',
          }, hits.map(function (card) {
            card.index = flat.length; flat.push(card);
            var btn = el('button', {
              class: 'fs-card fs-card--search', title: card.label,
              'data-card-id': card.src,
              onclick: (function (idx) { return function () { openLb(idx); }; })(card.index),
            }, [el('img', { alt: card.label, decoding: 'async' })]);
            var imgEl = btn.querySelector('img');
            prepareCard(imgEl, card);
            if (window.FSPrint) window.FSPrint.decorateCard(btn, card);
            return el('div', { class: 'fs-search-item' }, [
              btn,
              el('div', { class: 'fs-search-cap' }, [
                el('span', { class: 'fs-search-cat', text: card.catName }),
                el('span', { class: 'fs-search-name', text: card.label }),
              ]),
            ]);
          }));
          facBlocks.push(el('div', { class: 'fs-faq-subsection' }, [
            el('div', { class: 'fs-faq-sublabel', text: facNameOf(e.key, f.key) }),
            grid,
          ]));
        });
        if (facBlocks.length) {
          sres.appendChild(el('div', { class: 'fs-faq-catblock' }, [
            el('h2', { class: 'fs-faq-cathead' }, [
              el('span', { class: 'fs-faq-catdot', style: 'background:' + expColor(e.key) + ';' }),
              e.name,
              el('span', { class: 'fs-search-expcount', text: String(expCount) }),
            ]),
          ].concat(facBlocks)));
        }
      });
      main.appendChild(el('div', { class: 'fs-breadcrumb' }, [
        el('div', { class: 'fs-bc-left' }, [
          el('span', { class: 'fs-bc-exp', text: 'Все карточки' }),
          el('span', { class: 'fs-bc-sep', text: '/' }),
          el('h1', { class: 'fs-bc-title', text: 'Поиск: «' + state.cardQuery + '»' }),
        ]),
        el('span', { class: 'fs-bc-total', text: flat.length + ' ' + ruPlural(flat.length, 'результат', 'результата', 'результатов') }),
      ]));
      if (failed.length) {
        sres.appendChild(loadError('Не все данные карточек загружены. Результаты поиска могут быть неполными.', function () {
          failed.forEach(function (f) {
            if (!f.fac) { delete DATA.errors['fac:' + f.exp]; ensureFactions(f.exp); return; }
            delete DATA.errors['man:' + f.exp + '/' + f.fac];
            ensureManifest(f.exp, f.fac);
          });
          render();
        }));
      }
      if (pending) sres.appendChild(el('div', { class: 'fs-note', text: 'Загрузка карточек…' }));
      if (!flat.length && !failed.length && !pending) {
        sres.appendChild(el('div', { class: 'fs-note', text: 'Нет карточек по запросу «' + state.cardQuery + '».' }));
      }
      main.appendChild(sres);
      app.appendChild(header);
      app.appendChild(el('div', { class: 'fs-body' }, [sidebar, main]));
      mountApp(app);
      return;
    }

    if (!state.expansion || !state.faction) {
      if (DATA.errors['fac:' + state.expansion]) main.appendChild(loadError('Не удалось загрузить список фракций. Проверьте соединение и попробуйте снова.', function () { retryFactions(state.expansion); }));
      else main.appendChild(el('div', { class: 'fs-empty' }, [
        el('div', { class: 'fs-empty-glyph' }, [el('div', { class: 'ring' }), el('div', { class: 'core' })]),
        el('div', { class: 'fs-empty-stack' }, [
          el('h2', { text: 'Forbidden Stars — Картотека' }),
          el('p', { text: 'Выберите фракцию, чтобы просмотреть карточки, или воспользуйтесь поиском.' }),
          el('button', { class: 'fs-empty-btn fs-mobile-only', text: 'Выбрать фракцию', onclick: function () {
            state.navOpen = true; render();
            var nav = document.getElementById('catalog-navigation');
            if (nav) { nav.scrollIntoView({ block: 'nearest' }); nav.querySelector('button')?.focus({ preventScroll: true }); }
          } }),
        ]),
      ]));
      app.appendChild(header);
      app.appendChild(el('div', { class: 'fs-body' }, [sidebar, main]));
      mountApp(app);
      return;
    }

    var facId = state.expansion + '/' + state.faction;
    var hasMaterials = !!(DATA.text[facId] && DATA.text[facId].materials && DATA.text[facId].materials.length);
    if (cat === 'material' && !hasMaterials && DATA.categories.length) {
      setState({ category: DATA.categories[0].key });
      return;
    }
    var cattabs = el('div', { class: 'fs-cattabs fs-scroll' },
      DATA.categories.map(function (c) {
        return el('button', {
          class: 'fs-cat' + (cat === c.key ? ' is-active' : ''),
          onclick: (function (key) { return function () { setState({ category: key, lb: null, cardQuery: '' }); }; })(c.key),
          text: catName(c.key),
        });
      }).concat(hasMaterials ? [el('button', {
        class: 'fs-cat' + (cat === 'material' ? ' is-active' : ''),
        onclick: function () { setState({ category: 'material', lb: null, cardQuery: '' }); },
        text: catName('material'),
      })] : [])
    );
    main.appendChild(el('div', { class: 'fs-cattabs-wrap' }, [cattabs]));

    main.appendChild(el('div', { class: 'fs-breadcrumb' }, [
      el('div', { class: 'fs-bc-left' }, [
        el('span', { class: 'fs-bc-exp', text: expName(state.expansion) }),
        el('span', { class: 'fs-bc-sep', text: '/' }),
        el('h1', { class: 'fs-bc-title', text: (facName(state.faction) || '…') + ' — ' + catName(cat) }),
      ]),
      el('span', {
        class: 'fs-bc-total',
        text: cat === 'material'
          ? (built.material && built.material.length ? built.material.length + ' ' + ruPlural(built.material.length, 'единица', 'единицы', 'единиц') : '')
          : (flat.length + ' ' + ruPlural(flat.length, 'карточка', 'карточки', 'карточек')),
      }),
    ]));

    var scrollarea = el('div', { class: 'fs-scrollarea fs-scroll' });
    if (DATA.errors['man:' + facId]) {
      scrollarea.appendChild(loadError('Не удалось загрузить данные карточек. Проверьте соединение и попробуйте снова.', function () {
        delete DATA.errors['man:' + facId];
        ensureManifest(state.expansion, state.faction);
        render();
      }));
    } else if (!built.ready) {
      scrollarea.appendChild(el('div', { class: 'fs-note', text: 'Загрузка…' }));
    } else if (cat === 'material') {
      scrollarea.appendChild(renderMaterial(built.material));
    } else if (!groups.length) {
      scrollarea.appendChild(el('div', { class: 'fs-note', text: 'Нет карточек этого типа.' }));
    } else {
      groups.forEach(function (group) {
        if (group.label) {
          scrollarea.appendChild(el('div', { class: 'fs-group-head' }, [
            el('span', { class: 'fs-group-label', text: group.label }),
            el('span', { class: 'fs-group-rule' }),
            el('span', { class: 'fs-group-sub', text: group.sub }),
          ]));
        }
        var grid = el('div', {
          class: 'fs-grid' + (cat === 'events' ? ' fs-grid--events' : ''),
          style: 'grid-template-columns:' + gridCols + ';justify-content:' + gridJustify + ';',
        }, group.cards.map(function (card) {
          var btn = el('button', {
            class: 'fs-card' + (naturalCard ? ' fs-card--natural' : ''),
            'data-card-id': card.src,
            title: card.label,
            style: cardAspect ? ('aspect-ratio:' + cardAspect + ';') : '',
            onclick: (function (idx) { return function () { openLb(idx); }; })(card.index),
          }, [
            el('img', { alt: card.label, decoding: 'async' }),
          ]);
          var imgEl = btn.querySelector('img');
          prepareCard(imgEl, card);
          if (window.FSPrint) window.FSPrint.decorateCard(btn, card);
          return btn;
        }));
        scrollarea.appendChild(grid);
      });
    }
    main.appendChild(scrollarea);

    app.appendChild(header);
    app.appendChild(el('div', { class: 'fs-body' }, [sidebar, main]));
    mountApp(app);
  }

  function toggleSheetZoom() {
    var wrap = document.querySelector('.fs-lb--sheet .fs-lb-imgwrap');
    if (!wrap) return;
    var zoomed = wrap.classList.toggle('is-zoomed');
    var button = document.querySelector('.fs-lb-zoom');
    var label = zoomed ? 'Уменьшить' : 'Увеличить';
    button.setAttribute('aria-pressed',String(zoomed));
    button.setAttribute('aria-label',label);button.setAttribute('data-tip',label);
    button.querySelector('.fs-zoom-plus').style.display = zoomed ? 'none' : '';
    if (zoomed) {
      var scale = Math.max(2,Math.min(4,wrap.querySelector('img').naturalWidth/wrap.clientWidth));
      wrap.style.setProperty('--fs-sheet-zoom',scale);
      wrap.focus();wrap.scrollLeft=(wrap.scrollWidth-wrap.clientWidth)/2;wrap.scrollTop=(wrap.scrollHeight-wrap.clientHeight)/2;
    }
    else {wrap.scrollLeft=wrap.scrollTop=0;button.focus();}
  }

  function enableSheetPan(wrap) {
    var drag = null;
    wrap.addEventListener('pointerdown',function (event) {
      if (event.pointerType !== 'mouse' || event.button !== 0 || !wrap.classList.contains('is-zoomed')) return;
      event.preventDefault();wrap.focus();wrap.setPointerCapture(event.pointerId);
      drag={x:event.clientX,y:event.clientY,left:wrap.scrollLeft,top:wrap.scrollTop};
      wrap.classList.add('is-panning');
    });
    wrap.addEventListener('pointermove',function (event) {
      if (!drag) return;
      wrap.scrollLeft=drag.left+drag.x-event.clientX;wrap.scrollTop=drag.top+drag.y-event.clientY;
    });
    wrap.addEventListener('lostpointercapture',function () {drag=null;wrap.classList.remove('is-panning');});
  }

  // Встраивает оверлей лайтбокса в `app` при открытой карточке
  function appendLightbox(app) {
    if (state.lb === null) return;
    var c = flat[state.lb];
    if (!c) return;
    var full = state.lbFull;
    var imgEl = el('img', { alt: c.label, decoding: 'async', draggable:'false' });
    var sheet = c.kind === 'sheet';
    var imgWrap = el('div', { class: 'fs-lb-imgwrap', tabindex: sheet ? '0' : null,
      'aria-label': sheet ? 'Лист фракции. После увеличения прокручивайте изображение.' : null }, [imgEl]);
    if (sheet) enableSheetPan(imgWrap);
    fitViewer(imgWrap, c);
    prepareCard(imgEl, c, true);
    var textPanel = null;
    if (c.text) {
      textPanel = el('details', { class: 'fs-card-text', open: !sheet && window.innerWidth > 720 ? '' : null }, [
        el('summary', { text: sheet ? 'Способности фракции' : 'Текст карточки' }),
        sheet ? null : el('h2', { text: c.text.title || c.label }),
      ]);
      if (c.text.notice) textPanel.appendChild(el('p', { text: c.text.notice }));
      [c.text.general || c.text.background, c.text.unit || c.text.foreground].filter(Boolean).forEach(function (text) {
        textPanel.appendChild(window.FSWord.append(el('p'), text, tokenStyle));
      });
    }

    var children = [
      el('button', {
        class: 'fs-lb-nav', 'aria-label': 'Предыдущая карточка', html: '&lsaquo;',
        onclick: function (e) { e.stopPropagation(); step(-1); },
      }),
      el('div', { class: 'fs-lb-content', onclick: function (e) { e.stopPropagation(); } }, [
      el('figure', { class: 'fs-lb-fig' + (full ? ' is-full' : '') }, [
        imgWrap,
        el('figcaption', { class: 'fs-lb-cap' }, [
          el('span', { class: 'fs-lb-label', text: c.label }),
          el('span', {
            class: 'fs-lb-meta',
            text: (c.catName || catName(state.category)) + ' · ' + (c.facName || facName(state.faction)) + ' · ' + (state.lb + 1) + ' / ' + flat.length,
          }),
        ]),
      ]), textPanel ]),
      el('button', {
        class: 'fs-lb-nav', 'aria-label': 'Следующая карточка', html: '&rsaquo;',
        onclick: function (e) { e.stopPropagation(); step(1); },
      }),
      el('button', {
        class: 'fs-lb-tool fs-lb-full', 'aria-label': full ? 'Выйти из полноэкранного режима' : 'На весь экран',
        'aria-pressed': String(full),
        disabled: document.fullscreenEnabled && document.getElementById('app').requestFullscreen ? null : '',
        'data-tip': document.fullscreenEnabled ? (full ? 'Выйти из полноэкранного режима' : 'На весь экран') : 'Полноэкранный режим недоступен в этом браузере',
        html: full ? '&#10532;' : '&#10530;',
        onclick: function (e) { e.stopPropagation(); toggleViewerFullscreen(); },
      }),
      el('button', {
        class: 'fs-lb-tool fs-lb-close', 'aria-label': 'Закрыть', 'data-tip': 'Закрыть (Esc)', html: '&#10005;',
        onclick: function (e) { e.stopPropagation(); closeLb(); },
      }),
      el('button', { class: 'fs-lb-tool fs-lb-share', 'aria-label': 'Скопировать ссылку на карту',
        'data-tip': 'Скопировать ссылку на карту', html: '&#10697;',
        onclick: function (e) { e.stopPropagation(); copyCardLink(c); } }),
      el('div', { class: 'fs-lb-feedback', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }),
    ];
    if (sheet) children.push(el('button', {class:'fs-lb-tool fs-lb-zoom', 'aria-label':'Увеличить',
      'aria-pressed':'false','data-tip':'Увеличить',disabled:'',
      html:'<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6M7 10h6"/><path class="fs-zoom-plus" d="M10 7v6"/></svg>',
      onclick:function (e) {e.stopPropagation();toggleSheetZoom();} }));
    app.appendChild(el('div', { class: 'fs-lb' + (sheet ? ' fs-lb--sheet' : '') + (full ? ' is-fullscreen' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': c.label,
      onclick: function (e) { if (e.target === e.currentTarget) closeLb(); } }, children));
  }

  function goHome() {
    setState({ view: 'codex', expansion: null, faction: null, category: 'combat', lb: null, expOpen: null, cardQuery: '' });
  }

  // Перерисовка при изменении размера окна (дебаунс)
  var _rt;
  window.addEventListener('resize', function () {
    clearTimeout(_rt);
    _rt = setTimeout(render, 120);
  });

  /* ---- Инициализация ---- */

  function boot() {
    fetchJSON('factions/general.json').then(function (g) {
      DATA.general = g;
      DATA.defaults = g.filenames;
      DATA.expansions = (g.expansion.folder || []).map(function (key, i) {
        return {
          key: key,
          name: (g.expansion.name && g.expansion.name[i]) || key,
          color: (g.expansion.color && g.expansion.color[i]) || DOT_FALLBACK,
        };
      });
      DATA.categories = (g.cardsDefault.reference || []).map(function (key, i) {
        return { key: key, name: (g.cardsDefault.name && g.cardsDefault.name[i]) || key };
      });
      // FAQ section dots follow expansion colors from general.json
      if (window.FS_FAQ) {
        window.FS_FAQ.dots = [ACCENT_FALLBACK].concat(DATA.expansions.map(function (e) { return e.color; }));
      }
      render();
      DATA.expansions.forEach(function (e) { ensureFactions(e.key); });
      fetchJSON('data/cardnames.json').then(function (names) { DATA.cardnames = names || {}; render(); }).catch(function () {});
    }).catch(function (e) {
      console.error(e);
      var root = document.getElementById('app');
      if (root) root.replaceChildren(loadError('Не удалось загрузить данные справочника. Проверьте соединение и попробуйте снова.', boot));
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
