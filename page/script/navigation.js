/* Shareable routes use real asset filenames and stable FAQ identities. */
(function (root) {
  'use strict';
  function expansion(value) { return value === 'tdl' ? 'dl' : value; }
  function cardPath(value) { return value && value.replace(/^((?:\.\/)?factions\/)?tdl\//, '$1dl/'); }
  function read(hash) {
    var p = new URLSearchParams((hash || '').replace(/^#/, ''));
    return { view: p.get('view') === 'faq' ? 'faq' : 'codex', expansion: expansion(p.get('exp')) || null,
      faction: p.get('faction') || null, category: p.get('category') || 'combat',
      cardQuery: p.get('q') || '', faqQuery: p.get('faqQ') || '', faqTopic: p.get('topic') || 'all',
      card: cardPath(p.get('card')) || null, question: p.get('question') || null };
  }
  function write(state, card, question) {
    var p = new URLSearchParams();
    if (state.view === 'faq') {
      p.set('view', 'faq');
      if (state.faqTopic !== 'all') p.set('topic', state.faqTopic);
      if (state.faqQuery) p.set('faqQ', state.faqQuery);
      if (question) p.set('question', question);
    } else {
      if (state.expansion) p.set('exp', expansion(state.expansion));
      if (state.faction) p.set('faction', state.faction);
      if (state.category !== 'combat') p.set('category', state.category);
      if (state.cardQuery) p.set('q', state.cardQuery);
      if (card) p.set('card', cardPath(card));
    }
    return p.size ? '#' + p.toString() : '';
  }
  function faqId(category, subcategory, faction, phrase, source) {
    if (source) return 'note-' + source.split('/').pop();
    var value = [category, subcategory, faction, phrase].join('\n');
    var hash = 2166136261;
    for (var i = 0; i < value.length; i++) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return 'faq-' + (hash >>> 0).toString(16);
  }
  root.FSNav = { read: read, write: write, faqId: faqId };
})(window);
