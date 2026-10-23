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
  // Both browsing and printing use this session snapshot, including in-flight
  // requests. Failed/aborted documents are evicted so retry is meaningful.
  var documents = create(32);
  function request(url, options) {
    var fresh = options && options.fresh, cached = !fresh && documents.get(url);
    if (cached) return cached;
    var controller = new AbortController(), timer = setTimeout(function () { controller.abort(); },15000);
    var pending = fetch(url,{cache:'no-store',signal:controller.signal}).then(async function (response) {
      if (!response.ok) throw new Error('HTTP '+response.status+' — '+url);
      var text = await response.text(); return {value:JSON.parse(text),text:text};
    }).catch(function (error) {
      if (!fresh && documents.get(url)===pending) documents.delete(url);
      if (controller.signal.aborted) throw new Error('Не завершена загрузка '+url);
      throw error;
    }).finally(function () { clearTimeout(timer); });
    if (!fresh) documents.set(url,pending);
    return pending;
  }
  async function json(url, options) { return (await request(url,options)).value; }
  async function fingerprint(urls) {
    if (!root.crypto || !root.crypto.subtle) throw new Error('Для печати откройте справочник по HTTPS или через локальный модуль.');
    var paths = urls.slice().sort(), sources = await Promise.all(paths.map(function (url) { return request(url); }));
    var text = paths.map(function (url,index) { return url+'\n'+sources[index].text; }).join('\n');
    var digest = await root.crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest),function (b) { return b.toString(16).padStart(2,'0'); }).join('');
  }
  var api = {create:create,json:json,fingerprint:fingerprint};
  if (typeof module!=='undefined' && module.exports) module.exports=api;
  else root.FSCache = api;
})(typeof window!=='undefined'?window:globalThis);
