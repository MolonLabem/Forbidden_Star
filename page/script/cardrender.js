/* Forbidden Stars — card text compositor.
 *
 * Some expansions ship card art as TEMPLATES with blank title/text areas; the
 * wording lives in each faction's text.json. This module draws that text onto the template
 * via canvas — using the game's custom fonts and icon glyphs — and returns a
 * composited image as a data URL.
 *
 * Public API:  window.FSCardRender.compose({ src, kind, text, template? }, { width?, height?, strict? }) -> Promise<string dataURL>
 *              window.FSCardRender.setResolution(w, h)               -> void  (clears cache)
 *              window.FSCardRender.sourceInfo(card)                 -> native source/crop dimensions
 *   kind: 'combat' | 'orders' | 'events' | 'overlay' | 'sheet'
 *   text (combat):  { title, background, foreground, icons }
 *   text (orders):  { title, general }
 *   text (events):  { title, general, type }
 *   Optional template: { picture?, artwork?:{src,box:[x,y,w,h],sha256}, patches:[{role?,box:[x,y,w,h],texture:{src,crop:[x,y,w,h]}}] }
 *   Combat pictures contain the frame, native badges and illustration, with
 *   blank title, combat-symbol rail and effect areas, just like SoW templates.
 *   Patch coordinates are fractions of native images/canvas; artwork.box uses
 *   pixels of the original template. Its lossless alpha protects the frame.
 *   Offline/legacy patches describe artwork erasure only. Shared frame fields and explicit printed
 *   regions determine placement; measured text determines wrapping. Without an explicit
 *   output height, composition retains the source image's native proportions.
 *   Sheet text adds crop?, side, sheet:{title,subtitle,abilities}, regions?.
 *   Crops and regions describe native artwork; typography is measured here.
 */
