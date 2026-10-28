/* Forbidden Stars — FAQ.
 * Настраивает window.FS_FAQ для script.js (data/FAQ.json).
 * Цвета разделов подставляет script.js из general.json (expansion.color).
 *
 * Формат FAQ.json:  [ {Category, items:[ {SubCategory, items:[ {Faction, picture,
 *   items:[ {Phrase, Main, Id?, Source?, Card?, CardSource?, RuleSource?, RelatedSources?, LegacySource?} ] } ] } ] } ]
 */
(function () {
  'use strict';

  window.FS_FAQ = {
    src: 'data/FAQ.json',
    hero: {
      title: 'Вопросы по правилам',
      blurb: 'Выберите фракцию или найдите вопрос по названию карты. Источники и правила сообщества указаны в ответах.',
    },
    // Заполняется из general.json.expansion.color при загрузке
    dots: ['#d8a657'],

    flatten: function (raw) {
      var DOTS = this.dots && this.dots.length ? this.dots : ['#d8a657'];
      var navTopics = [{ key: 'all', name: 'Все вопросы', kind: 'all', dot: DOTS[0] }];
      var cats = [];
      var factions = [];
      var count = { all: 0 };
      (raw || []).forEach(function (cat, ci) {
        var ckey = 'c' + ci;
        var catObj = {
          key: ckey,
          name: cat.Category || ('Раздел ' + (ci + 1)),
          dot: DOTS[(ci + 1) % DOTS.length],
          subs: [],
        };
        navTopics.push({ key: ckey, name: catObj.name, kind: 'cat', dot: catObj.dot });
        count[ckey] = 0;
        (cat.items || []).forEach(function (sub, si) {
          var skey = ckey + '_s' + si;
          var subObj = { key: skey, name: sub.SubCategory || ('Группа ' + (si + 1)), common: sub.SubCategory === 'Общие', factions: [] };
          var subCount = 0;
          (sub.items || []).forEach(function (fac) {
            var facObj = { faction: fac.Faction || '', picture: fac.picture || '', items: [] };
            (fac.items || []).forEach(function (it) {
              if (!it || !it.Phrase) return;
              var id = it.Id || (window.FSNav ? window.FSNav.faqId(cat.Category, sub.SubCategory, fac.Faction, it.Phrase, it.Source) : (ckey + '_' + skey + '_' + count.all));
              facObj.items.push({ id: id, q: it.Phrase, a: it.Main || '', source: it.Source || '',
                card: it.Card || '', cardSource: it.CardSource || '', ruleSource: it.RuleSource || '', relatedSources: it.RelatedSources || [], legacySource: it.LegacySource || '' });
              subCount++; count[ckey]++; count.all++;
            });
            if (facObj.items.length) {
              subObj.factions.push(facObj);
              // In "Общие", Faction labels name rule topics rather than armies.
              if (sub.SubCategory !== 'Общие' && facObj.faction && !factions.some(function (f) { return f.key === facObj.faction; })) {
                var linked = facObj.items.find(function (item) { return item.card; });
                factions.push({ key: facObj.faction, name: facObj.faction, parent: ckey,
                  catalogId: linked ? linked.card.replace(/^tdl\//, 'dl/').split('/').slice(0, 2).join('/') : '' });
              }
            }
          });
          if (subObj.factions.length) {
            count[skey] = subCount;
            navTopics.push({ key: skey, name: subObj.name, kind: 'sub', parent: ckey });
            catObj.subs.push(subObj);
          }
        });
        cats.push(catObj);
      });
      return { navTopics: navTopics, cats: cats, count: count, factions: factions };
    },
  };
})();
