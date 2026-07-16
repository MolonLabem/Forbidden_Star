/* Forbidden Stars — FAQ.
 * Настраивает window.FS_FAQ для script.js (data/FAQ.json).
 * Цвета разделов подставляет script.js из general.json (expansion.color).
 *
 * Формат FAQ.json:  [ {Category, items:[ {SubCategory, items:[ {Faction, picture,
 *   items:[ {Phrase, Main} ] } ] } ] } ]
 */
(function () {
  'use strict';

  window.FS_FAQ = {
    src: 'data/FAQ.json',
    hero: {
      kicker: 'Справочник правил и уточнения',
      title: 'Часто задаваемые вопросы',
      blurb: 'Официальные разъяснения правил и ответы на вопросы, которые чаще всего возникают за столом — для базовой игры и дополнений. Выберите раздел слева или воспользуйтесь поиском выше.',
    },
    // Заполняется из general.json.expansion.color при загрузке
    dots: ['#d8a657'],

    flatten: function (raw) {
      var DOTS = this.dots && this.dots.length ? this.dots : ['#d8a657'];
      var navTopics = [{ key: 'all', name: 'Все вопросы', kind: 'all', dot: DOTS[0] }];
      var cats = [];
      var count = { all: 0 };
      var uid = 0;
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
          var subObj = { key: skey, name: sub.SubCategory || ('Группа ' + (si + 1)), factions: [] };
          var subCount = 0;
          (sub.items || []).forEach(function (fac) {
            var facObj = { faction: fac.Faction || '', picture: fac.picture || '', items: [] };
            (fac.items || []).forEach(function (it) {
              if (!it || !it.Phrase) return;
              facObj.items.push({ id: uid++, q: it.Phrase, a: it.Main || '' });
              subCount++; count[ckey]++; count.all++;
            });
            if (facObj.items.length) subObj.factions.push(facObj);
          });
          if (subObj.factions.length) {
            count[skey] = subCount;
            navTopics.push({ key: skey, name: subObj.name, kind: 'sub', parent: ckey });
            catObj.subs.push(subObj);
          }
        });
        cats.push(catObj);
      });
      return { navTopics: navTopics, cats: cats, count: count };
    },
  };
})();
