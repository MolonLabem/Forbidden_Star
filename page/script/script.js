/* Forbidden Stars — Картотека карточек
 * Ванильный, управляемый данными браузер карточек. Без фреймворков и сборки.
 *
 * Структура данных (в page/factions/):
 *   general.json                       — дополнения (+color), категории, labels, filenames
 *   <expansion>/faction.json           — фракции (+color), имена
 *   <expansion>/<faction>/text.json    — необязательное переопределение filenames и текст карточек
 *   <expansion>/<faction>/<folder>/<file>  — изображения карточек
 *
 * Отсутствующие изображения (например, дополнение без карт) обрабатываются
 * корректно: карточка с 404 убирается из сетки.
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
  // Кэш растров обычных карточек (очищается при смене разрешения)
  var _raster = {};

  function applyResolution(hi) {
    useHighRes = hi;
    var w = hi ? 630 : 450, h = hi ? 880 : 650;
    if (window.FSCardRender) window.FSCardRender.setResolution(w, h);
    _raster = {};
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
  };

  // Напечатанное название карточки (из cardnames.json) или запасной вариант
  function cardName(exp, fac, cat, file, fallback) {
    var n = DATA.cardnames[exp + '/' + fac + '/' + cat + '/' + file];
    return n || fallback;
  }

  function ensureFaq() {
    if (DATA.faq || DATA.loading.faq || !window.FS_FAQ) return;
    DATA.loading.faq = true;
    fetchJSON(window.FS_FAQ.src).then(function (raw) {
      if (DATA.expansions.length) {
        window.FS_FAQ.dots = [ACCENT_FALLBACK].concat(DATA.expansions.map(function (e) { return e.color; }));
      }
      DATA.faq = window.FS_FAQ.flatten(raw);
      render();
    }).catch(function (e) {
      console.error('Ошибка загрузки FAQ', e);
      DATA.faq = { navTopics: [{ key: 'all', name: 'Все вопросы', dot: ACCENT_FALLBACK }], cats: [], count: {} };
      render();
    });
  }

  var state = {
    expansion: null, faction: null, category: 'combat',
    lb: null, lbFull: false, lbMag: false, lbZoom: 2, lbLensSize: 204,
    view: 'codex',
    faqTopic: 'all', faqQuery: '', faqOpen: {},
    expOpen: null,
    cardQuery: '',
  };
  var flat = [];

  function setState(patch) {
    for (var k in patch) { if (patch.hasOwnProperty(k)) state[k] = patch[k]; }
    render();
  }

  // Монтирует дерево в #app, сохраняя фокус поля поиска при перерисовке
  function mountApp(app) {
    var root = document.getElementById('app');
    var ae = document.activeElement, sel = null;
    if (ae && ae.classList && ae.classList.contains('fs-faq-search')) {
      sel = { s: ae.selectionStart, e: ae.selectionEnd };
    }
    root.innerHTML = '';
    root.appendChild(app);
    if (sel) {
      var inp = root.querySelector('.fs-faq-search');
      if (inp) { inp.focus(); try { inp.setSelectionRange(sel.s, sel.e); } catch (e) {} }
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

  // Загружает манифест имён файлов фракции (text.json или умолчания)
  function ensureManifest(exp, fac) {
    var id = exp + '/' + fac;
    if (DATA.manifest[id] || DATA.loading['man:' + id]) return;
    DATA.loading['man:' + id] = true;
    fetchJSON('factions/' + exp + '/' + fac + '/text.json').then(function (t) {
      DATA.manifest[id] = mergeFilenames(t && t.filenames);
      DATA.text[id] = {
        combat:    (t && t.combatText)    || null,
        orders:    (t && t.ordersText)    || null,
        events:    (t && t.eventsText)    || null,
        materials: (t && t.materialsText) || null,
      };
      render();
    }).catch(function () {
      DATA.manifest[id] = mergeFilenames(null);
      DATA.text[id] = { combat: null, orders: null, events: null, materials: null };
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

  function manifestCount(man) {
    if (!man) return null;
    var n = 0;
    (man.combat || []).forEach(function (tier) { n += tier.length; });
    ['orders', 'events', 'backs', 'faction_card', 'map'].forEach(function (k) { n += (man[k] || []).length; });
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

  /* ---- Композитинг / растрирование карточек ---- */

  function cardPixelSize() {
    return useHighRes ? { w: 630, h: 880 } : { w: 450, h: 650 };
  }

  // Масштабирует исходное изображение до выбранного разрешения (для скачивания).
  // Отображение по-прежнему задаётся CSS и не зависит от пиксельного размера.
  function rasterizeCard(src) {
    var sz = cardPixelSize();
    var key = src + '@' + sz.w + 'x' + sz.h;
    if (_raster[key]) return _raster[key];
    _raster[key] = new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        var c = document.createElement('canvas');
        c.width = sz.w;
        c.height = sz.h;
        c.getContext('2d').drawImage(img, 0, 0, sz.w, sz.h);
        resolve(c.toDataURL('image/png'));
      };
      img.onerror = function () { resolve(src); };
      img.src = src;
    });
    return _raster[key];
  }

  function isCardShaped(card) {
    if (card.kind) return true;
    return /\/(combat|orders|events|backs)\//.test(card.src || '');
  }

  // SoW (с текстом) — canvas-композиция; остальные карточные типы —
  // растр в 450×650 / 630×880, чтобы «Сохранить изображение» отдавало нужный размер.
  function applyComposite(imgEl, card) {
    if (card.text && card.kind && window.FSCardRender) {
      window.FSCardRender.compose(card).then(function (url) {
        if (url) imgEl.src = url;
      });
      return;
    }
    if (isCardShaped(card)) {
      rasterizeCard(card.src).then(function (url) {
        if (url) imgEl.src = url;
      });
    }
  }

  function lbImg(card) {
    var img = el('img', { src: card.src, alt: card.label });
    applyComposite(img, card);
    return img;
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

  function maybeEmptyNote(scrollarea) {
    if (!scrollarea || scrollarea.querySelector('.fs-note')) return;
    var cards = scrollarea.querySelectorAll('.fs-card');
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].style.display !== 'none') return;
    }
    if (cards.length) scrollarea.appendChild(el('div', { class: 'fs-note', text: 'Нет изображений для этого набора.' }));
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
      var idx = flat.length;
      var c = { src: base + file, label: label, index: idx, kind: kind || null, text: text || null };
      flat.push(c);
      return c;
    }

    if (cat === 'combat') {
      (man.combat || []).forEach(function (files, ti) {
        var label = tierLabel(ti);
        var tierTxt = txt && txt.combat ? txt.combat[ti] : null;
        var cards = files.map(function (f, i) {
          var t = tierTxt && tierTxt[i]
            ? { title: tierTxt[i].title, background: tierTxt[i].general, foreground: tierTxt[i].unit, icons: tierTxt[i].icons }
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
        out.push({ src: base + file, kind: kind || null, text: text || null,
          label: cardName(exp, fac, cat, file, label),
          catName: catName(cat), exp: exp, expName: en, fac: fac, facName: fn });
      }
      if (cat === 'combat') {
        (man.combat || []).forEach(function (files, ti) {
          var tierTxt = txt && txt.combat ? txt.combat[ti] : null;
          var tierName = tierLabel(ti);
          files.forEach(function (f, i) {
            var tt = tierTxt && tierTxt[i];
            var t = tt ? { title: tt.title, background: tt.general, foreground: tt.unit, icons: tt.icons } : null;
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

  function showLightbox() {
    var appEl = document.querySelector('.fs-app');
    if (!appEl) { render(); return; }
    var old = appEl.querySelector('.fs-lb'); if (old) old.remove();
    appendLightbox(appEl);
  }
  function hideLightbox() { var lb = document.querySelector('.fs-lb'); if (lb) lb.remove(); }

  function openLb(idx) { state.lb = idx; state.lbFull = true; state.lbMag = false; showLightbox(); }
  function closeLb() { state.lb = null; hideLightbox(); }
  function step(d) {
    if (!flat.length || state.lb === null) return;
    state.lb = (state.lb + d + flat.length) % flat.length;
    showLightbox();
  }

  document.addEventListener('keydown', function (e) {
    if (state.lb === null) return;
    if (e.key === 'Escape') closeLb();
    else if (e.key === 'ArrowRight') step(1);
    else if (e.key === 'ArrowLeft') step(-1);
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
    var head = el('button', { class: 'fs-faq-qbtn', onclick: function (e) {
      var o = !state.faqOpen[it.id];
      state.faqOpen[it.id] = o;
      e.currentTarget.parentNode.classList.toggle('is-open', o);
      icon.classList.toggle('is-open', o);
    } }, [
      el('span', { class: 'fs-faq-q', text: it.q }),
      icon,
    ]);
    var answer = el('div', { class: 'fs-faq-answer' }, [el('p', { class: 'fs-faq-atext', text: it.a })]);
    return el('div', { class: 'fs-faq-item' + (open ? ' is-open' : '') }, [head, answer]);
  }

  function renderFaqView() {
    ensureFaq();
    var hero = (window.FS_FAQ && window.FS_FAQ.hero) || {};
    var FAQ = DATA.faq || { navTopics: [], cats: [], count: {} };
    var ready = !!DATA.faq;
    var topic = state.faqTopic;
    var q = (state.faqQuery || '').trim().toLowerCase();
    var matches = function (it) { return !q || (it.q + ' ' + it.a).toLowerCase().indexOf(q) >= 0; };

    var app = el('div', { class: 'fs-app', 'data-accent': ACCENT });

    var search = el('input', {
      class: 'fs-faq-search', type: 'text', value: state.faqQuery,
      placeholder: 'Поиск по вопросам…', spellcheck: 'false',
      oninput: function (e) { setState({ faqQuery: e.target.value }); },
    });
    var header = el('header', { class: 'fs-header fs-faq-header' }, [
      el('div', { class: 'fs-brand fs-brand-link', title: 'На главную', onclick: goHome }, [
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
    if (!ready) {
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
    var cols = Math.max(2, Math.min(8, density()));
    var cat = state.category;

    var built = build();
    var groups = built.groups;

    // Faction Card и Maps — без принудительного соотношения сторон
    // Events: 2×4; Orders: 2 ряда (3 колонки); остальные — адаптивная сетка
    var naturalCard = (cat === 'faction_card' || cat === 'map');
    var gridCols, gridJustify, cardAspect;
    if (cat === 'faction_card') {
      gridCols = 'repeat(1, minmax(0, 920px))'; gridJustify = 'center'; cardAspect = '';
    } else if (cat === 'map') {
      gridCols = 'repeat(1, minmax(0, 920px))'; gridJustify = 'center'; cardAspect = '';
    } else if (cat === 'events') {
      gridCols = 'repeat(4, minmax(0, 1fr))'; gridJustify = 'start'; cardAspect = '450 / 650';
    } else if (cat === 'orders') {
      gridCols = 'repeat(4, minmax(0, 1fr))'; gridJustify = 'start'; cardAspect = '450 / 650';
    } else {
      gridCols = 'repeat(' + cols + ', minmax(0, 1fr))'; gridJustify = 'start'; cardAspect = '450 / 650';
    }

    var app = el('div', { class: 'fs-app', 'data-accent': ACCENT });

    /* ---- Заголовок ---- */
    var header = el('header', { class: 'fs-header fs-faq-header' }, [
      el('div', { class: 'fs-brand fs-brand-link', title: 'На главную', onclick: goHome }, [
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
          placeholder: 'Поиск по всем карточкам…', spellcheck: 'false',
          oninput: function (e) { setState({ cardQuery: e.target.value, lb: null }); },
        }),
      ]),
      el('div', { class: 'fs-header-spacer' }),
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
          onclick: (function (key) {
            return function (ev) {
              state.expOpen = (state.expOpen === key) ? null : key;
              var nav = ev.currentTarget.closest('.fs-nav');
              [].forEach.call(nav.querySelectorAll('.fs-nav-group'), function (g) {
                var isOpen = g.getAttribute('data-exp') === state.expOpen;
                var s = g.querySelector('.fs-nav-subs'); if (s) s.classList.toggle('collapsed', !isOpen);
                var c = g.querySelector('.fs-exp-chevron'); if (c) c.classList.toggle('open', isOpen);
              });
            };
          })(e.key),
        }, [
          el('span', { class: 'fs-fac-dot fs-faq-dot', style: 'background:' + expColor(e.key) + ';' }),
          el('span', { class: 'fs-fac-name', text: e.name }),
          chevron,
        ]);

        var subs = el('div', { class: 'fs-nav-subs' + (open ? '' : ' collapsed') },
          facs.map(function (f) {
            var cnt = manifestCount(DATA.manifest[e.key + '/' + f.key]);
            var facActive = expActive && state.faction === f.key;
            return el('button', {
              class: 'fs-faq-subnav fs-fac-sub' + (facActive ? ' is-active' : ''),
              onclick: (function (ek, fk) { return function () { setState({ expansion: ek, faction: fk, lb: null, expOpen: ek, cardQuery: '' }); }; })(e.key, f.key),
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

    // Переключатель разрешения (чекбокс-тоггл)
    var resInput = el('input', {
      type: 'checkbox', id: 'fs-res-toggle', class: 'fs-res-input',
      checked: useHighRes ? 'checked' : null,
      onchange: function (e) { applyResolution(e.target.checked); render(); },
    });
    var resLabel = el('label', { class: 'fs-res-label', for: 'fs-res-toggle' }, [
      el('span', { class: 'fs-res-track' }, [el('span', { class: 'fs-res-thumb' })]),
      el('span', { class: 'fs-res-text', text: useHighRes ? 'Высокое (630×880)' : 'Стандарт (450×650)' }),
    ]);
    var resBtn = el('div', { class: 'fs-res-wrap' }, [resInput, resLabel]);

    var sidebar = el('aside', { class: 'fs-sidebar fs-scroll' }, [
      el('div', { class: 'fs-sidebar-label', text: 'База и дополнения' }),
      libNav,
      el('div', { class: 'fs-sidebar-section fs-faq-section' }, [
        el('div', { class: 'fs-sidebar-label', text: 'Справочник' }),
        el('button', { class: 'fs-fac fs-faq-entry', onclick: function () { setState({ view: 'faq', cardQuery: '' }); } }, [
          el('span', { class: 'fs-fac-dot fs-faq-dot', style: 'background:var(--fs-accent);' }),
          el('span', { class: 'fs-fac-name', text: 'FAQ' }),
          el('span', { class: 'fs-fac-count', html: '&rsaquo;' }),
        ]),
      ]),
      el('div', { class: 'fs-sidebar-section' }, [
        el('div', { class: 'fs-sidebar-label', text: 'Разрешение' }),
        resBtn,
      ]),
      el('div', { class: 'fs-sidebar-foot' }, [
        el('p', { html: 'FAN PROJECT &middot; NON&#8209;COMMERCIAL<br>Artwork &copy; Games Workshop' }),
      ]),
    ]);

    /* ---- Основная область ---- */
    var main = el('main', { class: 'fs-main' });

    // ---- Глобальный поиск по карточкам, сгруппированный по дополнению → фракции ----
    if (state.cardQuery.trim()) {
      var q = state.cardQuery.trim().toLowerCase();
      flat = [];
      var match = function (c) {
        return (c.label + ' ' + (c.text && c.text.title ? c.text.title : '')).toLowerCase().indexOf(q) >= 0;
      };
      var sres = el('div', { class: 'fs-scrollarea fs-scroll' });
      DATA.expansions.forEach(function (e) {
        var facs = DATA.factions[e.key] || [];
        var facBlocks = [];
        var expCount = 0;
        facs.forEach(function (f) {
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
              onclick: (function (idx) { return function () { openLb(idx); }; })(card.index),
            }, [el('img', { src: card.src, alt: card.label, loading: 'lazy' })]);
            var imgEl = btn.querySelector('img');
            imgEl.addEventListener('error', function () { btn.style.display = 'none'; });
            applyComposite(imgEl, card);
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
      if (!flat.length) {
        sres.appendChild(el('div', { class: 'fs-note', text: 'Нет карточек по запросу «' + state.cardQuery + '».' }));
      }
      main.appendChild(sres);
      app.appendChild(header);
      app.appendChild(el('div', { class: 'fs-body' }, [sidebar, main]));
      appendLightbox(app);
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
    if (!built.ready) {
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
            title: card.label,
            style: cardAspect ? ('aspect-ratio:' + cardAspect + ';') : '',
            onclick: (function (idx) { return function () { openLb(idx); }; })(card.index),
          }, [
            el('img', { src: card.src, alt: card.label, loading: 'lazy' }),
          ]);
          var imgEl = btn.querySelector('img');
          imgEl.addEventListener('error', function () {
            btn.style.display = 'none';
            maybeEmptyNote(scrollarea);
          });
          applyComposite(imgEl, card);
          return btn;
        }));
        scrollarea.appendChild(grid);
      });
    }
    main.appendChild(scrollarea);

    app.appendChild(header);
    app.appendChild(el('div', { class: 'fs-body' }, [sidebar, main]));
    appendLightbox(app);
    mountApp(app);
  }

  // Встраивает оверлей лайтбокса в `app` при открытой карточке
  function appendLightbox(app) {
    if (state.lb === null) return;
    var c = flat[state.lb];
    if (!c) return;
    var full = state.lbFull;
    var mag = state.lbMag;

    var imgEl = lbImg(c);
    var imgWrap = el('div', { class: 'fs-lb-imgwrap' + (mag ? ' mag-on' : '') }, [imgEl]);
    attachMagnifier(imgWrap, imgEl);

    var children = [
      el('button', {
        class: 'fs-lb-nav', 'aria-label': 'Предыдущая карточка', html: '&lsaquo;',
        onclick: function (e) { e.stopPropagation(); step(-1); },
      }),
      el('figure', { class: 'fs-lb-fig' + (full ? ' is-full' : ''), onclick: function (e) { e.stopPropagation(); } }, [
        imgWrap,
        el('figcaption', { class: 'fs-lb-cap' }, [
          el('span', { class: 'fs-lb-label', text: c.label }),
          el('span', {
            class: 'fs-lb-meta',
            text: (c.catName || catName(state.category)) + ' · ' + facName(state.faction) + ' · ' + (state.lb + 1) + ' / ' + flat.length,
          }),
        ]),
      ]),
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
        'data-tip': 'Лупа · прокрутка: масштаб · Shift+прокрутка: размер',
        html: '&#9906;',
        onclick: function (e) {
          e.stopPropagation();
          state.lbMag = !state.lbMag;
          var ov = e.currentTarget.closest('.fs-lb');
          var wrap = ov.querySelector('.fs-lb-imgwrap');
          wrap.classList.toggle('mag-on', state.lbMag);
          e.currentTarget.classList.toggle('is-active', state.lbMag);
          var hint = ov.querySelector('.fs-lb-maghint');
          if (hint) hint.classList.toggle('hidden', !state.lbMag);
          if (!state.lbMag) { var l = wrap.querySelector('.fs-lb-lens'); if (l) l.style.display = 'none'; }
        },
      }),
      el('button', {
        class: 'fs-lb-tool fs-lb-full', 'aria-label': 'Полноэкранный режим',
        'data-tip': full ? 'По размеру окна' : 'На весь экран',
        html: full ? '&#10532;' : '&#10530;',
        onclick: function (e) {
          e.stopPropagation();
          state.lbFull = !state.lbFull;
          var ov = e.currentTarget.closest('.fs-lb');
          ov.querySelector('.fs-lb-fig').classList.toggle('is-full', state.lbFull);
          e.currentTarget.innerHTML = state.lbFull ? '&#10532;' : '&#10530;';
          e.currentTarget.setAttribute('data-tip', state.lbFull ? 'По размеру окна' : 'На весь экран');
        },
      }),
      el('button', {
        class: 'fs-lb-tool fs-lb-close', 'aria-label': 'Закрыть', 'data-tip': 'Закрыть (Esc)', html: '&#10005;',
        onclick: function (e) { e.stopPropagation(); closeLb(); },
      }),
    ];
    app.appendChild(el('div', { class: 'fs-lb', onclick: closeLb }, children));
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
