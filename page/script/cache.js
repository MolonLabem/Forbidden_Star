/* Small bounded LRU caches shared by image loaders and the card compositor. */
(function (root) {
  'use strict';
  function create(limit) {
    var values = new Map();
    return {
      get: function (key) {
        if (!values.has(key)) return undefined;
        var value = values.get(key);
        values.delete(key); values.set(key, value);
        return value;
      },
      set: function (key, value) {
        values.delete(key); values.set(key, value);
        while (values.size > limit) values.delete(values.keys().next().value);
        return value;
      },
      delete: function (key) { values.delete(key); },
      clear: function () { values.clear(); },
      get size() { return values.size; },
    };
  }
  root.FSCache = { create: create };
})(window);
