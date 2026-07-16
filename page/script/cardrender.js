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

  var marginWidth  = maxWidth  * 0.0578;
  var maxTextWidth = maxWidth  - 2 * marginWidth;

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
    var baseFont   = fontSize + 'px ForbiddenStars';
    var italicFont = 'italic ' + fontSize + 'px ForbiddenStars';
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
      var totalW = 0;
      for (var s = 0; s < segments.length; s++) totalW += measure(segments[s].text, segments[s].italic);
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
  var _imgCache = {};
  function loadImage(url) {
    if (_imgCache[url]) return _imgCache[url];
    _imgCache[url] = new Promise(function (resolve, reject) {
      var img = new Image();
      img.src = url;
      img.onload  = function () { resolve(img); };
      img.onerror = function () { reject(new Error('Failed to load image ' + url)); };
    });
    return _imgCache[url];
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
    }

    ctx.drawImage(picture, 0, 0, cw, ch);
    ctx.font = 'bold ' + (tfSize * 0.8) + 'px EventFont';
    ctx.textAlign = 'center';
    ctx.fillText(data.type || '', cw * 0.5, ch * 0.573);
    ctx.font = tfSize + 'px Headline';
    ctx.textAlign = 'left';
    ctx.fillText(data.title || '', cw * 0.05, ch * 0.0735);

    if (general) {
      drawStyledWrappedText(ctx, general, mw, textPosY, textMaxW, interline, fontSize, 'left');
    }
  }

  var DRAW = { combat: drawCombatCard, orders: drawOrderCard, events: drawEventCard };

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

  var _composed = {};

  function compose(card) {
    var key = card.src + '@' + maxWidth + 'x' + maxHeight;
    if (_composed[key]) return _composed[key];
    var fn = DRAW[card.kind];
    if (!fn || !card.text) { _composed[key] = Promise.resolve(card.src); return _composed[key]; }

    _composed[key] = fontsReady().then(function () {
      var canvas = document.createElement('canvas');
      canvas.width  = maxWidth;
      canvas.height = maxHeight;
      var ctx = canvas.getContext('2d');
      var data = {
        picture:    card.src,
        hasText:    true,
        title:      card.text.title      || '',
        general:    card.text.general    || '',
        background: card.text.background || '',
        foreground: card.text.foreground || '',
        icons:      card.text.icons      || '',
        type:       card.text.type       || '',
      };
      return fn(data, ctx).then(function () { return canvas.toDataURL('image/png'); });
    }).catch(function (e) {
      console.error('compose failed for ' + card.src, e);
      return card.src;
    });
    return _composed[key];
  }

  // Change canvas dimensions and clear the composition cache so all cards are
  // redrawn at the new size on the next compose() call.
  function setResolution(w, h) {
    maxWidth  = w;
    maxHeight = h;
    marginWidth  = maxWidth  * 0.0578;
    maxTextWidth = maxWidth  - 2 * marginWidth;
    _composed = {};
  }

  window.FSCardRender = { compose: compose, fontsReady: fontsReady, setResolution: setResolution };
})();
