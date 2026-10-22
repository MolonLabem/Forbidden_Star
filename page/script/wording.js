/* Canonical text stays readable in JSON; only presentation uses token glyphs. */
(function (root) {
  'use strict';
  var tokens = [
    { key: 'FORGE', glyph: '\uE100', label: 'жетон кузницы', pattern: /(?:жетон(?:ами|ах|ов|ом|а|ы)?\s+кузниц[аыеу]|forge\s+tokens?)(?!\p{L})/giu },
    { key: 'REINFORCE', glyph: '\uE101', label: 'жетон подкрепления', pattern: /(?:жетон(?:ами|ах|ов|ом|а|ы)?\s+подкреплени[яйею]|reinforcement\s+tokens?)(?!\p{L})/giu },
    { key: 'CACHE', glyph: '\uE102', label: 'жетон запасов', pattern: /(?:жетон(?:ами|ах|ов|ом|а|ы)?\s+(?:запас(?:ов|а|ы)|склад[аыуе])|cache\s+tokens?)(?!\p{L})/giu },
  ];
  function format(text, mode) {
    var value = String(text || '');
    tokens.forEach(function (token) {
      value = value.replace(new RegExp('\\[' + token.key + '\\]', 'g'), token.label);
      value = value.replace(new RegExp(token.glyph, 'g'), token.label);
    });
    if (mode !== 'icons') return value;
    // A shared noun in "жетоны склада/кузницы" still refers to two token types.
    value = value.replace(/жетон(?:ами|ах|ов|ом|а|ы)?\s+склада\/кузницы/giu, '\uE102/\uE100');
    tokens.forEach(function (token) { value = value.replace(token.pattern, token.glyph); });
    return value.replace(/(\d+)\s+([\uE100-\uE102])/g, '$1\u00a0$2');
  }
  function plain(text) {
    return format(text, 'explicit').replace(/\s*\*(?:newline|newpara)\*\s*/g, '\n').trim();
  }
  function normalize(text) {
    return plain(text).toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
  }
  function append(node, text, mode) {
    var value = plain(format(text, mode));
    // plain() expands glyphs; preserve glyphs in the visual icon version.
    if (mode === 'icons') value = format(text, mode).replace(/\s*\*(?:newline|newpara)\*\s*/g, '\n');
    value.split(/([\uE100-\uE102])/).forEach(function (part) {
      var token = tokens.find(function (t) { return t.glyph === part; });
      if (!token) { node.appendChild(document.createTextNode(part)); return; }
      var span = document.createElement('span');
      span.className = 'fs-token'; span.textContent = token.glyph;
      span.setAttribute('role', 'img'); span.setAttribute('aria-label', token.label); span.title = token.label;
      node.appendChild(span);
    });
    return node;
  }
  root.FSWord = { tokens: tokens, format: format, plain: plain, normalize: normalize, append: append };
})(window);
