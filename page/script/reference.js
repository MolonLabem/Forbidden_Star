/* Load the official PDF once, with progress and recovery before native viewing. */
(function () {
  'use strict';
  var download = document.getElementById('reference-download');
  var source = download.href;
  var status = document.getElementById('reference-status');
  var detail = document.getElementById('reference-detail');
  var progress = document.getElementById('reference-progress');
  var cancel = document.getElementById('reference-cancel');
  var retry = document.getElementById('reference-retry');
  var viewer = document.getElementById('reference-viewer');
  var generation = 0, current = null, objectURL = null;

  function size(bytes) { return (bytes / 1048576).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' МБ'; }

  function showProgress(loaded, total) {
    if (total && loaded <= total) {
      progress.max = total;
      progress.value = loaded;
      detail.textContent = 'Загружено ' + size(loaded) + ' из ' + size(total) + '.';
    } else {
      progress.removeAttribute('value');
      detail.textContent = loaded ? 'Загружено ' + size(loaded) + '. Получаем файл…' : 'Получаем файл размером 61,3 МБ…';
    }
  }

  async function load() {
    if (current) return;
    var id = ++generation;
    var controller = new AbortController();
    var request = current = { controller: controller, timer: null, timedOut: false };
    function armTimeout() {
      clearTimeout(request.timer);
      // A slow transfer can keep going; only a stalled connection is timed out.
      request.timer = setTimeout(function () { request.timedOut = true; controller.abort(); }, 45000);
    }
    var chunks = [], reader;
    var retryHadFocus = document.activeElement === retry;
    status.textContent = 'Загрузка справочника…';
    status.setAttribute('role', 'status');
    retry.hidden = true;
    cancel.hidden = false;
    if (retryHadFocus) cancel.focus();
    progress.hidden = false;
    showProgress(0, 0);
    viewer.hidden = true;
    armTimeout();
    try {
      var response = await fetch(source, { signal: controller.signal, cache: id > 1 ? 'reload' : 'default' });
      if (!response.ok) throw new Error(response.status === 404 ? 'Файл справочника не найден.' : 'Не удалось получить справочник.');
      var encoding = response.headers.get('Content-Encoding');
      var total = !encoding || encoding === 'identity' ? Number(response.headers.get('Content-Length')) : 0;
      if (!Number.isFinite(total) || total <= 0) total = 0;
      var loaded = 0, blob;
      if (response.body && response.body.getReader) {
        reader = response.body.getReader();
        while (true) {
          var part = await reader.read();
          if (id !== generation) return;
          if (part.done) break;
          chunks.push(part.value);
          loaded += part.value.byteLength;
          showProgress(loaded, total);
          armTimeout();
        }
        blob = new Blob(chunks, { type: 'application/pdf' });
        chunks = [];
      } else {
        // Without stream events we cannot distinguish a slow transfer from a stall.
        clearTimeout(request.timer);
        blob = await response.blob();
        if (blob.type !== 'application/pdf') blob = new Blob([blob], { type: 'application/pdf' });
      }
      if (id !== generation || controller.signal.aborted) return;
      clearTimeout(request.timer);
      if (!blob.size || (await blob.slice(0, 5).text()) !== '%PDF-') throw new Error('Вместо справочника получен некорректный файл.');
      if (id !== generation || controller.signal.aborted) return;
      objectURL = URL.createObjectURL(blob);
      download.href = objectURL;
      var cancelHadFocus = document.activeElement === cancel;
      cancel.hidden = true;
      progress.hidden = true;
      status.textContent = 'Справочник загружен.';
      if (navigator.pdfViewerEnabled === false) {
        detail.textContent = 'Браузер не поддерживает просмотр PDF. Нажмите «Скачать PDF», чтобы открыть файл на устройстве.';
      } else {
        detail.textContent = 'Ниже — просмотр PDF. Если документ не отображается, скачайте его по ссылке выше.';
        var frame = document.createElement('iframe');
        frame.title = 'Официальный справочник Forbidden Stars на русском языке';
        frame.src = objectURL;
        viewer.replaceChildren(frame);
        viewer.hidden = false;
      }
      if (cancelHadFocus) download.focus();
    } catch (error) {
      if (id !== generation) return;
      var cancelHadFocus = document.activeElement === cancel;
      status.setAttribute('role', 'alert');
      status.textContent = request.timedOut ? 'Загрузка остановилась: соединение не отвечает.' : error.message === 'Failed to fetch' || error.name === 'TypeError' ? 'Не удалось загрузить справочник.' : error.message;
      detail.textContent = 'Проверьте подключение и повторите загрузку. Также можно скачать PDF по ссылке выше.';
      progress.hidden = true;
      cancel.hidden = true;
      retry.hidden = false;
      if (cancelHadFocus) retry.focus();
    } finally {
      chunks = [];
      clearTimeout(request.timer);
      if (reader) reader.releaseLock();
      if (id === generation) current = null;
    }
  }

  function stopLoading() {
    if (!current) return;
    generation++;
    clearTimeout(current.timer);
    current.controller.abort();
    current = null;
    status.textContent = 'Загрузка отменена.';
    detail.textContent = 'Можно начать загрузку заново или скачать PDF по ссылке выше.';
    progress.hidden = true;
    cancel.hidden = true;
    retry.hidden = false;
  }
  cancel.addEventListener('click', function () {
    stopLoading();
    retry.focus();
  });
  download.addEventListener('click', function () {
    // The browser owns direct downloads; stop the preview request before handing off.
    stopLoading();
    status.textContent = 'Скачивание передано браузеру.';
    detail.textContent = 'Прогресс доступен в загрузках браузера.';
  });
  retry.addEventListener('click', load);
  window.addEventListener('pagehide', function (event) {
    if (event.persisted) return;
    generation++;
    if (current) { clearTimeout(current.timer); current.controller.abort(); }
    if (objectURL) URL.revokeObjectURL(objectURL);
  });
  load();
})();
