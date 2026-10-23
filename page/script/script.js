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
  var FOLDER = {
    combat: 'combat', orders: 'orders', events: 'events',
    backs: 'backs', faction_card: 'faction_card', map: 'maps',
  };

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
    var w = hi ? 1600 : 1000, h = Math.round(w * 650 / 450);
    if (window.FSCardRender) window.FSCardRender.setResolution(w, h);
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
  var lazyObserver = null, imageQueue = [], runningImages = 0;
  var state = {
    expansion: null, faction: null, category: 'combat',
    lb: null, lbFull: false, lbMag: false, lbZoom: 2, lbLensSize: 204,
    view: 'codex',
    faqTopic: 'all', faqQuery: '', faqOpen: {},
    expOpen: null,
    cardQuery: '',
    faqQuestion: null, settingsOpen: false,
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
    state.lb = null; state.lbFull = false; state.lbMag = false;
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

  function fetchJSON(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' — ' + url);
      return r.json();
    });
  }

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
    if (DATA.factions[exp] || DATA.loading['fac:' + exp]) return;
    DATA.loading['fac:' + exp] = true;
    fetchJSON('factions/' + exp + '/faction.json').then(function (fj) {
      var list = (fj.folder || []).map(function (key, i) {
        return { key: key, name: (fj.name && fj.name[i]) || key, dot: factionDot(fj, i) };
      });
      DATA.factions[exp] = list;
      list.forEach(function (f) { ensureManifest(exp, f.key); });
      if (state.expansion === exp && !state.faction && list[0]) state.faction = list[0].key;
      render();
    }).catch(function (e) {
      DATA.factions[exp] = [];
      console.error(e);
      render();
    });
  }

  // Манифест нужен до показа карточек: часть изображений содержит только шаблон.
  function ensureManifest(exp, fac) {
    var id = exp + '/' + fac;
    if (DATA.manifest[id] || DATA.loading['man:' + id] || DATA.errors['man:' + id]) return;
    DATA.loading['man:' + id] = true;
    fetchJSON('factions/' + exp + '/' + fac + '/text.json').then(function (t) {
      DATA.manifest[id] = mergeFilenames(t && t.filenames);
      DATA.text[id] = {
        combat:    (t && t.combatText)    || null,
        orders:    (t && t.ordersText)    || null,
        events:    (t && t.eventsText)    || null,
        materials: (t && t.materialsText) || null,
        raster:    !!(t && t.rasterText),
        tierLabels: (t && t.tierLabels) || null,
        components: (t && t.componentsText) || {},
        templates: (t && t.templates) || {},
        cardAspect: t && t.cardAspect || null,
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

  function mergeFilenames(over) {
    var d = DATA.defaults || {};
    over = over || {};
    return {
      combat:       over.combat       || d.combat       || [],
      orders:       over.orders       || d.orders       || [],
      events:       over.events       || d.events       || [],
      backs:        over.backs        || d.backs        || [],
      faction_card: over.faction_card || d.faction_card || [],
      map:          over.map          || d.map          || [],
    };
  }

  function cardTemplate(txt, cat, file) {
    if (!txt) return null;
    var template = txt.templates[FOLDER[cat] + '/' + file];
    return template || null;
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
      el('summary', { text: 'Отображение' }),
      el('div', { class: 'fs-settings-panel' }, [
        el('label', { for: 'fs-wording', text: 'Вид жетонов' }), mode,
        el('label', { class: 'fs-resolution-option' }, [input, ' Дополнительная чёткость для увеличения']), legend,
      ]),
    ]);
  }

  function setTokenStyle(mode) {
    tokenStyle = mode === 'images' ? 'images' : 'icons';
    try { localStorage.setItem(TOKEN_STYLE_KEY, tokenStyle); } catch (error) {}
    render();
  }

  /* ---- Композитинг / растрирование карточек ---- */

  function cardRatio(card) {
    return card.aspect || card.text && card.text.aspect || 450 / 650;
  }

  // Reserve the viewer's space before loading; raster dimensions never size the UI.
  function fitViewer(wrap, card, ratio) {
    ratio = ratio || cardRatio(card);
    var mobile = window.innerWidth <= 720;
    var availableWidth = mobile ? window.innerWidth - 24 : (state.lbFull ? window.innerWidth - 192 : Math.min(1100, window.innerWidth - 192)) - (card.text ? 304 : 0);
    var availableHeight = window.innerHeight - (mobile ? (state.lbFull ? 220 : 280) : (state.lbFull ? 128 : 190));
    var width = Math.max(1, Math.min(availableWidth, availableHeight * ratio, state.lbFull || ratio > 1 ? Infinity : 500));
    wrap.style.setProperty('--fs-lb-width', width + 'px');
    wrap.style.setProperty('--fs-lb-ratio', ratio);
  }

  function displayPixels(img, thumbnail) {
    // Layout pixels exclude the viewer's entrance/hover transforms.
    var width = img.parentNode.offsetWidth;
    // Supersample text even on a 1× screen. Buckets keep the bounded cache useful
    // across small viewport changes; the optional setting adds magnifier detail.
    var scale = Math.max(useHighRes ? 3 : 2, window.devicePixelRatio || 1);
    var w = Math.ceil(Math.max(thumbnail ? 270 : 900, width * scale) / 64) * 64;
    if (img._fsCard.kind === 'overlay' && !thumbnail) w = Math.max(1600, w);
    return { w: w, h: Math.round(w / cardRatio(img._fsCard)) };
  }

  function isCardShaped(card) {
    if (card.kind) return true;
    return /\/(combat|orders|events|backs)\//.test(card.src || '');
  }

  function cardImageURL(imgEl, card, thumbnail) {
    var pixels = displayPixels(imgEl, thumbnail);
    if (card.text && card.kind && window.FSCardRender) {
      // Render the text directly at display resolution, losslessly, from the full
      // template. Enlarging the precomposed 270px JPEG loses the small letterforms.
      return window.FSCardRender.compose({ src: card.src,
        kind: card.kind, text: card.text, template: card.template, wording: tokenStyle,
        width: pixels.w, height: pixels.h,
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
      if (!thumbnail) fitViewer(wrap, img._fsCard, img.naturalWidth / img.naturalHeight);
      wrap.classList.remove('is-loading'); wrap.classList.add('is-ready');
      wrap.setAttribute('aria-busy', 'false');
      // Preserve keyboard focus if retry was the active modal control.
      if (retry && document.activeElement === retry) document.querySelector('.fs-lb-close').focus();
      if (retry) retry.hidden = true;
    } catch (error) {
      if (!img.isConnected || img._fsAttempt !== attempt) return;
      img._fsAttempt++; // Ignore a source that completes after the timeout.
      wrap.classList.remove('is-loading'); wrap.classList.add('is-error');
      wrap.setAttribute('aria-busy', 'false');
      label.textContent = thumbnail ? 'Не удалось загрузить. Нажмите, чтобы повторить.' : 'Не удалось загрузить карточку.';
      if (retry) retry.hidden = false;
    } finally { clearTimeout(timer); }
  }

  function drainImages() {
    while (runningImages < 3 && imageQueue.length) {
      var img = imageQueue.shift();
      if (!img.isConnected) continue;
      runningImages++;
      loadCardImage(img, true).finally(function () { runningImages--; drainImages(); });
    }
  }

  function observeCards(root) {
    var images = root.querySelectorAll('.fs-card img');
    function queue(img) { imageQueue.push(img); drainImages(); }
    if (!window.IntersectionObserver) { [].forEach.call(images, queue); return; }
    lazyObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        lazyObserver.unobserve(entry.target); queue(entry.target);
      });
    }, { rootMargin: '200px 0px' });
    [].forEach.call(images, function (img) { lazyObserver.observe(img); });
  }

  /* ---- Лупа в лайтбоксе ---- */

  function attachMagnifier(wrap, img) {
    var lens = el('div', { class: 'fs-lb-lens' });
    wrap.appendChild(lens);
    var ex = null, ey = null;
    function draw() {
      var L = state.lbLensSize;
      lens.style.width = L + 'px'; lens.style.height = L + 'px';
      if (!state.lbMag || ex == null) { lens.style.display = 'none'; return; }
      var r = img.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
      var x = ex - r.left, y = ey - r.top;
      if (x < 0 || y < 0 || x > r.width || y > r.height) { lens.style.display = 'none'; return; }
      var z = state.lbZoom;
      lens.style.display = 'block';
      lens.style.backgroundImage = 'url("' + (img.currentSrc || img.src) + '")';
      lens.style.backgroundSize = (r.width * z) + 'px ' + (r.height * z) + 'px';
      lens.style.backgroundPosition = (-(x * z - L / 2)) + 'px ' + (-(y * z - L / 2)) + 'px';
      lens.style.left = (ex - wr.left - L / 2) + 'px';
      lens.style.top  = (ey - wr.top  - L / 2) + 'px';
    }
    img.addEventListener('mousemove', function (ev) { ex = ev.clientX; ey = ev.clientY; draw(); });
    img.addEventListener('mouseleave', function () { lens.style.display = 'none'; });
    // Прокрутка — масштаб; Shift+прокрутка — размер лупы
    img.addEventListener('wheel', function (ev) {
      if (!state.lbMag) return;
      ev.preventDefault();
      var delta = ev.deltaY !== 0 ? ev.deltaY : ev.deltaX;
      var up = delta < 0;
      if (ev.shiftKey) {
        state.lbLensSize = Math.max(120, Math.min(520, state.lbLensSize + (up ? 20 : -20)));
      } else {
        state.lbZoom = Math.max(1.4, Math.min(6, state.lbZoom + (up ? 0.3 : -0.3)));
      }
      draw();
    }, { passive: false });
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

  function build() {
    var fac = state.faction, cat = state.category;
    var id = state.expansion + '/' + fac;
    var man = DATA.manifest[id];
    var txt = DATA.text[id];
    var groups = [];
    flat = [];
    if (!man || !fac) return { groups: groups, ready: false };

    if (cat === 'material') {
      return { groups: groups, ready: true, material: (txt && txt.materials) || null };
    }

    var base = 'factions/' + state.expansion + '/' + fac + '/' + FOLDER[cat] + '/';
    function push(file, label, kind, text) {
      if (txt && txt.components[FOLDER[cat] + '/' + file]) { kind = 'overlay'; text = txt.components[FOLDER[cat] + '/' + file]; }
      var idx = flat.length;
      var c = { src: base + file, label: cardName(state.expansion, fac, cat, file, text && text.title || label),
        index: idx, kind: kind || null, text: text || null,
        template: cardTemplate(txt, cat, file),
        aspect: txt && txt.cardAspect && /^(combat|orders|events)$/.test(cat) ? txt.cardAspect : null,
        exp: state.expansion, fac: fac, facName: facName(fac), catName: catName(cat) };
      flat.push(c);
      return c;
    }

    if (cat === 'combat') {
      (man.combat || []).forEach(function (files, ti) {
        var label = (txt && txt.tierLabels && txt.tierLabels[ti]) || tierLabel(ti);
        var tierTxt = txt && txt.combat ? txt.combat[ti] : null;
        var cards = files.map(function (f, i) {
          var t = tierTxt && tierTxt[i]
            ? { title: tierTxt[i].title, background: tierTxt[i].general, foreground: tierTxt[i].unit, icons: tierTxt[i].icons, raster: txt.raster, source: tierTxt[i].source, aspect: tierTxt[i].aspect }
            : null;
          return push(f, facName(fac) + ' · ' + label + ' ' + (i + 1), 'combat', t);
        });
        if (cards.length) groups.push({ label: label, sub: cards.length + ' ' + ruPlural(cards.length, 'карточка', 'карточки', 'карточек'), cards: cards });
      });
    } else {
      var files = man[cat] || [];
      var labels, kind = null, textList = null;
      if (cat === 'backs') {
        labels = files.map(function (f) { return backLabel(f); });
      } else if (cat === 'faction_card') {
        labels = files.map(function (_, i) { return facName(fac) + ' Справочник' + (files.length > 1 ? ' ' + (i + 1) : ''); });
      } else if (cat === 'map') {
        labels = files.map(function (_, i) { return 'Карта ' + String.fromCharCode(65 + i); });
      } else if (cat === 'orders') {
        labels = files.map(function (_, i) { return 'Приказ ' + (i + 1); });
        kind = 'orders'; textList = txt ? txt.orders : null;
      } else {
        labels = files.map(function (_, i) { return 'Событие ' + (i + 1); });
        kind = 'events'; textList = txt ? txt.events : null;
      }
      var cards = files.map(function (f, i) {
        var t = (kind && textList && textList[i]) ? textList[i] : null;
        return push(f, labels[i], kind, t);
      });
      if (cards.length) groups.push({ label: null, sub: '', cards: cards });
    }
    return { groups: groups, ready: true };
  }

  function facNameOf(exp, fac) { var f = findKey(DATA.factions[exp] || [], fac); return f ? f.name : fac; }

  // Все карточки одной фракции по всем категориям — для глобального поиска
  function collectFaction(exp, fac) {
    var id = exp + '/' + fac;
    var man = DATA.manifest[id], txt = DATA.text[id];
    var out = [];
    if (!man) return out;
    var fn = facNameOf(exp, fac), en = expName(exp);
    DATA.categories.forEach(function (c) {
      var cat = c.key;
      if (cat === 'material' || !FOLDER[cat]) return;
      var base = 'factions/' + exp + '/' + fac + '/' + FOLDER[cat] + '/';
      function add(file, label, kind, text) {
        if (txt && txt.components[FOLDER[cat] + '/' + file]) { kind = 'overlay'; text = txt.components[FOLDER[cat] + '/' + file]; label = text.title; }
        out.push({ src: base + file, kind: kind || null, text: text || null,
          template: cardTemplate(txt, cat, file),
          aspect: txt && txt.cardAspect && /^(combat|orders|events)$/.test(cat) ? txt.cardAspect : null,
          label: cardName(exp, fac, cat, file, label),
          catName: catName(cat), exp: exp, expName: en, fac: fac, facName: fn });
      }
      if (cat === 'combat') {
        (man.combat || []).forEach(function (files, ti) {
          var tierTxt = txt && txt.combat ? txt.combat[ti] : null;
          var tierName = (txt && txt.tierLabels && txt.tierLabels[ti]) || tierLabel(ti);
          files.forEach(function (f, i) {
            var tt = tierTxt && tierTxt[i];
            var t = tt ? { title: tt.title, background: tt.general, foreground: tt.unit, icons: tt.icons, raster: txt.raster, source: tt.source, aspect: tt.aspect } : null;
            add(f, (tt && tt.title) ? tt.title : (fn + ' · ' + tierName + ' ' + (i + 1)), 'combat', t);
          });
        });
      } else {
        var files = man[cat] || [];
        files.forEach(function (f, i) {
          var label, kind = null, t = null;
          if (cat === 'backs') label = backLabel(f);
          else if (cat === 'faction_card') label = fn + ' Справочник' + (files.length > 1 ? ' ' + (i + 1) : '');
          else if (cat === 'map') label = 'Карта ' + String.fromCharCode(65 + i);
          else if (cat === 'orders') { kind = 'orders'; t = txt && txt.orders ? txt.orders[i] : null; label = (t && t.title) || ('Приказ ' + (i + 1)); }
          else { kind = 'events'; t = txt && txt.events ? txt.events[i] : null; label = (t && t.title) || ('Событие ' + (i + 1)); }
          add(f, label, kind, t);
        });
      }
    });
    return out;
  }

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
    state.lb = idx; state.lbFull = false; state.lbMag = false; showLightbox(); updateURL();
  }
  function closeLb() {
    state.lb = null; pendingCard = null; hideLightbox(); releaseModal(); updateURL();
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
    if (state.lb === null) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (viewerIsFullscreen()) toggleViewerFullscreen();
      else closeLb();
    }
    else if (e.key === 'Tab') {
      var modal = document.querySelector('.fs-lb');
      var nodes = [].filter.call(modal.querySelectorAll('button, a, summary, input, select'), function (node) { return !node.disabled && node.getClientRects().length > 0; });
      var first = nodes[0], last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    } else if (!/INPUT|SELECT|TEXTAREA/.test(e.target.tagName) && !String(window.getSelection())) {
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
    if (/^(base|gif|sow|tdl)\/[a-z0-9_-]+\/(combat|orders|events|faction_card|maps|backs)\/[a-zA-Z0-9_.-]+\.jpg$/.test(it.card)) {
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
        return el('button', { class: cls, onclick: (function (key) { return function () { setState({ faqTopic: key }); }; })(t.key) }, kids);
      })
    );
    var sidebar = el('aside', { class: 'fs-sidebar fs-scroll' }, [
      el('div', { class: 'fs-sidebar-label', text: 'Темы' }),
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
                setState({ expansion: ek, faction: fk, lb: null, expOpen: ek, cardQuery: '' });
              }; })(e.key, f.key),
            }, [
              el('span', { class: 'fs-fac-dot fs-fac-subdot', style: 'background:' + f.dot + ';' }),
              el('span', { class: 'fs-fac-name', text: f.name }),
              el('span', { class: 'fs-fac-count', text: cnt == null ? '' : String(cnt) }),
            ]);
          })
        );

        return el('div', { class: 'fs-nav-group', 'data-exp': e.key }, [expHeader, subs]);
      })
    );

    var sidebar = el('aside', { class: 'fs-sidebar fs-scroll' }, [
      el('div', { class: 'fs-sidebar-label', text: 'База и дополнения' }),
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
      main.appendChild(el('div', { class: 'fs-empty' }, [
        el('div', { class: 'fs-empty-glyph' }, [el('div', { class: 'ring' }), el('div', { class: 'core' })]),
        el('div', { class: 'fs-empty-stack' }, [
          el('h2', { text: 'Forbidden Stars — Картотека' }),
          el('p', { html: 'Выберите игру и фракцию слева, чтобы просмотреть карточки &mdash; или воспользуйтесь поиском.' }),
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

  // Встраивает оверлей лайтбокса в `app` при открытой карточке
  function appendLightbox(app) {
    if (state.lb === null) return;
    var c = flat[state.lb];
    if (!c) return;
    var full = state.lbFull;
    var mag = state.lbMag;

    var imgEl = el('img', { alt: c.label, decoding: 'async' });
    var imgWrap = el('div', { class: 'fs-lb-imgwrap' + (mag ? ' mag-on' : '') }, [imgEl]);
    fitViewer(imgWrap, c);
    prepareCard(imgEl, c, true);
    attachMagnifier(imgWrap, imgEl);
    var textPanel = null;
    if (c.text) {
      textPanel = el('details', { class: 'fs-card-text', open: window.innerWidth > 720 ? '' : null }, [
        el('summary', { text: 'Текст карточки' }),
        el('h2', { text: c.text.title || c.label }),
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
      el('div', { class: 'fs-lb-maghint' + (mag ? '' : ' hidden') }, [
        'Прокрутка = масштаб · Shift+прокрутка = размер лупы',
      ]),
      el('button', {
        class: 'fs-lb-tool fs-lb-mag' + (mag ? ' is-active' : ''),
        'aria-label': 'Лупа',
        'aria-pressed': String(mag),
        'data-tip': 'Лупа · прокрутка: масштаб · Shift+прокрутка: размер',
        html: '&#9906;',
        onclick: function (e) {
          e.stopPropagation();
          state.lbMag = !state.lbMag;
          var ov = e.currentTarget.closest('.fs-lb');
          var wrap = ov.querySelector('.fs-lb-imgwrap');
          wrap.classList.toggle('mag-on', state.lbMag);
          e.currentTarget.classList.toggle('is-active', state.lbMag);
          e.currentTarget.setAttribute('aria-pressed', String(state.lbMag));
          var hint = ov.querySelector('.fs-lb-maghint');
          if (hint) hint.classList.toggle('hidden', !state.lbMag);
          if (!state.lbMag) { var l = wrap.querySelector('.fs-lb-lens'); if (l) l.style.display = 'none'; }
        },
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
    app.appendChild(el('div', { class: 'fs-lb' + (full ? ' is-fullscreen' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': c.label,
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
      if (root) root.textContent = 'Ошибка загрузки данных.';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
