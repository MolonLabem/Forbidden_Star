/* Forbidden Stars — card text compositor.
 *
 * Some expansions ship card art as TEMPLATES with blank title/text areas; the
 * wording lives in text.json. This module draws that text onto the template
 * via canvas — using the game's custom fonts and icon glyphs — and returns a
 * composited image as a data URL.
 *
 * Public API:  window.FSCardRender.compose({ picture, kind, text }) -> Promise<string dataURL>
 *              window.FSCardRender.setResolution(w, h)               -> void  (clears cache)
 *   kind: 'combat' | 'orders' | 'events'
 *   text (combat):  { title, background, foreground, icons }
 *   text (orders):  { title, general }
 *   text (events):  { title, general, type }
 */
(function () {
  'use strict';

  // Canvas size — everything else is derived. Updated via setResolution().
  var maxWidth  = 450;
  var maxHeight = 650;


  var iconMap = {
    'B': 'pictures/bolter.png',
    'S': 'pictures/shield.png',
    'M': 'pictures/moral.png',
  };

  // Combat layout — ratios of canvas size, plus decorative header heights in
  // *source image pixels* (scaled from the loaded PNG width at draw time).
  var COMBAT_LAYOUT = {
    maxTextAreaHeight:       0.4,
    titleX:                  0.27,
    titleY:                  0.077,
    titleFontSizeRatio:      0.05,
    textMarginX:             0.0578,
    marginY:                 0.05,   // of width
    lineSpacing:             0.0077,
    fontSize:                0.03,
    marginShrinkFactor:      0.8,
    fontShrinkFactor:        0.99,
    lineSpacingShrinkFactor: 0.95,
    // Decorative header height in the panel PNGs (background.png / foreground.png).
    backgroundDecoSrcPx:     12,
    foregroundDecoSrcPx:     28,
    iconSizeRatio:           0.097,
    iconSpacingRatio:        0.011,
    iconX:                   0.0632,
    iconStartY:              0.242,
  };

  function replaceForbiddenStarsElements(str) {
    str = String(str || '');
    str = str.replace(/\[B\]/g, '}');
    str = str.replace(/\[S\]/g, '{');
    str = str.replace(/\[M\]/g, '<');
    str = str.replace(/\[D\]/g, '|');
    str = str.replace(/\(B\)/g, '#');
    str = str.replace(/\(S\)/g, '@');
    return str;
  }

  // Scale a source-pixel length on a panel image to the current canvas width.
  function srcPxToCanvas(image, srcPx, canvasWidth) {
    if (!image || !image.width) return 0;
    return srcPx * (canvasWidth / image.width);
  }

  // Fixed decorative top + stretched parchment body. Panel placement depends only
  // on measured height (no independent foreground offset hacks).
  function drawStretchPanel(ctx, image, y, height, decoSrcPx) {
    if (height <= 0) return;
    var cw = ctx.canvas.width;
    var topH = Math.min(height, srcPxToCanvas(image, decoSrcPx, cw));
    var srcTopH = Math.min(image.height, decoSrcPx);
    ctx.drawImage(image, 0, 0, image.width, srcTopH, 0, y, cw, topH);
    var parchH = height - topH;
    if (parchH > 0 && srcTopH < image.height) {
      ctx.drawImage(image, 0, srcTopH, image.width, image.height - srcTopH, 0, y + topH, cw, parchH);
    }
  }

  // Shared layout for styled wrapped text. Returns the ink-box height from the
  // top of the text box (matches what draw paints).
  //   • text before a colon on the same line → italic
  //   • '-или-' token → centred italic line
  //   • *newline* / *newpara* → line / paragraph break
  //   • align: 'left' | 'center'
  //   • paint: when false, only measures (no canvas writes)
  function layoutStyledWrappedText(ctx, text, x, y, maxW, interline, fontSize, align, paint) {
    if (!align) align = 'left';
    if (!text) return 0;
    var family = ctx.fsBodyFont || 'ForbiddenStars';
    var baseFont   = fontSize + 'px ' + family;
    var italicFont = 'italic ' + fontSize + 'px ' + family;
    var PARA = '\u0001';

    var normalizeText = function (s) {
      return String(s)
        .replace(/\s*\*newpara\*\s*/g, '\n' + PARA + '\n')
        .replace(/\s*\*newline\*\s*/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .trim();
    };

    var paragraphs = normalizeText(text).split('\n');
    if (!paragraphs.length || (paragraphs.length === 1 && !paragraphs[0])) return 0;

    var buildTokens = function (p) {
      if (!p.trim() || p === PARA) return [];
      if (p.trim() === '-или-') return [{ text: '-или-', italic: true, glue: true }];
      var ci = p.indexOf(':');
      if (ci !== -1) {
        var before = p.slice(0, ci).replace(/\s+$/, '');
        var after  = p.slice(ci + 1).replace(/^\s+/, '');
        var toks = [];
        if (before) toks.push({ text: before, italic: true,  glue: true });
        toks.push(             { text: ':',    italic: false, glue: true });
        if (after)  toks.push({ text: ' ' + after, italic: false, glue: true });
        return toks;
      }
      return [{ text: p, italic: false, glue: true }];
    };

    var measure = function (txt, italic) {
      ctx.font = italic ? italicFont : baseFont;
      return ctx.measureText(txt).width;
    };

    var renderLine = function (segments, yy) {
      if (!paint) return;
      ctx.fsMinimumBodyPx = Math.min(ctx.fsMinimumBodyPx || Infinity, fontSize);
      var totalW = 0;
      for (var s = 0; s < segments.length; s++) totalW += measure(segments[s].text, segments[s].italic);
      if (ctx.fsStrict && (totalW > maxW + 1 || yy + fontSize * 0.2 > ctx.canvas.height)) {
        throw new Error('Текст выходит за границы печатной карты');
      }
      var cx = (align === 'center') ? (x - totalW / 2) : x;
      for (var s = 0; s < segments.length; s++) {
        var seg = segments[s];
        ctx.font = seg.italic ? italicFont : baseFont;
        ctx.textAlign = 'left';
        ctx.fillText(seg.text, cx, yy);
        cx += measure(seg.text, seg.italic);
      }
    };

    ctx.font = baseFont;
    var lineHeight = fontSize;
    var yy = y + lineHeight;
    var lastBaseline = yy;
    var drew = false;

    for (var pi = 0; pi < paragraphs.length; pi++) {
      var p = paragraphs[pi];
      if (p === PARA) {
        // Paragraph break: next baseline is 2*lineHeight below the previous one.
        yy = lastBaseline + 2 * lineHeight;
        continue;
      }
      if (p === '') continue;
      var tokens = buildTokens(p);
      var line = [];
      var lineWidth = 0;

      var pushWord = function (word, italic, glue) {
        var segText = (line.length === 0 || glue) ? word : (' ' + word);
        var w = measure(segText, italic);
        if (lineWidth + w > maxW && line.length > 0) {
          renderLine(line, yy);
          lastBaseline = yy;
          yy += lineHeight + interline;
          drew = true;
          line = [{ text: word, italic: italic }];
          lineWidth = measure(word, italic);
        } else {
          line.push({ text: segText, italic: italic });
          lineWidth += w;
        }
      };

      for (var ti = 0; ti < tokens.length; ti++) {
        var t = tokens[ti];
        if (t.text === ':') { pushWord(':', false, true); continue; }
        var words = t.text.split(' ');
        for (var wi = 0; wi < words.length; wi++) {
          if (!words[wi]) continue;
          pushWord(words[wi], t.italic, line.length === 0 || (t.glue && wi === 0));
        }
      }
      if (line.length) {
        renderLine(line, yy);
        lastBaseline = yy;
        yy += lineHeight + interline;
        drew = true;
      }
    }

    if (!drew) return 0;
    // Ink box ends at the last baseline (first baseline was y+lineHeight).
    return lastBaseline - y;
  }

  function measureStyledWrappedText(ctx, text, maxW, interline, fontSize) {
    return layoutStyledWrappedText(ctx, text, 0, 0, maxW, interline, fontSize, 'left', false);
  }

  function drawStyledWrappedText(ctx, text, x, y, maxW, interline, fontSize, align) {
    return layoutStyledWrappedText(ctx, text, x, y, maxW, interline, fontSize, align, true);
  }

  // image cache — shared chrome loads once per session
  var _imgCache = window.FSCache.create(24);
  function loadImage(url) {
    var cached = _imgCache.get(url);
    if (cached) return cached;
    var pending = new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload  = function () { resolve(img); };
      img.onerror = function () { reject(new Error('Failed to load image ' + url)); };
      img.src = url;
    }).catch(function (error) {
      _imgCache.delete(url);
      throw error;
    });
    return _imgCache.set(url, pending);
  }

  // ---- card draw functions ----

  async function drawCombatCard(data, ctx) {
    var cw = ctx.canvas.width, ch = ctx.canvas.height;
    var textMarginX = cw * COMBAT_LAYOUT.textMarginX;
    var textWidth   = cw - textMarginX * 2;
    var maxTextH    = ch * COMBAT_LAYOUT.maxTextAreaHeight;
    var iconSz      = cw * COMBAT_LAYOUT.iconSizeRatio;
    var iconSp      = cw * COMBAT_LAYOUT.iconSpacingRatio;
    var iconXPos    = cw * COMBAT_LAYOUT.iconX;
    var iconStartYPos = ch * COMBAT_LAYOUT.iconStartY;

    var bgText = data.hasText ? replaceForbiddenStarsElements(data.background || '') : '';
    var fgText = data.hasText ? replaceForbiddenStarsElements(data.foreground || '') : '';

    var iconChars = String(data.icons || '').split('').map(function (c) { return iconMap[c.toUpperCase()]; }).filter(Boolean);
    var resources = await Promise.all([
      loadImage(data.picture),
      loadImage('pictures/background.png'),
      loadImage('pictures/foreground.png'),
      loadImage('pictures/bottom.png'),
    ].concat(iconChars.map(loadImage)));

    var picture      = resources[0];
    var backgroundImg = resources[1];
    var foregroundImg = resources[2];
    var bottomImg    = resources[3];
    var iconImgs     = resources.slice(4);

    // Chrome sizes derived from the loaded assets (no fixed 880px reference).
    var bgDecoH  = srcPxToCanvas(backgroundImg, COMBAT_LAYOUT.backgroundDecoSrcPx, cw);
    var fgDecoH  = srcPxToCanvas(foregroundImg, COMBAT_LAYOUT.foregroundDecoSrcPx, cw);
    var bottomH  = srcPxToCanvas(bottomImg, bottomImg.height, cw);

    ctx.drawImage(picture, 0, 0, cw, ch);

    ctx.font = (ch * COMBAT_LAYOUT.titleFontSizeRatio) + 'px Headline';
    if (ctx.fsStrict) {
      var titleSize = ch * COMBAT_LAYOUT.titleFontSizeRatio;
      while (ctx.measureText(data.title || '').width > cw * 0.69) {
        titleSize *= 0.95; ctx.font = titleSize + 'px Headline';
      }
    }
    ctx.textAlign = 'left';
    ctx.fillText(data.title || '', cw * COMBAT_LAYOUT.titleX, ch * COMBAT_LAYOUT.titleY);

    if (bgText || fgText) {
      var fontSize  = ch * COMBAT_LAYOUT.fontSize;
      var interline = ch * COMBAT_LAYOUT.lineSpacing;
      var marginH   = cw * COMBAT_LAYOUT.marginY;

      // Panel = decorative header + margins + measured text (+ bottom strip on the
      // bottom-most panel). Text is vertically centred in the parchment area.
      var panelHeight = function (contentH, decoH, clearBottom) {
        return decoH + marginH + contentH + marginH + (clearBottom ? bottomH : 0);
      };

      var measurePanels = function () {
        var bgContent = bgText ? measureStyledWrappedText(ctx, bgText, textWidth, interline, fontSize) : 0;
        var fgContent = fgText ? measureStyledWrappedText(ctx, fgText, textWidth, interline, fontSize) : 0;
        return {
          bgContent: bgContent,
          fgContent: fgContent,
          bg: bgText ? panelHeight(bgContent, bgDecoH, !fgText) : 0,
          fg: fgText ? panelHeight(fgContent, fgDecoH, true)    : 0,
        };
      };

      var p = measurePanels();
      var guard = 0;
      var overBudget = function () {
        if (bgText && fgText) return (p.bg + p.fg) > maxTextH;
        return Math.max(p.bg, p.fg) > maxTextH;
      };
      while (overBudget() && guard < 80) {
        marginH   *= COMBAT_LAYOUT.marginShrinkFactor;
        fontSize  *= COMBAT_LAYOUT.fontShrinkFactor;
        interline *= COMBAT_LAYOUT.lineSpacingShrinkFactor;
        p = measurePanels();
        guard++;
      }
      if (ctx.fsStrict && overBudget()) throw new Error('Боевой текст не помещается на карте');

      var fgPanel = fgText ? {
        y: ch - p.fg, h: p.fg, decoH: fgDecoH, contentH: p.fgContent, bottomClear: bottomH,
      } : null;
      var bgPanel = bgText ? {
        y: ch - p.bg - (fgPanel ? p.fg : 0),
        drawH: p.bg + (fgPanel ? p.fg : 0),
        h: p.bg, decoH: bgDecoH, contentH: p.bgContent,
        bottomClear: fgPanel ? 0 : bottomH,
      } : null;

      if (bgPanel) drawStretchPanel(ctx, backgroundImg, bgPanel.y, bgPanel.drawH, COMBAT_LAYOUT.backgroundDecoSrcPx);
      if (fgPanel) drawStretchPanel(ctx, foregroundImg, fgPanel.y, fgPanel.h,     COMBAT_LAYOUT.foregroundDecoSrcPx);

      var textY = function (panel) {
        var innerTop = panel.y + panel.decoH;
        var innerH   = panel.h - panel.decoH - panel.bottomClear;
        return innerTop + Math.max(0, (innerH - panel.contentH) / 2);
      };

      if (bgPanel) drawStyledWrappedText(ctx, bgText, textMarginX, textY(bgPanel), textWidth, interline, fontSize, 'left');
      if (fgPanel) drawStyledWrappedText(ctx, fgText, textMarginX, textY(fgPanel), textWidth, interline, fontSize, 'left');
    }

    var iy = iconStartYPos;
    for (var i = 0; i < iconImgs.length; i++) {
      ctx.drawImage(iconImgs[i], iconXPos, iy, iconSz, iconSz);
      iy += iconSz + iconSp;
    }

    ctx.drawImage(bottomImg, 0, 0, bottomImg.width, bottomImg.height, 0, ch - bottomH, cw, bottomH);
  }

  async function drawOrderCard(data, ctx) {
    var cw = ctx.canvas.width, ch = ctx.canvas.height;
    // Match English order layout exactly:
    //   textPosition = 0.54, maxFieldsHeight = 0.455, margin = 0.1*height
    // English calculateTextHeight pads with lineHeight*2 + 2*margin before the
    // shrink check — that over-budget is what keeps "LIMIT ONCE PER ROUND"
    // clear of the parchment frame.
    var maxFieldsH = ch * 0.455;
    var textPosY   = ch * 0.54;
    var marginW    = ch * 0.1;
    var interline  = ch * 0.0077;
    var fontSize   = ch * 0.03;
    var titleMaxW  = cw * 0.48;
    var titleY     = ch * 0.2325;
    var textMaxW   = cw - 2 * marginW;

    var picture = await loadImage(data.picture);
    var general = data.hasText ? replaceForbiddenStarsElements(data.general || '') : '';
    var title = data.title || '';

    if (general) {
      var textH = measureStyledWrappedText(ctx, general, textMaxW, interline, fontSize);
      var guard = 0;
      // English: returnHeight += lineHeight*2 + 2*margin  (extra=0).
      // Our ink box already includes one lineHeight → pad with +fontSize + 2*margin.
      while (textH + fontSize + marginW * 2 > maxFieldsH && guard < 80) {
        fontSize  *= 0.95;
        interline *= 0.97;
        textH = measureStyledWrappedText(ctx, general, textMaxW, interline, fontSize);
        guard++;
      }
      if (ctx.fsStrict && textH + fontSize + marginW * 2 > maxFieldsH) throw new Error('Текст приказа не помещается на карте');
    }

    ctx.drawImage(picture, 0, 0, cw, ch);
    drawOrderTitle(ctx, title, cw * 0.5, titleY, titleMaxW, ch * 0.05, ch * 0.022);

    if (general) {
      drawStyledWrappedText(ctx, general, cw * 0.5, textPosY, textMaxW, interline, fontSize, 'center');
    }
  }

  // Fit order-card titles into the banner: shrink, then wrap to 2 lines if needed.
  function drawOrderTitle(ctx, title, x, y, maxW, startSize, minSize) {
    if (!title) return;
    var tfSize = startSize;
    ctx.textAlign = 'center';

    while (tfSize > minSize) {
      ctx.font = tfSize + 'px Headline';
      if (ctx.measureText(title).width <= maxW) {
        ctx.fillText(title, x, y);
        return;
      }
      tfSize *= 0.92;
    }

    ctx.font = tfSize + 'px Headline';
    var words = title.trim().split(/\s+/);
    if (words.length < 2) {
      while (ctx.measureText(title).width > maxW && tfSize > minSize * 0.75) {
        tfSize *= 0.9;
        ctx.font = tfSize + 'px Headline';
      }
      ctx.fillText(title, x, y);
      return;
    }

    var best = null, bestScore = Infinity;
    for (var i = 1; i < words.length; i++) {
      var a = words.slice(0, i).join(' ');
      var b = words.slice(i).join(' ');
      var wa = ctx.measureText(a).width, wb = ctx.measureText(b).width;
      if (wa <= maxW && wb <= maxW) {
        var score = Math.abs(wa - wb) + Math.max(wa, wb);
        if (score < bestScore) { bestScore = score; best = [a, b]; }
      }
    }

    if (best) {
      var lineH = tfSize * 1.08;
      ctx.fillText(best[0], x, y - lineH * 0.42);
      ctx.fillText(best[1], x, y + lineH * 0.58);
      return;
    }

    while (ctx.measureText(title).width > maxW && tfSize > minSize * 0.7) {
      tfSize *= 0.9;
      ctx.font = tfSize + 'px Headline';
    }
    ctx.fillText(title, x, y);
  }

  async function drawEventCard(data, ctx) {
    var cw = ctx.canvas.width, ch = ctx.canvas.height;
    // English-style top anchor just below the type bar / parchment emblem.
    var textPosY   = ch * 0.685;
    var maxFieldsH = ch * 0.25;
    var mw         = cw * 0.0578;
    var interline  = ch * 0.0077;
    var fontSize   = ch * 0.03;
    var tfSize     = ch * 0.05;
    var textMaxW   = cw - 2 * mw;

    var picture = await loadImage(data.picture);
    var general = data.hasText ? replaceForbiddenStarsElements(data.general || '') : '';

    var textH = 0;
    if (general) {
      textH = measureStyledWrappedText(ctx, general, textMaxW, interline, fontSize);
      var guard = 0;
      while (textH > maxFieldsH && guard < 80) {
        fontSize  *= 0.95;
        interline *= 0.97;
        textH = measureStyledWrappedText(ctx, general, textMaxW, interline, fontSize);
        guard++;
      }
      if (ctx.fsStrict && textH > maxFieldsH) throw new Error('Текст события не помещается на карте');
    }

    ctx.drawImage(picture, 0, 0, cw, ch);
    ctx.font = 'bold ' + (tfSize * 0.8) + 'px EventFont';
    ctx.textAlign = 'center';
    ctx.fillText(data.type || '', cw * 0.5, ch * 0.573);
    ctx.font = tfSize + 'px Headline';
    ctx.textAlign = 'left';
    if (ctx.fsStrict) {
      var eventTitleSize = tfSize;
      while (ctx.measureText(data.title || '').width > cw * 0.9) {
        eventTitleSize *= 0.95; ctx.font = eventTitleSize + 'px Headline';
      }
    }
    ctx.fillText(data.title || '', cw * 0.05, ch * 0.0735);

    if (general) {
      drawStyledWrappedText(ctx, general, mw, textPosY, textMaxW, interline, fontSize, 'left');
    }
  }

  // Baked English TDL sources remain intact. Cover their wording before drawing
  // Russian text; merely adding JSON must never leave two languages superposed.
  // The same wrapping/font measurement is used by templates and these regions.
  function drawTextRegion(ctx, region, wording) {
    var cw = ctx.canvas.width, ch = ctx.canvas.height, b = region.box;
    var w = b[2] * cw, h = b[3] * ch;
    ctx.save();
    ctx.translate((b[0] + b[2] / 2) * cw, (b[1] + b[3] / 2) * ch);
    ctx.rotate((region.rotation || 0) * Math.PI / 180);
    ctx.fillStyle = region.fill || '#e9dfb6';
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.fillStyle = region.ink || '#15120c';
    ctx.fsBodyFont = region.font || 'ForbiddenStars';
    var text = replaceForbiddenStarsElements(window.FSWord.format(region.value, wording));
    var size = ch * (region.size || 0.03), margin = Math.min(w, h) * 0.06;
    var maxW = w - margin * 2, maxH = h - margin * 2;
    var interline = size * 0.12;
    var height = measureStyledWrappedText(ctx, text, maxW, interline, size);
    var widestWord = function () {
      ctx.font = 'italic ' + size + 'px ' + ctx.fsBodyFont;
      return Math.max.apply(Math, String(text).split(/\s+/).map(function (word) { return ctx.measureText(word).width; }));
    };
    var guard = 0;
    while ((height > maxH || widestWord() > maxW) && guard++ < 180) {
      size *= 0.97; interline = size * 0.12;
      height = measureStyledWrappedText(ctx, text, maxW, interline, size);
    }
    if (height > maxH) throw new Error('Перевод не помещается в текстовую область');
    drawStyledWrappedText(ctx, text, region.align === 'center' ? 0 : -w / 2 + margin,
      -h / 2 + margin, maxW, interline, size, region.align || 'left');
    ctx.fsBodyFont = null;
    ctx.restore();
  }

  async function drawRasterTranslation(data, ctx) {
    var picture = await loadImage(data.picture);
    ctx.drawImage(picture, 0, 0, ctx.canvas.width, ctx.canvas.height);
    var regions = data.regions;
    if (!regions) {
      var combat = data.kind === 'combat', order = data.kind === 'orders';
      regions = [
        { box: combat ? [.28,.075,.57,.063] : order ? [.26,.205,.53,.052] : [.075,.052,.65,.046],
          value: data.title, font: 'Headline', size: .044, align: order ? 'center' : 'left', fill: order ? '#fff9d9' : '#e9dfb6' },
        { box: combat ? [0,.60,1,.36] : order ? [.155,.54,.69,.275] : [.08,.673,.84,.231],
          value: combat ? [data.background, data.foreground].filter(Boolean).join(' *newpara* ') : data.general,
          size: .03, fill: '#eee5bc' },
      ];
      if (data.kind === 'events') regions.push({box:[.17,.525,.66,.047],value:data.type,font:'EventFont',size:.035,align:'center',fill:'#e9dfb6'});
    }
    regions.forEach(function (region) { drawTextRegion(ctx, region, data.wording); });
  }

  var DRAW = { combat: drawCombatCard, orders: drawOrderCard, events: drawEventCard, overlay: drawRasterTranslation };

  // Ensure the custom fonts are loaded before measuring/drawing text.
  var _fontsReady;
  function fontsReady() {
    if (_fontsReady) return _fontsReady;
    if (!document.fonts) { _fontsReady = Promise.resolve(); return _fontsReady; }
    _fontsReady = Promise.all([
      document.fonts.load('1em ForbiddenStars'),
      document.fonts.load('1em Headline'),
      document.fonts.load('1em EventFont'),
    ]).catch(function () {});
    return _fontsReady;
  }

  var _composed = window.FSCache.create(32);

  function compose(card, options) {
    options = options || {};
    // Capture dimensions before asynchronous work. Printing never changes view resolution.
    var width = options.width || card.width || maxWidth, height = options.height || card.height || maxHeight;
    if (card.kind === 'overlay' && card.text && card.text.aspect) height = Math.round(width / card.text.aspect);
    var strict = !!options.strict;
    var wording = card.wording || 'explicit';
    var thumbnail = !strict && !!card.thumbnail;
    var picture = strict ? card.src : (card.picture || card.src);
    var key = JSON.stringify([card.src, picture, width, height, wording, thumbnail, card.text]);
    var cached = !strict && _composed.get(key);
    if (cached) return cached;
    var fn = card.text && card.text.raster ? drawRasterTranslation : DRAW[card.kind];
    if (strict && (!fn || !card.text || !card.text.title)) return Promise.reject(new Error('Нет русского текста: ' + card.src));
    if (!fn || !card.text) return Promise.resolve(card.src);

    var ready = strict ? Promise.all(['ForbiddenStars', 'Headline', 'EventFont'].map(function (name) {
      if (!document.fonts) throw new Error('Браузер не поддерживает проверку шрифтов');
      return document.fonts.load('16px ' + name).then(function (faces) {
        if (!faces.length || !document.fonts.check('16px ' + name)) throw new Error('Не загружен шрифт ' + name);
      });
    })) : fontsReady();
    var result = ready.then(function () {
      var canvas = document.createElement('canvas');
      canvas.width  = width;
      canvas.height = height;
      var ctx = canvas.getContext('2d');
      ctx.fsStrict = strict;
      var format = function (text) { return window.FSWord.format(text, wording); };
      var data = {
        picture:    picture,
        hasText:    true,
        title:      card.text.title      || '',
        general:    format(card.text.general),
        background: format(card.text.background),
        foreground: format(card.text.foreground),
        icons:      card.text.icons      || '',
        type:       card.text.type       || '',
        kind:       card.kind,
        regions:    card.text.regions,
        wording:    wording,
      };
      return fn(data, ctx).then(function () {
        if (options.onMetrics) options.onMetrics({minimumBodyPx: ctx.fsMinimumBodyPx});
        return thumbnail ? canvas.toDataURL('image/jpeg', 0.84) : canvas.toDataURL('image/png');
      });
    }).catch(function (e) {
      _composed.delete(key);
      if (strict) throw e;
      console.error('compose failed for ' + card.src, e);
      return card.src;
    });
    // Large print rasters have a job lifetime; do not retain them in the view cache.
    if (!strict) return _composed.set(key, result);
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { reject(new Error('Рендер не завершён: ' + card.src)); }, 20000);
      result.then(function (value) { clearTimeout(timer); resolve(value); }, function (error) { clearTimeout(timer); reject(error); });
    });
  }

  // Change canvas dimensions and clear the composition cache so all cards are
  // redrawn at the new size on the next compose() call.
  function setResolution(w, h) {
    maxWidth  = w;
    maxHeight = h;
    _composed.clear();
  }

  window.FSCardRender = { compose: compose, fontsReady: fontsReady, setResolution: setResolution };
})();
