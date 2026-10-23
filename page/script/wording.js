/* Canonical text stays readable in JSON; only presentation uses token glyphs. */
(function (root) {
  'use strict';
  var tokens = [
    { key: 'FORGE', glyph: '\uE100', image: 'pictures/tokens/forge.png', label: 'жетон кузницы', pattern: /(?:жетон(?:ами|ах|ов|ом|а|ы)?\s+кузниц[аыеу]|forge\s+tokens?)(?!\p{L})/giu },
    { key: 'REINFORCE', glyph: '\uE101', image: 'pictures/tokens/reinforce.png', label: 'жетон подкрепления', pattern: /(?:жетон(?:ами|ах|ов|ом|а|ы)?\s+подкреплени[яйею]|reinforcement\s+tokens?)(?!\p{L})/giu },
    { key: 'CACHE', glyph: '\uE102', image: 'pictures/tokens/cache.png', label: 'жетон запасов', pattern: /(?:жетон(?:ами|ах|ов|ом|а|ы)?\s+(?:запас(?:ов|а|ы)|склад[аыуе])|cache\s+tokens?)(?!\p{L})/giu },
  ];
  // The same game-font glyphs are used by canvas cards and HTML descriptions.
  // Match explicit notation only; ordinary brackets and punctuation stay text.
  var symbols = [
    { notation:'[B]', glyph:'}', label:'болтер на кубе' },
    { notation:'[S]', glyph:'{', label:'щит на кубе' },
    { notation:'[M]', glyph:'<', label:'мораль на кубе' },
    { notation:'[D]', glyph:'|', label:'куб' },
    { notation:'(B)', glyph:'#', label:'временная атака' },
    { notation:'(S)', glyph:'@', label:'временная защита' },
  ];
  function symbolize(text) {
    var value = String(text || '');
    symbols.forEach(function (symbol) { value = value.split(symbol.notation).join(symbol.glyph); });
    return value;
  }
  function format(text, mode) {
    var value = String(text || '');
    tokens.forEach(function (token) {
      value = value.replace(new RegExp('\\[' + token.key + '\\]', 'g'), token.label);
      value = value.replace(new RegExp(token.glyph, 'g'), token.label);
    });
    // Explicit wording is retained for canonical text and source review. Both
    // visual styles use identical symbols/spacing and therefore identical wraps.
    if (mode === 'explicit') return value;
    // A shared noun in "жетоны склада/кузницы" still refers to two token types.
    value = value.replace(/жетон(?:ами|ах|ов|ом|а|ы)?\s+склада\/кузницы/giu, '\uE102/\uE100');
    tokens.forEach(function (token) { value = value.replace(token.pattern, token.glyph); });
    return value.replace(/(\d+)\s+([\uE100-\uE102])/g, '$1\u00a0$2');
  }
  function plain(text) {
    return format(text, 'explicit').replace(/\s*\*(?:newline|newpara)\*\s*/g, '\n').trim();
  }
  function normalize(text) {
    return plain(text).toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/[-\u2010-\u2015]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function append(node, text, mode) {
    mode = mode || 'images';
    var value = format(text, mode).replace(/\s*\*(?:newline|newpara)\*\s*/g, '\n')
      .replace(/(\d+)[ \t]+(?=\[[BSMD]\]|\([BS]\))/g, '$1\u00a0');
    value.split(/([\uE100-\uE102]|\[[BSMD]\]|\([BS]\))/).forEach(function (part) {
      var token = tokens.find(function (t) { return t.glyph === part; }) || symbols.find(function (s) { return s.notation === part; });
      if (!token) { node.appendChild(document.createTextNode(part)); return; }
      var span = document.createElement('span');
      span.className = 'fs-token';
      span.setAttribute('role', 'img'); span.setAttribute('aria-label', token.label); span.title = token.label;
      if (mode === 'images' && token.image) {
        span.classList.add('fs-token--image');
        var fallback = document.createElement('span');
        fallback.className = 'fs-token-fallback'; fallback.textContent = token.glyph;
        fallback.setAttribute('aria-hidden', 'true'); span.appendChild(fallback);
        var img = document.createElement('img');
        img.className = 'fs-token-image'; img.alt = ''; img.setAttribute('aria-hidden', 'true');
        img.onload = function () { span.classList.add('has-image'); };
        img.onerror = function () { img.remove(); };
        img.src = token.image; span.appendChild(img);
      } else span.textContent = token.glyph;
      node.appendChild(span);
    });
    return node;
  }
  root.FSWord = { tokens: tokens, symbols: symbols, symbolize: symbolize, format: format, plain: plain, normalize: normalize, append: append };
})(window);