(function () {
  'use strict';

  // Output pixels control sharpness only. Typography uses one logical width;
  // its height follows the source aspect, even when print dimensions are given.
  var layoutWidth = 450;
  var maxWidth  = 450;
  var maxHeight = 650;

  function canvasSize(ctx) { return ctx.fsLayout || ctx.canvas; }


  var iconMap = {
    'B': 'pictures/bolter.png',
    'S': 'pictures/shield.png',
    'M': 'pictures/moral.png',
  };

  // These are the empty fields in the artwork, not card-specific text sizes.
  // Erasure recipes may supply a smaller field; all wording is measured to fit.
  var FIELDS = {
    combat: {title:[.27,.025,.64,.065]},
    orders: {title:[.26,.18,.48,.067],body:[.145,.54,.71,.275]},
    // The event frame reserves space for its hanging emblem and paper edges.
    // Keep this content contract shared, independent of wording and image pixels.
    events: {title:[.05,.025,.7,.065],body:[.065,.68,.87,.245],type:[.1,.533,.8,.055]},
    raster: {
      combat: {title:[.29,.08,.56,.05]},
      orders: {title:[.26,.205,.53,.052],body:[.155,.54,.69,.275]},
      events: {title:[.075,.057,.65,.041],body:[.08,.673,.84,.231],type:[.17,.525,.66,.047]},
    },
  };
  var FONT = {title:'Headline',type:'EventFont',body:'ForbiddenStars'};
  var LABEL_LAYOUT = {paddingX:.02,paddingY:.05,inkPaddingY:.08,typeFaceHeight:.88,nativeInsetX:.04};
  var RULES_LAYOUT = {fontSize:.03,lineSpacing:.18,minimumSpacing:.12,paragraphGap:.45,insetX:.01,insetY:.004};
  var SHEET_SIZE = Object.freeze({width:1280,height:770});
  var ORDER_LIMIT = {scale:.8,gap:.1,fontRatio:.023,gapRatio:.016,bottom:.813,lineGap:.008};

  function recordInk(ctx, text, x, y, role, align, strokeWidth) {
    if(!ctx.fsStrict && !ctx.fsCollectMetrics)return;
    var ink=ctx.measureText(text),matrix=ctx.getTransform();
    var pad=(strokeWidth||0)/2;
    var corners=[[x-ink.actualBoundingBoxLeft-pad,y-ink.actualBoundingBoxAscent-pad],
      [x+ink.actualBoundingBoxRight+pad,y-ink.actualBoundingBoxAscent-pad],
      [x-ink.actualBoundingBoxLeft-pad,y+ink.actualBoundingBoxDescent+pad],
      [x+ink.actualBoundingBoxRight+pad,y+ink.actualBoundingBoxDescent+pad]].map(function(p){return matrix.transformPoint({x:p[0],y:p[1]});});
    var box={left:Math.min.apply(Math,corners.map(function(p){return p.x;})),right:Math.max.apply(Math,corners.map(function(p){return p.x;})),
      top:Math.min.apply(Math,corners.map(function(p){return p.y;})),bottom:Math.max.apply(Math,corners.map(function(p){return p.y;}))};
    if(ctx.fsStrict && (box.left < -1 || box.top < -1 || box.right > ctx.canvas.width+1 || box.bottom > ctx.canvas.height+1)) throw new Error('Текст выходит за границы карты: '+text);
    ctx.fsTextLines.push({text:text,font:ctx.font,role:role||'body',align:align||'left',box:box});
    return box;
  }

  // Combat layout — ratios of canvas size, plus decorative header heights in
  // *source image pixels* (scaled from the loaded PNG width at draw time).
  var COMBAT_LAYOUT = {
    maxTextAreaHeight:       0.4,
    readingArea:             {marginX:0.0578,marginY:0.05,lineSpacing:0.0077},
    textMarginX:             0.05,
    marginY:                 0.032,  // of width; keep the original-sized type
    lineSpacing:             0.006,
    fontSize:                0.03,
    marginShrinkFactor:      0.8,
    fontShrinkFactor:        0.99,
    lineSpacingShrinkFactor: 0.95,
    // Decorative header height in the panel PNGs (background.png / foreground.png).
    backgroundDecoSrcPx:     12,
    foregroundDecoSrcPx:     28,
    iconSizeRatio:           0.097,
    iconSpacingRatio:        0.011,
    iconX:                   0.0552,
    iconStartY:              0.242,
  };

  // Scale a source-pixel length on a panel image to the current canvas width.
  function srcPxToCanvas(image, srcPx, canvasWidth) {
    if (!image || !image.width) return 0;
    return srcPx * (canvasWidth / image.width);
  }

  // Keep the native border and its soft shadow at the card's scale. Stretch
  // only the quieter paper below it, so compact panels still have depth.
  function drawStretchPanel(ctx, image, y, height, decoSrcPx) {
    if (height <= 0) return;
    var cw = canvasSize(ctx).width;
    var scale=cw/image.width;
    var topH = Math.min(height, srcPxToCanvas(image, decoSrcPx+image.width*.12, cw));
    var srcTopH = Math.min(image.height, topH/scale);
    ctx.drawImage(image, 0, 0, image.width, srcTopH, 0, y, cw, topH);
    var parchH = height - topH;
    if (parchH > 0 && srcTopH < image.height) {
      ctx.drawImage(image, 0, srcTopH, image.width, image.height - srcTopH, 0, y + topH, cw, parchH);
    }
  }

  // Shared layout for styled wrapped text. Returns the ink-box height from the
  // top of the text box (matches what draw paints).
  //   • ability names before a colon → bold; combat unit prefixes → italic
  //   • '-или-' token → centred italic line
  //   • *newline* / *newpara* → line / paragraph break
  //   • align: 'left' | 'center'
  //   • paint: when false, only measures (no canvas writes)
  function layoutStyledWrappedText(ctx, text, x, y, maxW, interline, fontSize, align, paint) {
    if (!align) align = 'left';
    if (!text) return 0;
    var family = ctx.fsBodyFont || FONT.body;
    var lineFontSize=fontSize;
    var baseFont = (ctx.fsBodyWeight ? ctx.fsBodyWeight+' ' : '') + fontSize + 'px ' + family;
    var styledFont = function (style) { return style ? style+' '+lineFontSize+'px '+family : baseFont; };
    var fontRuns = function (text, style) {
      if(!ctx.fsSheetProse)return [{text:text,font:styledFont(style)}];
      // Sheet prose can use another typeface; its symbols use the merged font.
      var symbols=/([\uE100-\uE102\uE200-\uE205])/;
      return text.split(symbols).filter(Boolean).map(function (part) {
        var symbol=part.length===1 && symbols.test(part);
        var index=part.charCodeAt(0)-0xE200;
        return {text:index>=0&&index<window.FSWord.symbols.length?window.FSWord.symbols[index].glyph:part,
          font:symbol?lineFontSize+'px '+FONT.body:styledFont(style)};
      });
    };
    var PARA = '\u0001';

    var normalizeText = function (s) {
      return String(s)
        .replace(/\s*\*newpara\*\s*/g, '\n' + PARA + '\n')
        .replace(/\s*\*newline\*\s*/g, '\n')
        .replace(/(\d[\d.,]*)[ \t]+(?=[}{<|#@\uE100-\uE102\uE200-\uE205])/g, '$1\u00a0')
        .replace(/[ \t]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .trim();
    };

    var paragraphs = normalizeText(text).split('\n');
    if (!paragraphs.length || (paragraphs.length === 1 && !paragraphs[0])) return 0;

    var buildTokens = function (p) {
      if (!p.trim() || p === PARA) return [];
      if (p.trim() === '-или-') return [{ text: '-или-', style:'italic' }];
      var ci = p.indexOf(':');
      var prefixStyle=ctx.fsPrefixStyle || (ctx.fsItalicPrefixes === true ? 'italic' : null);
      if(prefixStyle==='bold' || ctx.fsPrefixTitles?.length) {
        // Ability titles are structured data. A colon inside a description or
        // a later paragraph must not turn ordinary rules text into a heading.
        var title=(ctx.fsPrefixTitles||[]).find(function(title){return p.startsWith(title+':');});
        ci=title===undefined?-1:title.length;
      }
      if (ci !== -1 && prefixStyle) {
        var before = p.slice(0, ci).replace(/\s+$/, '');
        var after  = p.slice(ci + 1).replace(/^\s+/, '');
        var toks = [];
        if (before) toks.push({ text: before, style:prefixStyle });
        toks.push({ text: ':', style:prefixStyle==='bold'?'bold':null });
        if (after) toks.push({ text: ' ' + after });
        return toks;
      }
      return [{ text:p }];
    };

    var measure = function (txt, style) {
      return fontRuns(txt,style).reduce(function (width,run) {ctx.font=run.font;return width+ctx.measureText(run.text).width;},0);
    };

    var lineAlign=align,lineRole=ctx.fsTextRole||'body',lastInkBottom=y;
    var renderLine = function (segments, yy) {
      var totalW = 0,descent=0;
      for (var s = 0; s < segments.length; s++)fontRuns(segments[s].text,segments[s].style).forEach(function(run){
        ctx.font=run.font;var ink=ctx.measureText(run.text);
        totalW+=ink.width;descent=Math.max(descent,ink.actualBoundingBoxDescent+printedStrokeWidth(ctx,run.text)/2);
      });
      lastInkBottom=yy+descent;
      ctx.fsMeasuredWidth=Math.max(ctx.fsMeasuredWidth||0,totalW);
      if (!paint) return;
      ctx.fsMinimumBodyPx = Math.min(ctx.fsMinimumBodyPx || Infinity, lineFontSize);
      if (ctx.fsStrict && (totalW > maxW + 1 || yy + lineFontSize * 0.2 > canvasSize(ctx).height)) {
        throw new Error('Текст выходит за границы печатной карты');
      }
      var left=align==='center'?x-maxW/2:align==='right'?x-maxW:x;
      var cx = lineAlign==='center' ? left+(maxW-totalW)/2 : lineAlign==='right'?left+maxW-totalW:left;
      for (var s = 0; s < segments.length; s++) {
        var seg = segments[s];
        fontRuns(seg.text,seg.style).forEach(function (run) {
          ctx.font=run.font;ctx.textAlign='left';
          recordInk(ctx,run.text,cx,yy,lineRole,lineAlign,printedStrokeWidth(ctx,run.text));
          drawTokenText(ctx,run.text,cx,yy,lineFontSize);
          cx+=ctx.measureText(run.text).width;
        });
      }
    };

    ctx.font = baseFont;
    var lineHeight = fontSize;
    var yy = y + lineHeight;
    var lastBaseline = yy;
    var drew = false;
    var previousLimit=false;

    for (var pi = 0; pi < paragraphs.length; pi++) {
      var p = paragraphs[pi];
      if (p === PARA) {
        // Preserve the authored paragraph, with a smaller gap only when fitting.
        yy = lastBaseline + (ctx.fsParagraphGap === undefined ? 2*lineHeight : lineHeight+interline+fontSize*ctx.fsParagraphGap);
        continue;
      }
      if (p === '') continue;
      var limit=ctx.fsKind==='orders' && /^ОДИН РАЗ ЗА (?:РАУНД|ИГРУ)[.!]?$/i.test(p.trim());
      // The frequency label is smaller than its effect and needs its own
      // clear space, including when another effect follows it in the source.
      if(limit||previousLimit){
        lineFontSize=limit?(ctx.fsOrderLimitSize||fontSize*ORDER_LIMIT.scale):fontSize;
        baseFont=(ctx.fsBodyWeight?ctx.fsBodyWeight+' ':'')+lineFontSize+'px '+family;
        if(limit)yy-=fontSize-lineFontSize;
        if(drew){
          if(ctx.fsOrderLimitGap){ctx.font=baseFont;yy=lastInkBottom+ctx.fsOrderLimitGap+ctx.measureText(p).actualBoundingBoxAscent+printedStrokeWidth(ctx,p)/2;}
          else yy=Math.max(yy,lastBaseline+lineFontSize+fontSize*ORDER_LIMIT.gap);
        }
      }
      lineAlign=limit || p.trim()==='-или-'?'center':align;
      lineRole=limit?'limit':ctx.fsTextRole||'body';
      var words = [];
      buildTokens(p).forEach(function (token) {
        if (token.text === ':' && words.length) {
          words[words.length-1].segments.push({text:':',style:token.style});
          words[words.length-1].width += measure(':',token.style);
          return;
        }
        token.text.split(' ').filter(Boolean).forEach(function (word) {
          words.push({segments:[{text:word,style:token.style}],width:measure(word,token.style),space:measure(' ',token.style)});
        });
      });
      // Keep the fewest lines, then prefer even wrapping and a useful last line.
      // Authored paragraph breaks and wording are never rewritten here.
      var breaks = new Array(words.length+1);breaks[words.length]={lines:0,cost:0};
      for (var start=words.length-1;start>=0;start--) {
        var width=0,best=null;
        for (var end=start;end<words.length;end++) {
          width += words[end].width + (end>start?words[end].space:0);
          if(width>maxW && end>start)break;
          var tail=breaks[end+1],last=end===words.length-1;
          var slack=Math.max(0,1-width/maxW);
          var cost=tail.cost+slack*slack*(last ? .15 : 1);
          if(last && start>0 && end===start)cost+=4;
          else if(last && start>0 && width<maxW*.3)cost+=1;
          if(!last && /[.!?;:]$/.test(words[end].segments.map(function(s){return s.text;}).join('')))cost-=.08;
          var candidate={lines:tail.lines+1,cost:cost,end:end+1};
          // Printed order rules fill each line from the left. Other cards keep
          // balanced wrapping, including their authored paragraph breaks.
          if(!best || (ctx.fsKind==='orders' ? candidate.end>best.end :
            candidate.lines<best.lines || candidate.lines===best.lines && candidate.cost<best.cost))best=candidate;
        }
        breaks[start]=best;
      }
      for(var start=0;start<words.length;start=breaks[start].end){
        var line=[];
        for(var wi=start;wi<breaks[start].end;wi++)words[wi].segments.forEach(function(segment,index){
          line.push({text:(wi>start && !index?' ':'')+segment.text,style:segment.style});
        });
        renderLine(line, yy);
        lastBaseline = yy;
        yy += lineFontSize + interline;
        drew = true;
      }
      if(limit)yy+=fontSize-lineFontSize;
      previousLimit=limit;
    }

    if (!drew) return 0;
    ctx.fsLastTextInkBottom=lastInkBottom;
    // Ink box ends at the last baseline (first baseline was y+lineHeight).
    return lastBaseline - y;
  }

  function measureStyledWrappedText(ctx, text, maxW, interline, fontSize) {
    ctx.fsMeasuredWidth=0;
    return layoutStyledWrappedText(ctx, text, 0, 0, maxW, interline, fontSize, 'left', false);
  }

  function drawStyledWrappedText(ctx, text, x, y, maxW, interline, fontSize, align) {
    return layoutStyledWrappedText(ctx, text, x, y, maxW, interline, fontSize, align, true);
  }

  function printedStrokeWidth(ctx,text) {
    if(ctx.fsKind==='overlay'||ctx.fsTextRole==='heading'||!ctx.font.includes(FONT.body)||
      !/[^}{<|#@\uE100-\uE102\uE200-\uE205\s]/.test(text)||
      ctx.fillStyle!=='#000000'&&ctx.fillStyle!=='#15120c')return 0;
    return parseFloat(ctx.font.match(/([\d.]+)px/)[1])*.01;
  }

  function drawPrintedText(ctx,text,x,y) {
    var paper=ctx.fsKind!=='overlay'&&ctx.fsTextRole!=='heading'&&
      (ctx.fillStyle==='#000000'||ctx.fillStyle==='#15120c');
    if(!paper){ctx.fillText(text,x,y);return;}
    // Slightly translucent ink absorbs the existing paper grain and shading.
    // Isolate the blend so token pictures and frame artwork stay untouched.
    ctx.save();ctx.globalCompositeOperation='multiply';ctx.globalAlpha*=.95;
    var stroke=printedStrokeWidth(ctx,text);
    if(stroke){
      ctx.strokeStyle=ctx.fillStyle;ctx.lineWidth=stroke;ctx.lineJoin='round';
      // Keep whole text runs shaped together. Game glyphs retain their original
      // outlines and advances; only the surrounding letterforms gain ink.
      var at=x;
      text.split(/([}{<|#@\uE100-\uE102\uE200-\uE205])/).forEach(function(part){
        if(part && !/[}{<|#@\uE100-\uE102\uE200-\uE205]/.test(part))ctx.strokeText(part,at,y);
        at+=ctx.measureText(part).width;
      });
    }
    ctx.fillText(text,x,y);ctx.restore();
  }

  // Image tokens occupy the same advance and baseline as their font glyphs, so
  // switching style cannot change wrapping or effect-panel geometry.
  function drawTokenText(ctx, text, x, y, fontSize) {
    if (!/[\uE100-\uE102]/.test(text)) {
      drawPrintedText(ctx,text,x,y); return;
    }
    text.split(/([\uE100-\uE102])/).forEach(function (part) {
      var token=window.FSWord.tokens.find(function(t){return t.glyph===part;});
      var image = ctx.fsTokenImages && ctx.fsTokenImages[part], advance = ctx.measureText(part).width;
      var rotation=token?.rotation||0;
      if (image) {
        var size = fontSize * 1996 / 2048;
        var left = x + (advance - size) / 2, top = y - fontSize * 1754 / 2048;
        ctx.save();ctx.translate(left+size/2,top+size/2);ctx.rotate(rotation*Math.PI/180);
        ctx.drawImage(image,-size/2,-size/2,size,size);ctx.restore();
        ctx.fsTokenImageBounds.push({ glyph: part, x: left, y: top, width: size, height: size,rotation:rotation });
      } else if(rotation){
        var ink=ctx.measureText(part),cx=x+(ink.actualBoundingBoxRight-ink.actualBoundingBoxLeft)/2;
        var cy=y+(ink.actualBoundingBoxDescent-ink.actualBoundingBoxAscent)/2;
        ctx.save();ctx.translate(cx,cy);ctx.rotate(rotation*Math.PI/180);drawPrintedText(ctx,part,x-cx,y-cy);ctx.restore();
      } else drawPrintedText(ctx,part,x,y);
      if(rotation && (ctx.fsStrict || ctx.fsCollectMetrics)){
        if(!ctx.fsTokenRotations)ctx.fsTokenRotations=[];
        ctx.fsTokenRotations.push({glyph:part,rotation:rotation});
      }
      x += advance;
    });
  }

  // image cache — shared chrome loads once per session
  var _imgCache = window.FSCache.create(24);
  function loadImage(url) {
    var cached = _imgCache.get(url);
    if (cached) return cached;
    var pending = new Promise(function (resolve, reject) {
      var img = new Image(), timer = setTimeout(function () {
        img.onload = img.onerror = null; img.removeAttribute('src');
        reject(new Error('Не завершена загрузка ' + url));
      }, 15000);
      img.onload  = function () { clearTimeout(timer); resolve(img); };
      img.onerror = function () { clearTimeout(timer); reject(new Error('Failed to load image ' + url)); };
      img.src = url;
    }).catch(function (error) {
      if (_imgCache.get(url) === pending) _imgCache.delete(url);
      throw error;
    });
    return _imgCache.set(url, pending);
  }

  // Optional reconstructed template. Patches take clean texture from a real
  // asset; the original raster sources stay intact.
  // This prepares a background only. Rules, wrapping and symbols still use DRAW.
  function featherEdges(canvas,amount) {
    var ctx=canvas.getContext('2d');ctx.save();ctx.globalCompositeOperation='destination-in';
    [[0,0,amount,0,false],[canvas.width-amount,0,canvas.width,0,true],
      [0,0,0,amount,false],[0,canvas.height-amount,0,canvas.height,true]].forEach(function(edge){
      var gradient=ctx.createLinearGradient(edge[0],edge[1],edge[2],edge[3]);
      gradient.addColorStop(0,edge[4]?'#000':'transparent');gradient.addColorStop(1,edge[4]?'transparent':'#000');
      ctx.fillStyle=gradient;ctx.fillRect(0,0,canvas.width,canvas.height);
    });
    ctx.restore();
  }

  var _preparedPictures=window.FSCache.create(8);
  function canvasPicture(picture,feather) {
    var key=picture.src+'|'+(feather||0),cached=key&&_preparedPictures.get(key);if(cached)return cached;
    var canvas=document.createElement('canvas');canvas.width=picture.width;canvas.height=picture.height;canvas.getContext('2d',feather?{willReadFrequently:true}:undefined).drawImage(picture,0,0);
    if(feather)featherEdges(canvas,feather);
    if(key)_preparedPictures.set(key,canvas);return canvas;
  }

  async function loadCardPicture(data) {
    if(data.preparedPicture)return data.preparedPicture;
    var picture = await loadImage(data.template?.picture || data.picture);
    if (!data.template?.patches?.length) return data.template?.sampling==='canvas'?canvasPicture(picture):picture;
    var canvas = document.createElement('canvas');
    canvas.width = picture.width; canvas.height = picture.height;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(picture, 0, 0);
    var titlePatch=data.kind==='orders' && data.template.patches.find(function(p){return !p.role;});
    for (var patch of data.template.patches || []) {
      if(data.kind==='orders' && patch.role==='body-erasure'){
        // Erase old wording in place; foreign repeating tiles flatten the
        // source paper and lose its scan lines, grain and wear.
        restoreOrderPaper(ctx,picture,patch.box,'order');
        continue;
      }
      if(patch.role==='body-erasure' && patch.paper==='native'){
        // Keep the event's own stains and shaded margins instead of laying a
        // repeating donor rectangle over the parchment.
        restoreOrderPaper(ctx,picture,patch.box,'event');
        continue;
      }
      if(patch.role==='event-type'){
        eraseNativeField(ctx,picture,patch.box,true);
        continue;
      }
      var header=titlePatch && (!patch.role || patch.role==='title-tail');
      var recipe=header?titlePatch:patch;
      var texture = await loadImage(recipe.texture.src), crop = recipe.texture.crop;
      var feather=patch.featherPx||0, padding=feather+(data.kind==='orders'?3:0);
      // Keep the entire erasure opaque, including accents just beyond its box.
      // Blend outside that guard, so old lettering cannot show through the fade.
      var original=patch.box, x=Math.max(0,original[0]*canvas.width-padding), y=Math.max(0,original[1]*canvas.height-padding);
      var right=Math.min(canvas.width,(original[0]+original[2])*canvas.width+padding);
      var bottom=Math.min(canvas.height,(original[1]+original[3])*canvas.height+padding);
      var box=[x/canvas.width,y/canvas.height,(right-x)/canvas.width,(bottom-y)/canvas.height];
      var layer=document.createElement('canvas');
      layer.width=Math.ceil(box[2]*canvas.width);layer.height=Math.ceil(box[3]*canvas.height);
      var layerCtx=layer.getContext('2d');
      if(header){
        // Title patches share one vertical texture origin. Repeat across the
        // nameplate only, so overlapping tails cannot introduce shifted bands.
        var tile=document.createElement('canvas');tile.width=Math.ceil(crop[2]*texture.width);tile.height=layer.height;
        var scaleY=crop[3]*texture.height/(recipe.box[3]*canvas.height);
        var sourceY=crop[1]*texture.height+(y-recipe.box[1]*canvas.height)*scaleY;
        tile.getContext('2d').drawImage(texture,crop[0]*texture.width,sourceY,crop[2]*texture.width,(bottom-y)*scaleY,0,0,tile.width,tile.height);
        var pattern=layerCtx.createPattern(tile,'repeat-x');pattern.setTransform(new DOMMatrix().translate(-x,0));
        layerCtx.fillStyle=pattern;layerCtx.fillRect(0,0,layer.width,layer.height);
      }else if(patch.tile){
        var tile=document.createElement('canvas');tile.width=Math.ceil(crop[2]*texture.width);tile.height=Math.ceil(crop[3]*texture.height);
        tile.getContext('2d').drawImage(texture,crop[0]*texture.width,crop[1]*texture.height,
          crop[2]*texture.width,crop[3]*texture.height,0,0,tile.width,tile.height);
        layerCtx.fillStyle=layerCtx.createPattern(tile,'repeat');layerCtx.fillRect(0,0,layer.width,layer.height);
      }else layerCtx.drawImage(texture,crop[0]*texture.width,crop[1]*texture.height,
        crop[2]*texture.width,crop[3]*texture.height,0,0,layer.width,layer.height);
      feather=Math.min(feather,layer.width/4,layer.height/4);
      if(feather)featherEdges(layer,feather);
      ctx.drawImage(layer,box[0]*canvas.width,box[1]*canvas.height,box[2]*canvas.width,box[3]*canvas.height);
    }
    return canvas;
  }

  async function sourceInfo(card) {
    var url=card.artSrc || (card.renderMode==='raster'?card.src:card.template?.picture || card.picture || card.src);
    if (card.text?.crop || card.template?.crop) {
      // A virtual side is route state, not a second bitmap. Both crops share
      // one decoded source (especially useful for large sheets on phones).
      var asset=new URL(url,document.baseURI);asset.searchParams.delete('side');url=asset.href;
    }
    var picture = await loadImage(url);
    var crop = (card.renderMode==='raster'?null:card.template?.crop) || card.text?.crop || [0,0,1,1];
    if (!Array.isArray(crop) || crop.length !== 4 || crop.some(function (v) { return !Number.isFinite(v) || v < 0; }) ||
        !crop[2] || !crop[3] || crop[0]+crop[2]>1 || crop[1]+crop[3]>1) throw new Error('Некорректная область листа');
    // Round shared edges, rather than independently rounding half-heights.
    var x = Math.round(crop[0]*picture.width), y = Math.round(crop[1]*picture.height);
    return {picture:picture,x:x,y:y,width:Math.round((crop[0]+crop[2])*picture.width)-x,
      height:Math.round((crop[1]+crop[3])*picture.height)-y,regions:sheetRegions(card.text)};
  }

  // The three English SoW sheets use one printed layout. Store their wording
  // once in factionSheet; keep the shared artwork geometry here, alongside FIELDS.
  function sheetRegions(text) {
    if (!text) return [];
    if (text.regions) return text.regions;
    var sheet=text.sheet;
    if (!sheet || sheet.layout !== 'sow') return [];
    var regions=[], add=function (box,value,heading,size) {
      regions.push({box:box,value:value,role:heading?'heading':'body',size:size,
        align:heading?'center':'left'});
    };
    if (text.side === 'front') {
      regions.push({box:[.404,.328,.218,.214],paperBox:[.404,.328,.226,.214],role:'ability'});
      add([.421,.601,.187,.028],'Жетоны целей',true,.027);
      add([.775,.087,.034,.019],'Город',true,.018);
      add([.906,.087,.037,.019],'Фабрика',true,.018);
      add([.777,.188,.155,.024],'Бастион',true,.021);
      sheet.units.forEach(function (value,index) {add([.777,.291+index*.1044,.155,.024],value,true,.02);});
    } else {
      add([.109,.286,.201,.032],'Стартовые силы',true,.03);
      regions.push({box:[.442,.224,.311,.31],value:sheet.lore,role:'lore',size:.022});
      var step=.522/sheet.initialForces.length;
      sheet.initialForces.forEach(function (value,index) {add([.194,.335+step*index,.116,step*.79],value,true,.025);regions[regions.length-1].wrap=true;});
      sheet.objectives.forEach(function (value,index) {
        if (value) regions.push({box:[index<3?.496:.779,.568+(index%3)*.097,.149,.067],value:value,role:'objective',size:.015});
      });
    }
    return regions;
  }

  var _sourceAreas=window.FSCache.create(32);
  var _titleAreas=window.FSCache.create(32);
  var _artworkAreas=window.FSCache.create(32);
  function drawEnhancedArtwork(ctx,source,target) {
    var layer=ctx.fsArtwork;
    if(!layer)return;
    var box=layer.box,scaleX=target[2]/source[2],scaleY=target[3]/source[3];
    ctx.save();
    ctx.beginPath();ctx.rect(target[0],target[1],target[2],target[3]);ctx.clip();
    ctx.drawImage(layer.image,target[0]+(box[0]-source[0])*scaleX,target[1]+(box[1]-source[1])*scaleY,box[2]*scaleX,box[3]*scaleY);
    ctx.restore();
  }
  function extendArtwork(ctx,picture,panelTop,windowBox) {
    var end=windowBox ? windowBox[1]+windowBox[3] : _artworkAreas.get(picture.src);
    if(end===undefined){
      var sample=document.createElement('canvas');sample.width=120;sample.height=picture.height;
      var c=sample.getContext('2d',{willReadFrequently:true});c.drawImage(picture,0,0,sample.width,sample.height);
      var pixels=c.getImageData(0,0,sample.width,sample.height).data,start=null;end=null;
      for(var y=Math.floor(sample.height*.35);y<sample.height*.97;y++){
        var white=0;for(var x=0;x<sample.width;x++){var i=(y*sample.width+x)*4;if(pixels[i]>245&&pixels[i+1]>245&&pixels[i+2]>245)white++;}
        if(white/sample.width>.96){if(start===null)start=y;}
        else start=null;
        if(start!==null && y-start>sample.height*.06){end=start/sample.height;break;}
      }
      _artworkAreas.set(picture.src,end);
    }
    var cw=canvasSize(ctx).width,ch=canvasSize(ctx).height;
    ctx.fsCombatArtwork={nativeBottomPx:end===null?ch:end*ch,paintedBottomPx:end===null?ch:end*ch,extended:false};
    if(end===null || panelTop<=end*ch+1)return;
    // Blank templates may contain only a cropped illustration. Cover the larger
    // measured artwork window; the original title, badge and left frame stay put.
    var left=windowBox?windowBox[0]:.18,top=windowBox?windowBox[1]:.13,width=windowBox?windowBox[2]:1-left;
    var sw=picture.width*width,sh=picture.height*(end-top);
    var dw=cw*width,dh=panelTop-ch*top,scale=Math.max(dw/sw,dh/sh),cropW=dw/scale,cropH=dh/scale;
    var source=[picture.width*left+(sw-cropW)/2,picture.height*top,cropW,cropH],target=[cw*left,ch*top,dw,dh];
    // Measured windows exclude the frame and solid placeholder paint. Blend the
    // top edge into the retained illustration when its crop needs to grow.
    var feather=windowBox?Math.min(ch*.008,dh/3):0;
    ctx.save();
    for(var edge=0;edge<feather;edge++){
      var rowH=Math.min(1,feather-edge);ctx.globalAlpha=(edge+rowH/2)/feather;
      ctx.drawImage(picture,source[0],source[1]+edge/scale,cropW,rowH/scale,target[0],target[1]+edge,dw,rowH);
    }
    ctx.globalAlpha=1;
    ctx.drawImage(picture,source[0],source[1]+feather/scale,cropW,cropH-feather/scale,target[0],target[1]+feather,dw,dh-feather);
    ctx.restore();
    drawEnhancedArtwork(ctx,source,target);
    ctx.fsCombatArtwork.paintedBottomPx=panelTop;ctx.fsCombatArtwork.extended=true;
  }

  function restoreNativeFrame(ctx,source,panelTop,sourceBox) {
    var top=.56,left=.18,cw=canvasSize(ctx).width,ch=canvasSize(ctx).height,y=ch*top;
    if (!source || panelTop<=y) return;
    var bottom=sourceBox?sourceBox[1]+sourceBox[3]:ctx.fsCombatArtwork.nativeBottomPx/ch-.02;
    if (bottom<=top) return;
    var sourceTop=sourceBox?sourceBox[1]:top,sourceLeft=sourceBox?sourceBox[0]:0,sourceWidth=sourceBox?sourceBox[2]:left;
    var scale=cw/source.width,sw=source.width*sourceWidth,sy=source.height*sourceTop,height=panelTop-y;
    var sourceH=Math.min((bottom-sourceTop)*source.height,height/scale),sx=source.width*sourceLeft;
    // Replace the whole free frame once. Replaying a native fragment over a
    // template, then tiling its tail, duplicated the cables and blue pattern.
    // A longer artwork window stretches this one continuous section instead.
    var ratio=sourceH/height;
    var feather=Math.min(cw*.01,height/3);
    ctx.save();
    for(var edge=0;edge<feather;edge++){
      var rowH=Math.min(1,feather-edge);ctx.globalAlpha=(edge+rowH/2)/feather;
      ctx.drawImage(source,sx,sy+edge*ratio,sw,rowH*ratio,0,y+edge,cw*left,rowH);
    }
    ctx.restore();
    ctx.drawImage(source,sx,sy+feather*ratio,sw,(height-feather)*ratio,0,y+feather,cw*left,height-feather);
    ctx.fsCombatArtwork.nativeFrame={source:source.src,topPx:y,bottomPx:panelTop,sourceTop:sourceTop,sourceBottom:sourceTop+sourceH/source.height,continuous:true};
  }
  function combatTitleField(picture) {
    var cached=_titleAreas.get(picture.src);if(cached)return cached;
    var b=FIELDS.combat.title.slice(),sample=document.createElement('canvas');sample.width=240;sample.height=1;
    sample.getContext('2d').drawImage(picture,0,picture.height*.05,picture.width,1,0,0,240,1);
    var pixels=sample.getContext('2d').getImageData(0,0,240,1).data,right=Math.round((b[0]+b[2])*240),dark=0;
    for(var x=Math.floor(b[0]*240);x<235;x++){
      var i=x*4,r=pixels[i],g=pixels[i+1],blue=pixels[i+2];
      if(r>145 && g>125 && blue>70 && r-g<70 && g-blue<115)dark=0;else dark++;
      if(dark>=3){right=x-2;break;}
    }
    if(right/240>b[0]+.3)b[2]=Math.min(b[2],right/240-b[0]-.01);
    return _titleAreas.set(picture.src,b);
  }
  function combatSourceArea(picture) {
    var key=picture.src,cached=_sourceAreas.get(key);
    if(cached)return cached;
    var sample=document.createElement('canvas');sample.width=240;sample.height=Math.round(240*picture.height/picture.width);
    var context=sample.getContext('2d',{willReadFrequently:true});context.drawImage(picture,0,0,sample.width,sample.height);
    var pixels=context.getImageData(0,0,sample.width,sample.height).data,bands=[],start=null;
    function paper(x,y){
      var i=(y*sample.width+x)*4,r=pixels[i],g=pixels[i+1],b=pixels[i+2];
      return r>150 && g>135 && b>65 && r-g<65 && g-b<110 && b<r*1.03 && g>b*.96;
    }
    function band(y){
      var total=0,left=0,right=0;
      for(var x=12;x<228;x++)if(paper(x,y)){total++;if(x<30)left++;if(x>=210)right++;}
      return total/216>.68 && Math.min(left,right)/18>.55;
    }
    for(var y=Math.floor(sample.height*.4);y<Math.floor(sample.height*.98);y++){
      if(band(y)){if(start===null)start=y;}
      else if(start!==null){if(y-start>=3)bands.push([start,y]);start=null;}
    }
    if(start!==null)bands.push([start,y]);
    var merged=[];
    bands.forEach(function(b){var last=merged[merged.length-1];if(last && b[0]-last[1]<sample.height*.046)last[1]=b[1];else merged.push(b.slice());});
    var candidates=merged.filter(function(b){return b[1]>sample.height*.8 && b[1]-b[0]>sample.height*.045;});
    if(!candidates.length)throw new Error('Не найдена область правил на исходной боевой карте');
    var native=candidates[candidates.length-1];
    // Include the thin native edge; retain the illustration above and trim below.
    var area={top:Math.max(.4,native[0]/sample.height-.006),bottom:Math.min(.98,native[1]/sample.height+.003)};
    return _sourceAreas.set(key,area);
  }

  function drawLabel(ctx, label, region, role, startSize) {
    var b = region.box, cw = canvasSize(ctx).width, ch = canvasSize(ctx).height;
    var box = {x:b[0]*cw,y:b[1]*ch,width:b[2]*cw,height:b[3]*ch};
    var size = ch*(startSize||.05), ink;
    var family=region.font||FONT[role]||FONT.title;
    for (var guard=0; guard<160; guard++) {
      ctx.font = (role==='type'?'bold ':'') + size + 'px '+family;
      ink = ctx.measureText(label);
      if (ink.width<=box.width*(1-2*LABEL_LAYOUT.paddingX) && ink.actualBoundingBoxAscent+ink.actualBoundingBoxDescent<=box.height*(1-2*LABEL_LAYOUT.inkPaddingY)) break;
      size *= .96;
    }
    ctx.textAlign = 'left';
    var x=region.align==='center' ? box.x+box.width/2+(ink.actualBoundingBoxLeft-ink.actualBoundingBoxRight)/2 : box.x+ink.actualBoundingBoxLeft;
    var y=box.y+box.height/2+(ink.actualBoundingBoxAscent-ink.actualBoundingBoxDescent)/2;
    var bounds;
    bounds=recordInk(ctx,label,x,y,role,region.align);
    ctx.fillText(label,x,y);
    if(role==='type')ctx.fsEventType = {box:box,ink:bounds,font:family};
  }

  function drawEventType(ctx,label,region) {
    // Center on the lit face of the plate; its lower lip belongs to the shadow.
    var box=region.box.slice();box[3]*=LABEL_LAYOUT.typeFaceHeight;
    drawLabel(ctx,label,Object.assign({},region,{box:box,align:'center'}),'type',.04);
  }

  function textField(data,kind) {
    var align='left';
    var body=data.template?.body;
    if(body)return Object.assign({},body,{align:kind==='orders'?align:body.align||align});
    var patch=(data.template?.patches||[]).find(function(p){return p.role==='body-erasure';});
    if(patch){
      var b=patch.box;
      return {box:[b[0]+.025,b[1]+.005,b[2]-.05,b[3]-.02],align:align};
    }
    return {box:FIELDS[kind].body,align:align};
  }

  function labelField(data,kind) {
    if(data.template?.titleRegion)return data.template.titleRegion;
    if(kind==='orders')return {box:FIELDS.orders.title,align:'center'};
    var patch=(data.template?.patches||[]).find(function(p){return !p.role;});
    return {box:patch?patch.box:FIELDS[kind].title,align:kind==='orders'?'center':'left'};
  }

  function rasterTitleField(kind) {
    var box=FIELDS.raster[kind].title.slice();
    if(kind==='orders')box[2]=1-2*box[0];
    else {
      // Erasure covers the old lettering; placement keeps the paper's inset.
      var inset=box[2]*LABEL_LAYOUT.nativeInsetX;
      box[0]+=inset;box[2]-=inset*2;
    }
    return {box:box,align:kind==='orders'?'center':'left'};
  }

  function orderFooter(ctx,text,box) {
    var match=/(?:\s*\*(?:newline|newpara)\*\s*|\n)\s*(ОДИН РАЗ ЗА (?:РАУНД|ИГРУ)[.!]?)([\s\S]*)$/i.exec(text);
    if(!match)return null;
    var following=match[2].replace(/\s*\*(?:newline|newpara)\*\s*/g,'\n').trim();
    // A frequency label before another effect must stay with that effect.
    if(following && !/^ТРЕБУЕТ [^\n]+[.!]?$/i.test(following))return null;
    var ch=canvasSize(ctx).height,size=ch*ORDER_LIMIT.fontRatio;
    var labels=[match[1]].concat(following?[following]:[]),lines=[],bottom=ch*ORDER_LIMIT.bottom;
    ctx.save();ctx.font=size+'px '+FONT.body;
    for(var i=labels.length-1;i>=0;i--){
      var ink=ctx.measureText(labels[i]),stroke=printedStrokeWidth(ctx,labels[i]);
      var y=bottom-ink.actualBoundingBoxDescent-stroke/2;
      var top=y-ink.actualBoundingBoxAscent-stroke/2;
      lines.unshift({text:labels[i],x:box.x+box.width/2+(ink.actualBoundingBoxLeft-ink.actualBoundingBoxRight)/2,y:y,role:i?'requirement':'limit'});
      bottom=top-ch*ORDER_LIMIT.lineGap;
    }
    ctx.restore();
    return {body:text.slice(0,match.index).trim(),lines:lines,size:size,top:top,bottom:ch*ORDER_LIMIT.bottom};
  }

  function drawBodyTextBox(ctx, text, region) {
    var previousPrefixes=ctx.fsItalicPrefixes;
    var previousGap=ctx.fsParagraphGap;
    var previousLimitSize=ctx.fsOrderLimitSize,previousLimitGap=ctx.fsOrderLimitGap;
    var order=ctx.fsKind==='orders';
    if(region.italicPrefixes===false)ctx.fsItalicPrefixes=false;
    var b=region.box,cw=canvasSize(ctx).width,ch=canvasSize(ctx).height;
    var box={x:b[0]*cw,y:b[1]*ch,width:b[2]*cw,height:b[3]*ch};
    // Keep the translated ink inside the native paper, away from its shadow.
    box.x+=cw*RULES_LAYOUT.insetX;box.width-=2*cw*RULES_LAYOUT.insetX;
    box.y+=ch*RULES_LAYOUT.insetY;box.height-=2*ch*RULES_LAYOUT.insetY;
    var footer=order?orderFooter(ctx,text,box):null;
    if(order){
      ctx.fsOrderLimitSize=ch*ORDER_LIMIT.fontRatio;ctx.fsOrderLimitGap=ch*ORDER_LIMIT.gapRatio;
      if(footer){
        text=footer.body;
        box.height=Math.min(box.height,footer.top-ctx.fsOrderLimitGap-box.y);
      }
    }
    var size=ch*RULES_LAYOUT.fontSize,minimumSpacing=RULES_LAYOUT.minimumSpacing;
    var interline=size*RULES_LAYOUT.lineSpacing,height,clearance=order ? .35 : .25;
    ctx.fsParagraphGap=RULES_LAYOUT.paragraphGap;
    for(var guard=0;guard<100;guard++){
      height=measureStyledWrappedText(ctx,text,box.width,interline,size);
      if(height+size*clearance<=box.height && ctx.fsMeasuredWidth<=box.width)break;
      if(ctx.fsMeasuredWidth<=box.width && ctx.fsParagraphGap>.25)ctx.fsParagraphGap=Math.max(.25,ctx.fsParagraphGap-.1);
      else if(ctx.fsMeasuredWidth<=box.width && interline>size*minimumSpacing+.01)interline=Math.max(size*minimumSpacing,interline*.94);
      else {size*=.96;interline=size*minimumSpacing;}
    }
    if(height+size*clearance>box.height || ctx.fsMeasuredWidth>box.width)throw new Error('Текст не помещается в область правил');
    var align=region.align||'left';
    drawStyledWrappedText(ctx,text,align==='center'?box.x+box.width/2:box.x,
      box.y,box.width,interline,size,align);
    ctx.fsBodyTextBox={box:box,inkBottomPx:box.y+height+size*clearance,fontSizePx:size};
    if(footer){
      var inkBottom=ctx.fsLastTextInkBottom;
      // Give short effects a full visual break without shrinking dense rules
      // to make room for it. The footer remains inside its safe paper area.
      ctx.fsOrderLimitGap=Math.max(ctx.fsOrderLimitGap,Math.min(ch*.028,footer.top-inkBottom));
      var offset=inkBottom+ctx.fsOrderLimitGap-footer.top;
      if(!Number.isFinite(offset))offset=0;
      ctx.save();ctx.font=footer.size+'px '+FONT.body;ctx.textAlign='left';
      footer.lines.forEach(function(line){
        recordInk(ctx,line.text,line.x,line.y+offset,line.role,'center',printedStrokeWidth(ctx,line.text));
        drawPrintedText(ctx,line.text,line.x,line.y+offset);
      });
      ctx.restore();
      ctx.fsOrderFooter={box:{x:box.x,y:footer.top+offset,width:box.width,height:footer.bottom-footer.top},gapPx:ctx.fsOrderLimitGap,fontSizePx:footer.size};
    }
    ctx.fsItalicPrefixes=previousPrefixes;
    ctx.fsParagraphGap=previousGap;
    ctx.fsOrderLimitSize=previousLimitSize;ctx.fsOrderLimitGap=previousLimitGap;
  }

  // ---- card draw functions ----

  // Shared framed general/unit effects for blank templates and baked TDL cards.
  // Baked cards fill the complete old wording area so no English text is exposed
  // when the Russian wording is shorter or only one effect exists.
  function drawCombatEffects(data, ctx, panels, sourceArea, picture, nativeFrame) {
    var cw = canvasSize(ctx).width, ch = canvasSize(ctx).height;
    var endY=sourceArea?ch*sourceArea.bottom:ch;
    // Choose the font against the established reading-area budget first.
    // Freed padding then goes to artwork, rather than enlarging dense type
    // until it consumes the space again.
    var textMarginX = cw * COMBAT_LAYOUT.readingArea.marginX;
    var textWidth   = cw - textMarginX * 2;
    var minimumHeight=sourceArea?ch*(sourceArea.bottom-sourceArea.top):0;
    var maxTextH    = Math.max(ch * COMBAT_LAYOUT.maxTextAreaHeight,minimumHeight);
    var bgText = data.hasText ? window.FSWord.symbolize(data.background || '') : '';
    var fgText = data.hasText ? window.FSWord.symbolize(data.foreground || '') : '';
    var backgroundImg = panels[0], foregroundImg = panels[1], bottomImg = panels[2];
    // Chrome sizes derived from the loaded assets (no fixed 880px reference).
    var bgDecoH  = srcPxToCanvas(backgroundImg, COMBAT_LAYOUT.backgroundDecoSrcPx, cw);
    var fgDecoH  = srcPxToCanvas(foregroundImg, COMBAT_LAYOUT.foregroundDecoSrcPx, cw);
    var bottomH  = srcPxToCanvas(bottomImg, bottomImg.height, cw);

    if (bgText || fgText) {
      var previousGap=ctx.fsParagraphGap;
      ctx.fsParagraphGap=.743;
      var fontSize  = ch * COMBAT_LAYOUT.fontSize;
      var interline = ch * COMBAT_LAYOUT.readingArea.lineSpacing;
      var marginH   = cw * COMBAT_LAYOUT.readingArea.marginY;

      // Panel = decorative header + margins + measured text (+ bottom strip on the
      // bottom-most panel). Text is vertically centred in the parchment area.
      var panelHeight = function (contentH, decoH, clearBottom) {
        return decoH + marginH + contentH + marginH + (clearBottom ? bottomH : 0);
      };

      var measurePanels = function () {
        var inkClearance = fontSize * 0.25;
        var bgContent = bgText ? measureStyledWrappedText(ctx, bgText, textWidth, interline, fontSize) + inkClearance : 0;
        var bgWidth=ctx.fsMeasuredWidth;
        ctx.fsItalicPrefixes=true;
        var fgContent = fgText ? measureStyledWrappedText(ctx, fgText, textWidth, interline, fontSize) + inkClearance : 0;
        var fgWidth=ctx.fsMeasuredWidth;ctx.fsItalicPrefixes=false;
        return {
          maxWidth:Math.max(bgText?bgWidth:0,fgText?fgWidth:0),
          bgContent: bgContent,
          fgContent: fgContent,
          bg: bgText ? panelHeight(bgContent, bgDecoH, !fgText) : 0,
          fg: fgText ? panelHeight(fgContent, fgDecoH, true)    : 0,
        };
      };

      var p = measurePanels();
      var guard = 0;
      var overBudget = function () {
        return p.bg+p.fg>maxTextH || p.maxWidth>textWidth;
      };
      while (overBudget() && guard < 80) {
        if(p.maxWidth<=textWidth && marginH>cw*.025+.01)marginH=Math.max(cw*.025,marginH*COMBAT_LAYOUT.marginShrinkFactor);
        else if(p.maxWidth<=textWidth && ctx.fsParagraphGap>.25)ctx.fsParagraphGap=Math.max(.25,ctx.fsParagraphGap-.1);
        else if(p.maxWidth<=textWidth && interline>fontSize*.18+.01)interline=Math.max(fontSize*.18,interline*COMBAT_LAYOUT.lineSpacingShrinkFactor);
        else {fontSize*=COMBAT_LAYOUT.fontShrinkFactor;interline=fontSize*.18;}
        p = measurePanels();
        guard++;
      }
      if (ctx.fsStrict && overBudget()) throw new Error('Боевой текст не помещается на карте');

      textMarginX=cw*COMBAT_LAYOUT.textMarginX;textWidth=cw-textMarginX*2;
      marginH=Math.min(marginH,cw*COMBAT_LAYOUT.marginY);
      interline=Math.min(interline,ch*COMBAT_LAYOUT.lineSpacing);
      ctx.fsParagraphGap=Math.min(ctx.fsParagraphGap,.4);
      p=measurePanels();

      if (sourceArea) {
        var spare = Math.max(0, minimumHeight - p.bg - p.fg);
        if (bgText && fgText) {var share=p.bg/(p.bg+p.fg);p.bg+=spare*share;p.fg+=spare*(1-share);}
        else if (bgText) p.bg += spare;
        else p.fg += spare;
        // The decorative panel PNGs contain transparent pixels. Put clean
        // parchment underneath their full area rather than exposing baked text.
        var sourceTop = COMBAT_LAYOUT.backgroundDecoSrcPx;
        ctx.drawImage(backgroundImg, 0, sourceTop, backgroundImg.width, backgroundImg.height - sourceTop,
          0, endY-minimumHeight, cw, minimumHeight);
      }

      var fgPanel = fgText ? {
        y: endY - p.fg, h: p.fg, decoH: fgDecoH, contentH: p.fgContent, bottomClear: bottomH,
      } : null;
      var bgPanel = bgText ? {
        y: endY - p.bg - (fgPanel ? p.fg : 0),
        // Green paper is visible through the separator's transparent tips.
        drawH: p.bg + (fgPanel ? fgDecoH : 0),
        h: p.bg, decoH: bgDecoH, contentH: p.bgContent,
        bottomClear: fgPanel ? 0 : bottomH,
      } : null;

      // Unit-only separators have transparent tips. Continue the illustration
      // beneath their header so the blank template cannot show a white seam.
      var artworkWindow=data.template?.artworkWindow;
      // Cover the header's translucent edge as well as the visible gap.
      var artworkBottom=(bgPanel||fgPanel).y+(bgPanel?(artworkWindow?bgDecoH:0):fgDecoH);
      if(!sourceArea && picture)extendArtwork(ctx,picture,artworkBottom,artworkWindow);
      if(nativeFrame)restoreNativeFrame(ctx,nativeFrame,artworkBottom,data.template.frame.box);
      else if(picture&&ctx.fsCombatArtwork?.extended&&!artworkWindow)restoreNativeFrame(ctx,picture,artworkBottom);

      if (bgPanel) drawStretchPanel(ctx, backgroundImg, bgPanel.y, bgPanel.drawH, COMBAT_LAYOUT.backgroundDecoSrcPx);
      if (fgPanel) drawStretchPanel(ctx, foregroundImg, fgPanel.y, fgPanel.h,     COMBAT_LAYOUT.foregroundDecoSrcPx);

      var textY = function (panel) {
        var innerTop = panel.y + panel.decoH;
        var innerH   = panel.h - panel.decoH - panel.bottomClear;
        return innerTop + Math.max(0, (innerH - panel.contentH) / 2);
      };

      ctx.fsTextRole='general';
      if (bgPanel) drawStyledWrappedText(ctx, bgText, textMarginX, textY(bgPanel), textWidth, interline, fontSize, 'left');
      ctx.fsTextRole='unit';
      ctx.fsItalicPrefixes=true;
      if (fgPanel) drawStyledWrappedText(ctx, fgText, textMarginX, textY(fgPanel), textWidth, interline, fontSize, 'left');
      ctx.fsItalicPrefixes=false;
      ctx.fsTextRole='body';

      var bounds = function (panel) {
        return panel ? { topPx: panel.y, heightPx: panel.h, textTopPx: textY(panel),
          textBottomPx: textY(panel) + panel.contentH, innerTopPx: panel.y + panel.decoH,
          innerBottomPx: panel.y + panel.h - panel.bottomClear } : null;
      };
      ctx.fsCombatPanels = { general: bounds(bgPanel), unit: bounds(fgPanel),
        fontSizePx: fontSize, coveredTopPx: sourceArea ? endY-minimumHeight : null,sourceArea:sourceArea||null };
      ctx.fsParagraphGap=previousGap;
    }
    ctx.fsCombatBottom=endY;
    return bottomH;
  }

  async function drawCombatCard(data, ctx) {
    if(data.template?.nativeCombatArea)return drawPreparedCombat(data,ctx);
    var cw = canvasSize(ctx).width, ch = canvasSize(ctx).height;
    var iconSz = cw * COMBAT_LAYOUT.iconSizeRatio, iconSp = cw * COMBAT_LAYOUT.iconSpacingRatio;
    var iconXPos = cw * COMBAT_LAYOUT.iconX, iconStartYPos = ch * COMBAT_LAYOUT.iconStartY;
    var iconChars = String(data.icons || '').split('').map(function (c) { return iconMap[c.toUpperCase()]; }).filter(Boolean);
    // Faction-wide references have explicit bounds with no baked symbols.
    var frame=data.template?.frame;
    if(frame&&(typeof frame.picture!=='string'||!frame.picture||!Array.isArray(frame.box)||frame.box.length!==4||frame.box.some(function(v){return !Number.isFinite(v)||v<0;})||
      !frame.box[2]||!frame.box[3]||frame.box[0]+frame.box[2]>1||frame.box[1]+frame.box[3]>1))throw new Error('Некорректная область рамки');
    var nativeFrame=frame?loadImage(frame.picture):Promise.resolve(null);
    var resources = await Promise.all([
      loadCardPicture(data), loadImage('pictures/background.png'),
      loadImage('pictures/foreground.png'), loadImage('pictures/bottom.png'),nativeFrame,
      data.artwork?loadImage(data.artwork.src):Promise.resolve(null),
    ].concat(iconChars.map(loadImage)));
    var picture = resources[0], bottomImg = resources[3], iconImgs = resources.slice(6);
    if(data.artwork){
      var box=data.artwork.box;
      if(!Array.isArray(box)||box.length!==4||box.some(function(v){return !Number.isFinite(v)||v<0;})||
        !box[2]||!box[3]||box[0]+box[2]>picture.width||box[1]+box[3]>picture.height)throw new Error('Некорректная область иллюстрации');
      // Lossless masked artwork is separate from the original frame and fields.
      ctx.fsArtwork={image:resources[5],box:box};
    }
    ctx.drawImage(picture, 0, 0, cw, ch);
    drawEnhancedArtwork(ctx,[0,0,picture.width,picture.height],[0,0,cw,ch]);
    drawLabel(ctx,data.title||'',{box:combatTitleField(picture)},'title');
    var bottomH = drawCombatEffects(data, ctx, resources.slice(1, 4), null,picture,resources[4]);
    // Five-symbol Base/GiF cards use the same rail and icon assets as SoW.
    // Fit a longer stack above both the rail cap and the measured effect panels.
    var panels = ctx.fsCombatPanels;
    var panelTop = panels ? (panels.general || panels.unit).topPx : ch;
    var stackHeight = iconImgs.length * iconSz + Math.max(0, iconImgs.length - 1) * iconSp;
    var railBottom = Math.min(ch * (iconImgs.length > 4 ? 0.54 : 0.56), panelTop - ch * 0.01);
    var iconScale = stackHeight ? Math.min(1, (railBottom - iconStartYPos) / stackHeight) : 1;
    iconXPos += (iconSz - iconSz * iconScale) / 2;
    iconSz *= iconScale; iconSp *= iconScale;
    ctx.fsCombatIcons = [];
    var iy = iconStartYPos;
    for (var i = 0; i < iconImgs.length; i++) {
      ctx.drawImage(iconImgs[i], iconXPos, iy, iconSz, iconSz);
      ctx.fsCombatIcons.push({ symbol: data.icons[i], x: iconXPos, y: iy, size: iconSz });
      iy += iconSz + iconSp;
    }

    ctx.drawImage(bottomImg, 0, 0, bottomImg.width, bottomImg.height, 0, ch - bottomH, cw, bottomH);
  }

  async function drawOrderCard(data, ctx) {
    var picture=await loadCardPicture(data);
    var general=data.hasText?window.FSWord.symbolize(data.general||''):'';
    ctx.drawImage(picture,0,0,canvasSize(ctx).width,canvasSize(ctx).height);
    drawLabel(ctx,data.title||'',labelField(data,'orders'),'title');
    if(general)drawBodyTextBox(ctx,general,textField(data,'orders'));
  }

  async function drawEventCard(data, ctx) {
    var picture=await loadCardPicture(data);
    var general=data.hasText?window.FSWord.symbolize(data.general||''):'';
    ctx.drawImage(picture,0,0,canvasSize(ctx).width,canvasSize(ctx).height);
    var patch=(data.template?.patches||[]).find(function(p){return p.role==='event-type';});
    drawEventType(ctx,data.type||'',data.template?.eventType||{box:patch?patch.box:FIELDS.events.type});
    drawLabel(ctx,data.title||'',labelField(data,'events'),'title');
    if(general)drawBodyTextBox(ctx,general,textField(data,'events'));
  }

  async function prepareBakedPicture(data) {
    var picture=await loadImage(data.picture);
    var fields=FIELDS.raster[data.kind];
    if(!fields)throw new Error('Нет разметки исходной карты');
    var prepared=document.createElement('canvas');prepared.width=picture.width;prepared.height=picture.height;
    var layer=prepared.getContext('2d');layer.drawImage(picture,0,0);
    Object.keys(fields).forEach(function(role){
      if(role==='title'||role==='type'){
        var box=fields[role].slice();
        if(data.kind==='orders' && role==='title'){
          // Keep the old accents inside the opaque cleanup and sample above
          // them. The title's measured placement remains independent.
          var gutter=box[3]*LABEL_LAYOUT.paddingY*2;box[1]-=gutter;box[3]+=gutter;
        }
        restoreNativeLabel(layer,picture,box);
      }
      else if(data.kind==='orders' && role==='body')restoreOrderPaper(layer,picture,fields[role],'order');
      else eraseNativeField(layer,picture,fields[role]);
    });
    return Object.assign({},data,{preparedPicture:prepared,template:{
      titleRegion:rasterTitleField(data.kind),
      body:{box:fields.body},eventType:fields.type?{box:fields.type}:null,
    }});
  }

  // Baked English TDL sources remain intact. Cover their wording before drawing
  // Russian text; merely adding JSON must never leave two languages superposed.
  // The same wrapping/font measurement is used by templates and these regions.
  function drawTextRegion(ctx, region, wording) {
    var cw = canvasSize(ctx).width, ch = canvasSize(ctx).height, b = region.box;
    var w = b[2] * cw, h = b[3] * ch;
    ctx.save();
    ctx.translate((b[0] + b[2] / 2) * cw, (b[1] + b[3] / 2) * ch);
    ctx.rotate((region.rotation || 0) * Math.PI / 180);
    if (!region.transparent) {
      ctx.fillStyle = region.fill || '#e9dfb6';
      ctx.fillRect(-w / 2, -h / 2, w, h);
    }
    ctx.fillStyle = region.ink || '#15120c';
    ctx.fsBodyFont = region.role === 'heading' ? FONT.title : region.font || FONT.body;
    ctx.fsBodyWeight = region.weight || (region.role === 'subheading' ? 'bold' : null);
    ctx.fsPrefixStyle = ['ability','objective'].includes(region.role) ? (ctx.fsKind==='sheet'?'italic':'bold') : null;
    ctx.fsSheetProse=!!region.prose;
    ctx.fsParagraphGap=region.paragraphGap;
    ctx.fsPrefixTitles = (region.abilities|| (region.role==='objective'?[{title:region.value.split(':')[0]}]:[])).map(function(ability){
      return window.FSWord.symbolize(window.FSWord.format(ability.title,wording)).replace(/\s+/g,' ').trim();
    });
    ctx.fsTextRole = region.role || 'body';
    // Label names stay words even when body text uses token icons. Headline
    // intentionally has no token glyphs (its private-use slots contain a logo).
    var text = window.FSWord.format(region.value, ctx.fsBodyFont === FONT.title ? 'explicit' : wording);
    if(region.prose)window.FSWord.symbols.forEach(function (symbol,index) {text=text.split(symbol.notation).join(String.fromCharCode(0xE200+index));});
    else text=window.FSWord.symbolize(text);
    var size = ch * (region.size || 0.03), margin = Math.min(w, h) * 0.06;
    var maxW = w - margin * 2, maxH = h - margin * 2;
    var leading=ctx.fsKind==='sheet' ? .18 : .12;
    var interline = size * leading;
    var height = measureStyledWrappedText(ctx, text, maxW, interline, size);
    if(ctx.fsKind==='sheet')height=Math.max(height,ctx.fsLastTextInkBottom||0);
    var guard = 0;
    while ((height > maxH || ctx.fsMeasuredWidth > maxW) && guard++ < 180) {
      size *= 0.97; interline = size * leading;
      height = measureStyledWrappedText(ctx, text, maxW, interline, size);
      if(ctx.fsKind==='sheet')height=Math.max(height,ctx.fsLastTextInkBottom||0);
    }
    if (height > maxH || ctx.fsMeasuredWidth>maxW) throw new Error('Перевод не помещается в текстовую область');
    var top=-h/2+margin;
    if(region.valign==='center'){
      ctx.font=(ctx.fsBodyWeight?ctx.fsBodyWeight+' ':'')+size+'px '+ctx.fsBodyFont;
      var ink=ctx.measureText(text);top=-height/2-(size-ink.actualBoundingBoxAscent+ink.actualBoundingBoxDescent)/2;
    }
    drawStyledWrappedText(ctx, text, region.align === 'center' ? 0 : region.align==='right'?w/2-margin:-w/2+margin,
      top, maxW, interline, size, region.align || 'left');
    ctx.fsBodyFont = null;
    ctx.fsBodyWeight = null;
    ctx.fsPrefixStyle = null;
    ctx.fsPrefixTitles = null;
    ctx.fsTextRole = null;
    ctx.fsSheetProse=false;
    ctx.fsParagraphGap=undefined;
    ctx.restore();
    return {fontSize:size,height:height};
  }

  // Typography is shared; boxes identify printed fields in the source artwork.
  // Existing Russian raster lettering remains intact where it already uses the
  // game's fonts. New translations are drawn from the same ability data as HTML.
  var _sheetBackgrounds=window.FSCache.create(2);
  async function prepareSheetBackground(data) {
    var source = await sourceInfo({src:data.picture,text:{crop:data.crop}});
    var regions=sheetRegions(data),key=JSON.stringify([data.picture,data.crop,regions.map(function(r){return [r.paperBox||r.box,r.role];})]);
    var picture=_sheetBackgrounds.get(key);
    if(!picture){
      var original=document.createElement('canvas');original.width=source.width;original.height=source.height;
      original.getContext('2d').drawImage(source.picture,source.x,source.y,source.width,source.height,0,0,source.width,source.height);
      picture=document.createElement('canvas');picture.width=source.width;picture.height=source.height;
      var background=picture.getContext('2d');background.drawImage(original,0,0);
      regions.forEach(function (region) {
        var box=(region.paperBox||region.box).slice();
        if(region.role==='heading'){box[0]-=4/source.width;box[2]+=8/source.width;}
        restoreOrderPaper(background,original,box,region.role==='heading'?'ruled':region.role==='ability'?'parchment':'paper');
      });
      _sheetBackgrounds.set(key,picture);
    }
    return picture;
  }

  async function drawFactionSheet(data, ctx) {
    var regions=sheetRegions(data);
    var picture=data.template?.preparedSheet?canvasPicture((await sourceInfo({src:data.picture,text:{crop:data.crop}})).picture):await prepareSheetBackground(data);
    ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
    ctx.drawImage(picture,0,0,canvasSize(ctx).width,canvasSize(ctx).height);
    regions.forEach(function (region) {
      if (region.role === 'ability') {
        var b=region.box,inset=b[2]*.035;
        // Some source illustrations intrude into the panel; their explicit
        // paper/body boxes keep both erasure and translated ink above the art.
        var field=function (y,h) {return [b[0]+inset,b[1]+b[3]*y,b[2]-inset*2,b[3]*h];};
        drawLabel(ctx,data.sheet.title,{box:field(.065,.14),align:'center'},'heading');
        var body=drawTextRegion(ctx,{box:region.bodyBox||field(.32,.65),value:data.sheet.abilities.map(function (a) {return a.title+': '+a.text;}).join(' *newpara* '),
          role:'ability',abilities:data.sheet.abilities,font:FONT.body,prose:true,transparent:true,size:.019,paragraphGap:.4},data.wording);
        drawTextRegion(ctx,{box:field(.215,.09),value:data.sheet.subtitle,role:'subheading',font:FONT.body,prose:true,weight:'normal',
          transparent:true,align:'center',valign:'center',size:Math.min(.018,body.fontSize/canvasSize(ctx).height)},data.wording);
      } else if(region.role==='heading'){
        if(region.wrap)drawTextRegion(ctx,Object.assign({},region,{transparent:true,valign:'center'}),data.wording);
        else {
          var box=region.box.slice();box[1]+=box[3]*.16;box[3]*=.68;
          drawLabel(ctx,region.value,{box:box,align:'center'},'heading');
        }
      } else if(region.role==='lore'){
        var parts=region.value.split(/\s*\*newpara\*\s*/),signature=parts.pop(),box=region.box;
        drawTextRegion(ctx,Object.assign({},region,{box:[box[0],box[1],box[2],box[3]*.75],value:parts.join(' *newpara* '),
          font:FONT.body,prose:true,weight:'italic',transparent:true,paragraphGap:.4}),data.wording);
        drawTextRegion(ctx,{box:[box[0],box[1]+box[3]*.78,box[2],box[3]*.22],value:signature,role:'signature',align:'right',valign:'center',
          font:FONT.body,prose:true,weight:'italic',transparent:true,size:region.size},data.wording);
      } else {
        drawTextRegion(ctx,Object.assign({},region,{transparent:true,font:FONT.body,prose:true,weight:'italic',paragraphGap:.3}),data.wording);
      }
    });
  }

  // Recover blank grain from the same field instead of painting a flat rectangle.
  // The shared nameplate layout reserves unprinted top and side gutters. Their
  // broad shading and paper grain reconstruct the background independently of
  // the old wording, without detecting ink or stretching a row into stripes.
  function restoreNativeLabel(ctx,picture,box,layerOnly) {
    var x=box[0]*picture.width,y=box[1]*picture.height,w=box[2]*picture.width,h=box[3]*picture.height;
    var layer=document.createElement('canvas');layer.width=Math.ceil(w);layer.height=Math.ceil(h);
    var c=layer.getContext('2d',{willReadFrequently:true}),width=layer.width,height=layer.height;
    c.drawImage(picture,x,y,w,h,0,0,width,height);
    var source=c.getImageData(0,0,width,height).data,clean=c.createImageData(width,height);
    var top=Math.max(1,Math.floor(height*LABEL_LAYOUT.paddingY)),side=Math.max(1,Math.floor(width*LABEL_LAYOUT.paddingX));
    var radius=Math.max(1,Math.floor(height/4)),tone=[],rows=[],vertical=[],reference=[0,0,0];
    for(var xx=0;xx<width;xx++){
      tone[xx]=[0,0,0];
      for(var yy=0;yy<top;yy++)for(var channel=0;channel<3;channel++)tone[xx][channel]+=source[(yy*width+xx)*4+channel]/top;
    }
    for(var xx=width-side;xx<width;xx++)for(var channel=0;channel<3;channel++)reference[channel]+=tone[xx][channel]/side;
    for(var yy=0;yy<height;yy++){
      rows[yy]=[0,0,0];
      for(var xx=width-side;xx<width;xx++)for(var channel=0;channel<3;channel++)rows[yy][channel]+=source[(yy*width+xx)*4+channel]/side;
    }
    for(var yy=0;yy<height;yy++){
      var first=Math.max(0,yy-radius),last=Math.min(height-1,yy+radius);vertical[yy]=[0,0,0];
      for(var sy=first;sy<=last;sy++)for(var channel=0;channel<3;channel++)vertical[yy][channel]+=rows[sy][channel]/(last-first+1);
    }
    for(var xx=0;xx<width;xx++){
      var first=Math.max(0,xx-radius),last=Math.min(width-1,xx+radius),shade=[0,0,0];
      for(var sx=first;sx<=last;sx++)for(var channel=0;channel<3;channel++)shade[channel]+=tone[sx][channel]/(last-first+1);
      for(var yy=0;yy<height;yy++){
        // Redistribute the native fine grain deterministically. A repeated
        // gutter would turn its lighting gradient into visible vertical bands.
        var seed=((xx+1)*73856093^(yy+1)*19349663)>>>0,gy=Math.floor(seed/side)%height;
        var target=(yy*width+xx)*4,grain=(gy*width+width-side+seed%side)*4;
        for(var channel=0;channel<3;channel++)clean.data[target+channel]=shade[channel]+vertical[yy][channel]-reference[channel]+source[grain+channel]-rows[gy][channel];
        clean.data[target+3]=255;
      }
    }
    c.putImageData(clean,0,0);
    var feather=Math.max(1,Math.min(w*LABEL_LAYOUT.paddingX,h*LABEL_LAYOUT.paddingY));
    if(layerOnly)return {picture:layer,featherPx:feather};
    featherEdges(layer,feather);
    ctx.drawImage(layer,box[0]*canvasSize(ctx).width,box[1]*canvasSize(ctx).height,box[2]*canvasSize(ctx).width,box[3]*canvasSize(ctx).height);
  }

  function eraseNativeField(ctx,picture,box,preserveGrain) {
    var crop=document.createElement('canvas');crop.width=Math.max(1,Math.round(box[2]*picture.width));crop.height=Math.max(1,Math.round(box[3]*picture.height));
    var c=crop.getContext('2d',{willReadFrequently:true});
    c.drawImage(picture,box[0]*picture.width,box[1]*picture.height,box[2]*picture.width,box[3]*picture.height,0,0,crop.width,crop.height);
    var pixels=c.getImageData(0,0,crop.width,crop.height).data;
    if(preserveGrain){
      // Remove ink only. Keep the original grain and each coloured scan line;
      // a repeated tile would add stripes or a differently coloured rectangle.
      var mask=new Uint8Array(crop.width*crop.height),rows=[];
      for(var y=0;y<crop.height;y++){
        var row=[];
        for(var x=0;x<crop.width;x++){var i=(y*crop.width+x)*4;row.push({i:i,light:(pixels[i]+pixels[i+1]+pixels[i+2])/3});}
        row.sort(function(a,b){return a.light-b.light;});
        var paper=row[Math.floor(row.length*.75)];rows[y]=[pixels[paper.i],pixels[paper.i+1],pixels[paper.i+2]];
        row.forEach(function(p){if(p.light<paper.light-25)mask[p.i/4]=1;});
      }
      var clean=c.createImageData(crop.width,crop.height);clean.data.set(pixels);
      for(var y=0;y<crop.height;y++)for(var x=0;x<crop.width;x++){
        var ink=false;
        // Include JPEG fringes around the old letter, not just its dark centre.
        for(var yy=Math.max(0,y-2);yy<=Math.min(crop.height-1,y+2);yy++)
          for(var xx=Math.max(0,x-2);xx<=Math.min(crop.width-1,x+2);xx++)if(mask[yy*crop.width+xx])ink=true;
        if(ink){var i=(y*crop.width+x)*4;for(var channel=0;channel<3;channel++)clean.data[i+channel]=rows[y][channel];}
      }
      c.putImageData(clean,0,0);
      ctx.drawImage(crop,box[0]*canvasSize(ctx).width,box[1]*canvasSize(ctx).height,box[2]*canvasSize(ctx).width,box[3]*canvasSize(ctx).height);
      return;
    }
    var size=Math.max(2,Math.min(14,Math.floor(crop.height*.18),Math.floor(crop.width*.04))),best={score:Infinity,x:0,y:0};
    for(var y=0;y<=crop.height-size;y+=size)for(var x=0;x<=crop.width-size;x+=size){
      var sum=0,squares=0,dark=0;
      for(var yy=y;yy<y+size;yy++)for(var xx=x;xx<x+size;xx++){
        var i=(yy*crop.width+xx)*4,light=(pixels[i]+pixels[i+1]+pixels[i+2])/3;
        sum+=light;squares+=light*light;if(light<100)dark++;
      }
      var count=size*size,mean=sum/count,score=dark/count*10000+squares/count-mean*mean+Math.max(0,180-mean)*3;
      if(score<best.score)best={score:score,x:x,y:y};
    }
    var tile=document.createElement('canvas');tile.width=tile.height=size;
    tile.getContext('2d').drawImage(crop,best.x,best.y,size,size,0,0,size,size);
    c.fillStyle=c.createPattern(tile,'repeat');c.fillRect(0,0,crop.width,crop.height);
    ctx.drawImage(crop,box[0]*canvasSize(ctx).width,box[1]*canvasSize(ctx).height,box[2]*canvasSize(ctx).width,box[3]*canvasSize(ctx).height);
  }

  // Rebuild the complete order field from its unprinted margins. Inpainting
  // only dark letters leaves grey dice, JPEG fringes and scattered ink behind.
  function restoreCleanOrderPaper(ctx,picture,box) {
    var crop=document.createElement('canvas');crop.width=Math.round(box[2]*picture.width);crop.height=Math.round(box[3]*picture.height);
    var c=crop.getContext('2d',{willReadFrequently:true}),w=crop.width,h=crop.height;
    c.drawImage(picture,box[0]*picture.width,box[1]*picture.height,box[2]*picture.width,box[3]*picture.height,0,0,w,h);
    var source=c.getImageData(0,0,w,h),pixels=source.data,clean=c.createImageData(w,h);
    var gutter=Math.max(2,Math.round(w*.025)),bevel=Math.max(1,Math.round(Math.min(w,h)*.05)),palette=[];
    function color(x,y){var at=(y*w+x)*4;return [pixels[at],pixels[at+1],pixels[at+2]];}
    function light(rgb){return (rgb[0]+rgb[1]+rgb[2])/3;}
    for(var y=0;y<h-bevel;y++)for(var x=0;x<gutter;x++){
      [color(x,y),color(w-1-x,y)].forEach(function(rgb){if(light(rgb)>140)palette.push(rgb);});
    }
    if(!palette.length)throw new Error('Не найдена чистая бумага приказа');
    function sample(values){
      values=values.filter(function(rgb){return light(rgb)>140;});
      if(!values.length)values=palette;
      values.sort(function(a,b){return light(a)-light(b);});
      return values[Math.floor(values.length*.75)];
    }
    var left=[],right=[],top=[],bottom=[],grain=[];
    for(var y=0;y<h;y++){
      var sy=Math.min(y,h-1-bevel),a=[],b=[];
      for(var x=0;x<gutter;x++){a.push(color(x,sy));b.push(color(w-1-x,sy));}
      left[y]=sample(a);right[y]=sample(b);
      [a,b].forEach(function(values,side){var tone=side?right[y]:left[y];values.forEach(function(rgb){
        if(light(rgb)>140)grain.push(rgb.map(function(value,channel){return Math.max(-5,Math.min(5,value-tone[channel]));}));
      });});
    }
    for(var x=0;x<w;x++){
      var a=[],b=[],sx=Math.max(bevel,Math.min(w-1-bevel,x));
      for(var y=0;y<gutter;y++){a.push(color(x,y));b.push(color(sx,h-1-y));}
      top[x]=sample(a);bottom[x]=sample(b);
    }
    function smooth(row,start,end){
      var radius=Math.max(2,Math.round(w*.035)),result=[];
      for(var x=0;x<w;x++){
        var a=Math.max(0,x-radius),b=Math.min(w-1,x+radius),rgb=[0,0,0];
        for(var at=a;at<=b;at++)for(var channel=0;channel<3;channel++)rgb[channel]+=row[at][channel]/(b-a+1);
        result.push(rgb);
      }
      var first=result[0].slice(),last=result[w-1].slice();
      return result.map(function(rgb,x){var u=x/(w-1);return rgb.map(function(value,channel){return value+(1-u)*(start[channel]-first[channel])+u*(end[channel]-last[channel]);});});
    }
    top=smooth(top,left[0],right[0]);bottom=smooth(bottom,left[h-1],right[h-1]);
    for(var y=0;y<h;y++)for(var x=0;x<w;x++){
      var u=x/(w-1),v=y/(h-1),at=(y*w+x)*4,seed=((x+1)*73856093^(y+1)*19349663)>>>0;
      var noise=grain[seed%grain.length],corner=y>=h-bevel&&(x<y-h+bevel||w-1-x<y-h+bevel);
      for(var channel=0;channel<3;channel++){
        var corners=(1-u)*(1-v)*top[0][channel]+u*(1-v)*top[w-1][channel]+(1-u)*v*bottom[0][channel]+u*v*bottom[w-1][channel];
        var shade=(1-v)*top[x][channel]+v*bottom[x][channel]+(1-u)*left[y][channel]+u*right[y][channel]-corners;
        clean.data[at+channel]=corner?pixels[at+channel]:shade+noise[channel];
      }
      clean.data[at+3]=255;
    }
    c.putImageData(clean,0,0);
    ctx.drawImage(crop,box[0]*canvasSize(ctx).width,box[1]*canvasSize(ctx).height,box[2]*canvasSize(ctx).width,box[3]*canvasSize(ctx).height);
  }

  // The order frame leaves clean paper on the rules field's four edges.
  // Interpolate that shading and reuse its fine grain, rather than selecting a
  // bright tile from the wording. The field stays opaque over the old text;
  // matching its native edges avoids both a coloured rectangle and ink ghosts.
  function restoreOrderPaper(ctx,picture,box,sheetStyle) {
    if(sheetStyle==='order'){restoreCleanOrderPaper(ctx,picture,box);return;}
    var crop=document.createElement('canvas');
    crop.width=Math.max(2,Math.round(box[2]*picture.width));crop.height=Math.max(2,Math.round(box[3]*picture.height));
    var c=crop.getContext('2d',{willReadFrequently:true}),w=crop.width,h=crop.height;
    c.drawImage(picture,box[0]*picture.width,box[1]*picture.height,box[2]*picture.width,box[3]*picture.height,0,0,w,h);
    var source=c.getImageData(0,0,w,h),pixels=source.data,clean=c.createImageData(w,h);
    var radius=Math.max(1,Math.round(Math.min(w,h)*.05)),grain=[];
    function edge(length,index) {
      var raw=new Float32Array(length*3),smooth=new Float32Array(length*3);
      for(var n=0;n<length;n++)for(var channel=0;channel<3;channel++)raw[n*3+channel]=pixels[index(n)+channel];
      for(var n=0;n<length;n++){
        var first=Math.max(0,n-radius),last=Math.min(length-1,n+radius);
        for(var at=first;at<=last;at++)for(var channel=0;channel<3;channel++)smooth[n*3+channel]+=raw[at*3+channel]/(last-first+1);
        var previous=Math.max(0,n-1)*3,next=Math.min(length-1,n+1)*3;
        grain.push([0,1,2].map(function(channel){return (2*raw[n*3+channel]-raw[previous+channel]-raw[next+channel])/4;}));
      }
      // Adjacent edges share their corner colours, so the interpolation meets
      // every boundary without a seam. Grain is kept separate from shading.
      for(var channel=0;channel<3;channel++){
        var start=raw[channel]-smooth[channel],end=raw[(length-1)*3+channel]-smooth[(length-1)*3+channel];
        for(var n=0;n<length;n++)smooth[n*3+channel]+=(1-n/(length-1))*start+n/(length-1)*end;
      }
      return smooth;
    }
    // The paper's lower corners meet the bevelled frame. Sample inside those
    // corners and leave their native pixels in place, rather than spreading
    // the dark frame across the bottom of the rules panel.
    var top=edge(w,function(n){return n*4;}),bottom=edge(w,function(n){return ((h-1)*w+Math.max(radius,Math.min(w-1-radius,n)))*4;});
    var left=edge(h,function(n){return Math.min(h-1-radius,n)*w*4;}),right=edge(h,function(n){return (Math.min(h-1-radius,n)*w+w-1)*4;});
    for(var y=0;y<h;y++)for(var x=0;x<w;x++){
      var u=x/(w-1),v=y/(h-1),target=(y*w+x)*4;
      var seed=((x+1)*73856093^(y+1)*19349663)>>>0,noise=grain[seed%grain.length];
      var bevel=y>=h-radius && (x<y-h+radius || w-1-x<y-h+radius);
      for(var channel=0;channel<3;channel++){
        var corners=(1-u)*(1-v)*top[channel]+u*(1-v)*top[(w-1)*3+channel]+(1-u)*v*bottom[channel]+u*v*bottom[(w-1)*3+channel];
        var shade=(1-v)*top[x*3+channel]+v*bottom[x*3+channel]+(1-u)*left[y*3+channel]+u*right[y*3+channel]-corners;
        var low=Math.min(top[x*3+channel],bottom[x*3+channel],left[y*3+channel],right[y*3+channel]);
        var high=Math.max(top[x*3+channel],bottom[x*3+channel],left[y*3+channel],right[y*3+channel]);
        clean.data[target+channel]=(x===0||y===0||x===w-1||y===h-1||bevel)?pixels[target+channel]:
          Math.max(low,Math.min(high,shade))+noise[channel];
      }
      clean.data[target+3]=255;
    }
    if(sheetStyle){
      // Retain the source's unprinted texture and stains. Only the old dark
      // lettering and its JPEG fringe receive nearby clean paper.
      var mask=new Uint8Array(w*h),ruledPaper=sheetStyle==='ruled';
      var paperRows=[],paperColors=[],gutter=Math.max(1,Math.floor(w*.02));
      var inkGutter=sheetStyle==='paper'?0:gutter;
      for(var y=0;y<h;y++){
        var row=[];
        for(var x=gutter;x<w-gutter;x++)row.push({at:(y*w+x)*4,light:(pixels[(y*w+x)*4]+pixels[(y*w+x)*4+1]+pixels[(y*w+x)*4+2])/3});
        row.sort(function(a,b){return a.light-b.light;});var sample=row[Math.floor(row.length*.85)];
        paperRows[y]=sample.light;paperColors[y]=[pixels[sample.at],pixels[sample.at+1],pixels[sample.at+2]];
      }
      for(var at=0;at<w*h;at++){
        var i=at*4,light=(pixels[i]+pixels[i+1]+pixels[i+2])/3;
        var neutral=sheetStyle==='paper'||Math.max(pixels[i],pixels[i+1],pixels[i+2])-Math.min(pixels[i],pixels[i+1],pixels[i+2])<35;
        if(neutral&&light<Math.min(110,paperRows[Math.floor(at/w)]-35)&&at%w>=inkGutter&&at%w<w-inkGutter)mask[at]=1;
      }
      if(ruledPaper||sheetStyle==='event'){
        // Native trim and dark event-paper edges reach the field boundary.
        // Keep those components while removing isolated printed letters.
        var visited=new Uint8Array(w*h);
        for(var start=0;start<w*h;start++)if(mask[start]&&!visited[start]){
          var component=[start],first=w,last=0,touches=false;visited[start]=1;
          for(var pos=0;pos<component.length;pos++){
            var at=component[pos],x=at%w,y=Math.floor(at/w);first=Math.min(first,x);last=Math.max(last,x);touches=touches||x===gutter||x===w-1-gutter||sheetStyle==='event'&&(y===0||y===h-1);
            [x?at-1:-1,x+1<w?at+1:-1,y?at-w:-1,y+1<h?at+w:-1].forEach(function(next){if(next>=0&&mask[next]&&!visited[next]){visited[next]=1;component.push(next);}});
          }
          if(touches&&(sheetStyle==='event'||last-first<Math.max(2,gutter*2)))component.forEach(function(at){mask[at]=0;});
        }
      }
      var expanded=new Uint8Array(w*h);
      var fringe=sheetStyle==='ruled'?5:sheetStyle==='paper'?4:3;
      for(var y=0;y<h;y++)for(var x=0;x<w;x++){
        for(var yy=Math.max(0,y-fringe);!expanded[y*w+x]&&yy<=Math.min(h-1,y+fringe);yy++)
          for(var xx=Math.max(0,x-fringe);xx<=Math.min(w-1,x+fringe);xx++)if(mask[yy*w+xx]){expanded[y*w+x]=1;break;}
      }
      // Normalized convolution excludes the old ink instead of blurring it
      // into the replacement. Three box passes give smooth local shading;
      // unmasked paper and stains retain their exact native pixels.
      var weighted=new Float32Array(w*h*4),scratch=new Float32Array(w*h*4);
      for(var at=0;at<w*h;at++)if(!expanded[at]&&at%w>=gutter&&at%w<w-gutter){
        for(var channel=0;channel<3;channel++)weighted[at*4+channel]=pixels[at*4+channel];weighted[at*4+3]=1;
      }
      function blur(from,to,horizontal){
        var length=horizontal?w:h,lines=horizontal?h:w,radius=16,divisor=radius*2+1;
        for(var line=0;line<lines;line++){
          var sum=[0,0,0,0],index=function(n){return (horizontal?line*w+n:n*w+line)*4;};
          for(var n=0;n<=Math.min(radius,length-1);n++)for(var channel=0;channel<4;channel++)sum[channel]+=from[index(n)+channel];
          for(var n=0;n<length;n++){
            for(var channel=0;channel<4;channel++)to[index(n)+channel]=sum[channel]/divisor;
            for(var channel=0;channel<4;channel++){
              if(n+radius+1<length)sum[channel]+=from[index(n+radius+1)+channel];
              if(n-radius>=0)sum[channel]-=from[index(n-radius)+channel];
            }
          }
        }
      }
      for(var pass=0;pass<3;pass++){blur(weighted,scratch,true);blur(scratch,weighted,false);}
      var distance=new Uint16Array(w*h);distance.fill(w+h);
      for(var y=0;y<h;y++)for(var x=0;x<w;x++)distance[y*w+x]=expanded[y*w+x]?0:Math.min(x?distance[y*w+x-1]+1:w+h,y?distance[(y-1)*w+x]+1:w+h);
      for(var y=h-1;y>=0;y--)for(var x=w-1;x>=0;x--)distance[y*w+x]=Math.min(distance[y*w+x],x+1<w?distance[y*w+x+1]+1:w+h,y+1<h?distance[(y+1)*w+x]+1:w+h);
      clean.data.set(pixels);
      for(var at=0;at<w*h;at++)if(expanded[at]||!ruledPaper&&distance[at]<8){
        var x=at%w,y=Math.floor(at/w),left=x-1,right=x+1;
        if(ruledPaper){
          while(left>=0&&expanded[y*w+left])left--;
          while(right<w&&expanded[y*w+right])right++;
        }
        var ruled=ruledPaper&&left>=gutter&&right<w-gutter;
        if(ruled){
          var leftLight=(pixels[(y*w+left)*4]+pixels[(y*w+left)*4+1]+pixels[(y*w+left)*4+2])/3;
          var rightLight=(pixels[(y*w+right)*4]+pixels[(y*w+right)*4+1]+pixels[(y*w+right)*4+2])/3;
          ruled=Math.min(leftLight,rightLight)>paperRows[y]-35;
        }
        if(weighted[at*4+3]<.00001&&!ruledPaper)throw new Error('Не найден чистый фон листа фракции');
        var noise=grain[at%grain.length];
        for(var channel=0;channel<3;channel++){
          var shade=weighted[at*4+channel]/weighted[at*4+3];
          if(ruled)shade=(pixels[(y*w+left)*4+channel]*(right-x)+pixels[(y*w+right)*4+channel]*(x-left))/(right-left);
          else if(ruledPaper)shade=paperColors[y][channel];
          var alpha=expanded[at]?1:1-distance[at]/8;
          clean.data[at*4+channel]=pixels[at*4+channel]*(1-alpha)+(shade+Math.max(-2,Math.min(2,noise[channel])))*alpha;
        }
      }
    }
    c.putImageData(clean,0,0);
    ctx.drawImage(crop,box[0]*canvasSize(ctx).width,box[1]*canvasSize(ctx).height,box[2]*canvasSize(ctx).width,box[3]*canvasSize(ctx).height);
  }

  async function drawRasterTranslation(data, ctx) {
    var picture = await loadImage(data.picture);
    ctx.drawImage(picture, 0, 0, canvasSize(ctx).width, canvasSize(ctx).height);
    if (data.kind === 'combat' && !data.regions) {
      var titleBox=FIELDS.raster.combat.title;
      restoreNativeLabel(ctx,picture,titleBox);
      drawLabel(ctx,data.title,rasterTitleField('combat'),'title');
      var panels = await Promise.all([
        loadImage('pictures/background.png'), loadImage('pictures/foreground.png'), loadImage('pictures/bottom.png'),
      ]);
      var bottomH = drawCombatEffects(data, ctx, panels, combatSourceArea(picture));
      ctx.drawImage(panels[2], 0, 0, panels[2].width, panels[2].height,
        0, ctx.fsCombatBottom - bottomH, canvasSize(ctx).width, bottomH);
      return;
    }
    if(data.regions){data.regions.forEach(function(region){drawTextRegion(ctx,region,data.wording);});return;}
    var clean=await prepareBakedPicture(data);
    if(data.kind==='orders')return drawOrderCard(clean,ctx);
    return drawEventCard(clean,ctx);
  }

  // Prepared native combat keeps its baked symbols and measured source area.
  // Wording remains editable and the shared effect panels still fit it at runtime.
  async function drawPreparedCombat(data,ctx) {
    var picture=await loadCardPicture(data),cw=canvasSize(ctx).width,ch=canvasSize(ctx).height;
    ctx.drawImage(picture,0,0,cw,ch);
    if(data.template.titleLayer){
      var label=canvasPicture(await loadImage(data.template.titleLayer),data.template.titleLayerFeatherPx),box=data.template.titleLayerBox;
      ctx.drawImage(label,box[0]*cw,box[1]*ch,box[2]*cw,box[3]*ch);
    }
    drawLabel(ctx,data.title,data.template.titleRegion,'title');
    var panels=await Promise.all([loadImage('pictures/background.png'),loadImage('pictures/foreground.png'),loadImage('pictures/bottom.png')]);
    var bottomH=drawCombatEffects(data,ctx,panels,data.template.nativeCombatArea);
    ctx.drawImage(panels[2],0,0,panels[2].width,panels[2].height,0,ctx.fsCombatBottom-bottomH,cw,bottomH);
  }

  // Offline preparation entry point. Canonical runtime records never carry the
  // patch recipes; legacy callers retain the old compatibility path above.
  async function prepareBackground(card) {
    var data={picture:card.artSrc||card.src,kind:card.kind,template:card.template,
      crop:card.text?.crop,regions:card.text?.regions,sheet:card.text?.sheet,side:card.text?.side};
    var picture,template={},profile=card.kind,assetKind='background';
    if(card.kind==='sheet') {
      picture=await prepareSheetBackground(data);template={crop:[0,0,1,1],preparedSheet:true};
    } else if(card.template?.patches?.length) {
      picture=await loadCardPicture(data);
      template.body=textField(data,card.kind);template.titleRegion=labelField(data,card.kind);
      if(card.kind==='events') {
        var type=card.template.patches.find(function(p){return p.role==='event-type';});
        template.eventType=card.template.eventType||{box:type?type.box:FIELDS.events.type};
      }
    } else if(card.text?.raster&&card.kind==='combat') {
      var original=await loadImage(data.picture),area=combatSourceArea(original);
      var label=restoreNativeLabel(null,original,FIELDS.raster.combat.title,true);picture=label.picture;
      template={titleRegion:rasterTitleField('combat'),titleLayerBox:FIELDS.raster.combat.title,titleLayerFeatherPx:label.featherPx,nativeCombatArea:area};
      profile='native-combat';assetKind='label-layer';
    } else if(card.text?.raster&&['orders','events'].includes(card.kind)) {
      var clean=await prepareBakedPicture(data);picture=clean.preparedPicture;template=clean.template;
    } else throw new Error('No offline preparation required: '+card.id);
    if(card.kind==='sheet'||card.template?.patches?.length||card.text?.raster&&['orders','events'].includes(card.kind))template.sampling='canvas';
    return {png:picture.toDataURL('image/png'),width:picture.width,height:picture.height,template:template,profile:profile,assetKind:assetKind};
  }

  var DRAW = { combat: drawCombatCard, orders: drawOrderCard, events: drawEventCard, overlay: drawRasterTranslation, sheet: drawFactionSheet };

  // Ensure the custom fonts are loaded before measuring/drawing text.
  var _fontsReady;
  function loadFont(name, style) {
    return new Promise(function (resolve, reject) {
      if (!document.fonts) { reject(new Error('Браузер не поддерживает проверку шрифтов')); return; }
      var timer = setTimeout(function () { reject(new Error('Не завершена загрузка шрифта ' + name)); }, 15000);
      var descriptor=(style?style+' ':'')+'16px '+name;
      document.fonts.load(descriptor).then(function (faces) {
        clearTimeout(timer);
        if (!faces.length || !document.fonts.check(descriptor)) reject(new Error('Не загружен шрифт ' + name));
        else resolve();
      }, function (error) { clearTimeout(timer); reject(error); });
    });
  }
  function loadFonts() {
    return Promise.all(Array.from(new Set(Object.values(FONT))).map(function(name){return loadFont(name);})
      .concat(['italic','bold','bold italic'].map(function(style){return loadFont(FONT.body,style);})));
  }
  function fontsReady() {
    if (_fontsReady) return _fontsReady;
    _fontsReady = loadFonts().catch(function (error) {
      _fontsReady = null;
      throw error;
    });
    return _fontsReady;
  }

  var _composed = window.FSCache.create(32);

  // Diagnostics and print legibility use output pixels. Keep layout decisions
  // in logical units and convert only at this boundary; ink bounds already
  // include the canvas transform recorded by recordInk().
  function outputMetrics(ctx) {
    var sx=ctx.canvas.width/ctx.fsLayout.width,sy=ctx.canvas.height/ctx.fsLayout.height;
    var scaled=function (value,scale) {
      if(!value)return value;
      var result=Object.assign({},value);
      Object.keys(result).forEach(function(key){if(typeof result[key]==='number')result[key]*=scale;});
      return result;
    };
    var box=function (value) {return Object.assign({},value,{x:value.x*sx,y:value.y*sy,width:value.width*sx,height:value.height*sy});};
    var metrics={minimumBodyPx:ctx.fsMinimumBodyPx===undefined?undefined:ctx.fsMinimumBodyPx*sy,textLines:ctx.fsTextLines};
    if(ctx.fsCombatPanels)metrics.combatPanels=Object.assign(scaled(ctx.fsCombatPanels,sy),{
      general:scaled(ctx.fsCombatPanels.general,sy),unit:scaled(ctx.fsCombatPanels.unit,sy)});
    if(ctx.fsCombatArtwork){
      metrics.artwork=scaled(ctx.fsCombatArtwork,sy);
      if(ctx.fsCombatArtwork.nativeFrame){
        var frame=ctx.fsCombatArtwork.nativeFrame;
        metrics.artwork.nativeFrame=Object.assign({},frame,{topPx:frame.topPx*sy,bottomPx:frame.bottomPx*sy});
      }
    }
    if(ctx.fsCombatIcons)metrics.combatIcons=ctx.fsCombatIcons.map(function(icon){return {symbol:icon.symbol,x:icon.x*sx,y:icon.y*sy,size:icon.size*sx};});
    if(ctx.fsEventType)metrics.eventType=Object.assign({},ctx.fsEventType,{box:box(ctx.fsEventType.box)});
    if(ctx.fsBodyTextBox)metrics.bodyTextBox=Object.assign(scaled(ctx.fsBodyTextBox,sy),{box:box(ctx.fsBodyTextBox.box)});
    if(ctx.fsOrderFooter)metrics.orderFooter=Object.assign(scaled(ctx.fsOrderFooter,sy),{box:box(ctx.fsOrderFooter.box)});
    if(ctx.fsTokenImageBounds)metrics.tokenImages=ctx.fsTokenImageBounds.map(box);
    if(ctx.fsTokenRotations)metrics.tokenRotations=ctx.fsTokenRotations;
    return metrics;
  }

  function compose(card, options) {
    options = options || {};
    var sheet=card.kind==='sheet';
    var width = options.width || card.width || (sheet?SHEET_SIZE.width:maxWidth), height = options.height || card.height;
    if(sheet){
      // Correct the source's proportions before drawing translated glyphs.
      // Explicit dimensions are bounds; a sheet always keeps its common shape.
      var ratio=SHEET_SIZE.width/SHEET_SIZE.height;
      if(height)width=options.width||card.width?Math.min(width,height*ratio):height*ratio;
      width=Math.round(width);height=Math.round(width/ratio);
    }
    if(card.renderMode==='raster')return sourceInfo(card).then(function (source) {
      if(!sheet&&!card.text?.crop)return card.artSrc || card.src;
      if(sheet&&(!Number.isFinite(width)||!Number.isFinite(height)||width<1||height<1||width>16384||height>16384))throw new Error('Некорректный размер изображения листа');
      var canvas=document.createElement('canvas');canvas.width=sheet?width:source.width;canvas.height=sheet?height:source.height;
      canvas.getContext('2d').drawImage(source.picture,source.x,source.y,source.width,source.height,0,0,canvas.width,canvas.height);
      return canvas.toDataURL('image/png');
    });
    // Capture dimensions before asynchronous work. Printing never changes view resolution.
    var bounded=!sheet && !options.width && !card.width;
    var strict = !!options.strict;
    var rejectOnError = strict || !!options.rejectOnError;
    var wording = card.wording || 'images';
    var thumbnail = !strict && !!card.thumbnail;
    var cacheable=!strict && !options.onMetrics;
    var picture = card.artSrc || card.template?.picture || (strict ? card.src : (card.picture || card.src));
    var artwork = card.kind==='combat' && !card.artSrc && card.template && card.template.artwork;
    var key = JSON.stringify([card.src, picture, width, height, wording, thumbnail, rejectOnError, artwork, card.text, card.template]);
    var cached = cacheable && _composed.get(key);
    if (cached) return cached;
    var fn = card.text && card.text.raster ? drawRasterTranslation : DRAW[card.kind];
    if (rejectOnError && (!fn || !card.text || !card.text.title)) return Promise.reject(new Error('Нет русского текста: ' + card.src));
    if(rejectOnError && ['combat','orders','events'].includes(card.kind) && !(card.text.background||card.text.foreground||card.text.general))return Promise.reject(new Error('Нет русского текста правил: '+card.src));
    if (!fn || !card.text) return Promise.resolve(card.src);

    var fontReady = strict ? loadFonts() : fontsReady();
    // Fetch the source while fonts load; neither depends on the other.
    var ready = Promise.all([fontReady,sourceInfo(Object.assign({},card,{src:picture}))]);
    var result = ready.then(async function (resources) {
      var source=resources[1];
      if(!height){
        height=Math.round(width*source.height/source.width);
        if(bounded && height>maxHeight){width=Math.round(width*maxHeight/height);height=maxHeight;}
      }
      if(!Number.isFinite(width)||!Number.isFinite(height)||width<1||height<1||width>16384||height>16384)throw new Error('Некорректный размер изображения карты');
      var canvas = document.createElement('canvas');
      canvas.width  = width;
      canvas.height = height;
      var ctx = canvas.getContext('2d');
      // Sheet labels can be only a few pixels high in the card-sized layout.
      // Native logical coordinates avoid rounding their measured ink down by
      // a whole font size, while remaining independent of output resolution.
      var logicalWidth=sheet?Math.max(SHEET_SIZE.width,source.width):layoutWidth;
      ctx.fsLayout={width:logicalWidth,height:sheet?logicalWidth*SHEET_SIZE.height/SHEET_SIZE.width:logicalWidth*source.height/source.width};
      ctx.scale(canvas.width/ctx.fsLayout.width,canvas.height/ctx.fsLayout.height);
      ctx.imageSmoothingQuality='high';
      ctx.fsStrict = strict;
      ctx.fsCollectMetrics=!!options.onMetrics;
      ctx.fsTextLines=[];ctx.fsKind=card.kind;
      var format = function (text) { return window.FSWord.format(text, wording); };
      var data = {
        template:   card.template,
        artwork:    artwork,
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
        crop:       card.template?.crop || card.text.crop,
        sheet:      card.text.sheet,
        side:       card.text.side,
        wording:    wording,
      };
      if (wording === 'images') {
        var formatted = format(JSON.stringify(card.text));
        var used = window.FSWord.tokens.filter(function (token) { return formatted.indexOf(token.glyph) !== -1; });
        ctx.fsTokenImages = {}; ctx.fsTokenImageBounds = [];
        await Promise.all(used.map(async function (token) {
          ctx.fsTokenImages[token.glyph] = await loadImage(token.image);
        }));
      }
      return fn(data, ctx).then(function () {
        if (options.onMetrics) options.onMetrics(outputMetrics(ctx));
        return thumbnail ? canvas.toDataURL('image/jpeg', 0.84) : canvas.toDataURL('image/png');
      });
    }).catch(function (e) {
      if(cacheable && _composed.get(key)===result)_composed.delete(key);
      if (rejectOnError) throw e;
      console.error('compose failed for ' + card.src, e);
      return card.src;
    });
    // Large print rasters have a job lifetime; do not retain them in the view cache.
    if(cacheable)return _composed.set(key,result);
    if(!strict)return result;
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

  window.FSCardRender = { compose: compose, sourceInfo: sourceInfo, sheetSize:SHEET_SIZE, fontsReady: fontsReady, prepareBackground:prepareBackground, releasePreparationResources:function(){_imgCache.clear();_preparedPictures.clear();_sheetBackgrounds.clear();_sourceAreas.clear();_titleAreas.clear();_artworkAreas.clear();_composed.clear();}, setResolution: setResolution };
})();
