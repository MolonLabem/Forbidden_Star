/* Forbidden Stars — card text compositor.
 *
 * Some expansions ship card art as TEMPLATES with blank title/text areas; the
 * wording lives in text.json. This module draws that text onto the template
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
 *   Optional template: { picture?, patches:[{role?,box:[x,y,w,h],texture:{src,crop:[x,y,w,h]}}] }
 *   Combat pictures contain the frame, native badges and illustration, with
 *   blank title, combat-symbol rail and effect areas, just like SoW templates.
 *   Template coordinates are fractions of native images/canvas. Clean patches
 *   describe artwork erasure only. Text fields are derived from those patches;
 *   shared typography and measured text determine layout. Without an explicit
 *   output height, composition retains the source image's native proportions.
 *   Sheet text adds crop?, side, sheet:{title,subtitle,abilities}, regions?.
 *   Crops and regions describe native artwork; typography is measured here.
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

  // These are the empty fields in the artwork, not card-specific text sizes.
  // Erasure recipes may supply a smaller field; all wording is measured to fit.
  var FIELDS = {
    combat: {title:[.27,.025,.64,.065]},
    orders: {title:[.26,.18,.48,.067],body:[.145,.54,.71,.275]},
    events: {title:[.05,.025,.7,.065],body:[.0578,.685,.8844,.25],type:[.1,.533,.8,.055]},
    raster: {
      combat: {title:[.28,.075,.57,.063]},
      orders: {title:[.26,.205,.53,.052],body:[.155,.54,.69,.275]},
      events: {title:[.075,.052,.65,.046],body:[.08,.673,.84,.231],type:[.17,.525,.66,.047]},
    },
  };
  var FONT = {title:'Headline',type:'Headline',body:'ForbiddenStars'};

  function recordInk(ctx, text, x, y, role, align) {
    if(!ctx.fsStrict && !ctx.fsCollectMetrics)return;
    var ink=ctx.measureText(text),matrix=ctx.getTransform();
    var corners=[[x-ink.actualBoundingBoxLeft,y-ink.actualBoundingBoxAscent],
      [x+ink.actualBoundingBoxRight,y-ink.actualBoundingBoxAscent],
      [x-ink.actualBoundingBoxLeft,y+ink.actualBoundingBoxDescent],
      [x+ink.actualBoundingBoxRight,y+ink.actualBoundingBoxDescent]].map(function(p){return matrix.transformPoint({x:p[0],y:p[1]});});
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
    iconX:                   0.0552,
    iconStartY:              0.242,
  };

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
    var family = ctx.fsBodyFont || FONT.body;
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
      if (ci !== -1 && ctx.fsItalicPrefixes === true) {
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

    var lineAlign=align,lineRole=ctx.fsTextRole||'body';
    var renderLine = function (segments, yy) {
      var totalW = 0;
      for (var s = 0; s < segments.length; s++) totalW += measure(segments[s].text, segments[s].italic);
      ctx.fsMeasuredWidth=Math.max(ctx.fsMeasuredWidth||0,totalW);
      if (!paint) return;
      ctx.fsMinimumBodyPx = Math.min(ctx.fsMinimumBodyPx || Infinity, fontSize);
      if (ctx.fsStrict && (totalW > maxW + 1 || yy + fontSize * 0.2 > ctx.canvas.height)) {
        throw new Error('Текст выходит за границы печатной карты');
      }
      var left=align==='center'?x-maxW/2:x;
      var cx = lineAlign==='center' ? left+(maxW-totalW)/2 : left;
      for (var s = 0; s < segments.length; s++) {
        var seg = segments[s];
        ctx.font = seg.italic ? italicFont : baseFont;
        ctx.textAlign = 'left';
        recordInk(ctx,seg.text,cx,yy,lineRole,lineAlign);
        drawTokenText(ctx, seg.text, cx, yy, fontSize);
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
      var limit=ctx.fsKind==='orders' && /^ОДИН РАЗ ЗА РАУНД[.!]?$/i.test(p.trim());
      lineAlign=limit || p.trim()==='-или-'?'center':align;
      lineRole=limit?'limit':ctx.fsTextRole||'body';
      var tokens = buildTokens(p);
      var line = [];
      var lineWidth = 0;

      var pushWord = function (word, italic, glue, reserve) {
        var segText = (line.length === 0 || glue) ? word : (' ' + word);
        var w = measure(segText, italic);
        if (lineWidth + w + (reserve || 0) > maxW && line.length > 0) {
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
          // Keep a unit prefix and its colon together, even at the line edge.
          var reserve = tokens[ti + 1] && tokens[ti + 1].text === ':' && wi === words.length - 1 ? measure(':', false) : 0;
          pushWord(words[wi], t.italic, line.length === 0 || (t.glue && wi === 0), reserve);
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
    ctx.fsMeasuredWidth=0;
    return layoutStyledWrappedText(ctx, text, 0, 0, maxW, interline, fontSize, 'left', false);
  }

  function drawStyledWrappedText(ctx, text, x, y, maxW, interline, fontSize, align) {
    return layoutStyledWrappedText(ctx, text, x, y, maxW, interline, fontSize, align, true);
  }

  // Image tokens occupy the same advance and baseline as their font glyphs, so
  // switching style cannot change wrapping or effect-panel geometry.
  function drawTokenText(ctx, text, x, y, fontSize) {
    if (!ctx.fsTokenImages || !/[\uE100-\uE102]/.test(text)) {
      ctx.fillText(text, x, y); return;
    }
    text.split(/([\uE100-\uE102])/).forEach(function (part) {
      var image = ctx.fsTokenImages[part], advance = ctx.measureText(part).width;
      if (image) {
        var size = fontSize * 1996 / 2048;
        var left = x + (advance - size) / 2, top = y - fontSize * 1754 / 2048;
        ctx.drawImage(image, left, top, size, size);
        ctx.fsTokenImageBounds.push({ glyph: part, x: left, y: top, width: size, height: size });
      } else ctx.fillText(part, x, y);
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
  async function loadCardPicture(data) {
    if(data.preparedPicture)return data.preparedPicture;
    var picture = await loadImage(data.template?.picture || data.picture);
    if (!data.template?.patches?.length) return picture;
    var canvas = document.createElement('canvas');
    canvas.width = picture.width; canvas.height = picture.height;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(picture, 0, 0);
    for (var patch of data.template.patches || []) {
      var texture = await loadImage(patch.texture.src), crop = patch.texture.crop, box = patch.box;
      var layer=document.createElement('canvas');
      layer.width=Math.ceil(box[2]*canvas.width);layer.height=Math.ceil(box[3]*canvas.height);
      var layerCtx=layer.getContext('2d');
      if(patch.tile){
        var tile=document.createElement('canvas');tile.width=Math.ceil(crop[2]*texture.width);tile.height=Math.ceil(crop[3]*texture.height);
        tile.getContext('2d').drawImage(texture,crop[0]*texture.width,crop[1]*texture.height,
          crop[2]*texture.width,crop[3]*texture.height,0,0,tile.width,tile.height);
        layerCtx.fillStyle=layerCtx.createPattern(tile,'repeat');layerCtx.fillRect(0,0,layer.width,layer.height);
      }else layerCtx.drawImage(texture,crop[0]*texture.width,crop[1]*texture.height,
        crop[2]*texture.width,crop[3]*texture.height,0,0,layer.width,layer.height);
      var feather=Math.min(patch.featherPx||0,layer.width/4,layer.height/4);
      if(feather){
        layerCtx.globalCompositeOperation='destination-in';
        [[0,0,feather,0,false],[layer.width-feather,0,layer.width,0,true],
          [0,0,0,feather,false],[0,layer.height-feather,0,layer.height,true]].forEach(function(edge){
          var gradient=layerCtx.createLinearGradient(edge[0],edge[1],edge[2],edge[3]);
          gradient.addColorStop(0,edge[4]?'#000':'transparent');gradient.addColorStop(1,edge[4]?'transparent':'#000');
          layerCtx.fillStyle=gradient;layerCtx.fillRect(0,0,layer.width,layer.height);
        });
      }
      ctx.drawImage(layer,box[0]*canvas.width,box[1]*canvas.height,box[2]*canvas.width,box[3]*canvas.height);
    }
    return canvas;
  }

  async function sourceInfo(card) {
    var url=card.template?.picture || card.picture || card.src;
    if (card.text?.crop) {
      // A virtual side is route state, not a second bitmap. Both crops share
      // one decoded source (especially useful for large sheets on phones).
      var asset=new URL(url,document.baseURI);asset.searchParams.delete('side');url=asset.href;
    }
    var picture = await loadImage(url);
    var crop = card.text?.crop || [0,0,1,1];
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
      regions.push({box:[.404,.328,.218,.214],role:'ability'});
      add([.421,.601,.187,.028],'Жетоны целей',true,.027);
      add([.775,.087,.034,.019],'Город',true,.018);
      add([.906,.087,.037,.019],'Фабрика',true,.018);
      add([.777,.188,.155,.024],'Бастион',true,.021);
      sheet.units.forEach(function (value,index) {add([.777,.291+index*.1044,.155,.024],value,true,.02);});
    } else {
      add([.109,.286,.201,.032],'Стартовые силы',true,.03);
      add([.442,.224,.311,.31],sheet.lore,false,.022);
      var step=.522/sheet.initialForces.length;
      sheet.initialForces.forEach(function (value,index) {add([.194,.335+step*index,.116,step*.79],value,true,.025);});
      sheet.objectives.forEach(function (value,index) {
        if (value) add([index<3?.496:.779,.568+(index%3)*.097,.149,.067],value,false,.015);
      });
    }
    return regions;
  }

  var _sourceAreas=window.FSCache.create(32);
  var _titleAreas=window.FSCache.create(32);
  var _artworkAreas=window.FSCache.create(32);
  function extendArtwork(ctx,picture,panelTop) {
    var end=_artworkAreas.get(picture.src);
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
    var cw=ctx.canvas.width,ch=ctx.canvas.height;
    ctx.fsCombatArtwork={nativeBottomPx:end===null?ch:end*ch,paintedBottomPx:end===null?ch:end*ch,extended:false};
    if(end===null || panelTop<=end*ch+1)return;
    // Blank templates may contain only a cropped illustration. Cover the larger
    // measured artwork window; the original title, badge and left frame stay put.
    var left=.18,top=.13,sw=picture.width*(1-left),sh=picture.height*(end-top);
    var dw=cw*(1-left),dh=panelTop-ch*top,scale=Math.max(dw/sw,dh/sh),cropW=dw/scale,cropH=dh/scale;
    ctx.drawImage(picture,picture.width*left+(sw-cropW)/2,picture.height*top, cropW,cropH,cw*left,ch*top,dw,dh);
    ctx.drawImage(picture,0,picture.height*(end-.04),picture.width*left,picture.height*.04,0,ch*end,cw*left,panelTop-ch*end);
    ctx.fsCombatArtwork.paintedBottomPx=panelTop;ctx.fsCombatArtwork.extended=true;
  }

  function restoreNativeFrame(ctx,source,panelTop) {
    var top=.62,left=.18,cw=ctx.canvas.width,ch=ctx.canvas.height,y=ch*top;
    if (!source || panelTop<=y) return;
    var bottom=combatSourceArea(source).top-.008;
    if (bottom<=top) return;
    var scale=cw/source.width,sw=source.width*left,sy=source.height*top;
    var sourceH=(bottom-top)*source.height,height=Math.min(panelTop-y,sourceH*scale);
    // A source whose rules begin immediately under the rail has no usable
    // background strip. Retain its clean frame rather than repeat its rail cap.
    if(sourceH<source.width*.04)return;
    // The native strip contains each rivet, cable and flesh detail only once.
    // Keep its proportions rather than stretching a narrow row across the gap.
    var feather=Math.min(cw*.01,height/3);
    ctx.save();
    for(var edge=0;edge<feather;edge++){
      var rowH=Math.min(1,feather-edge);ctx.globalAlpha=(edge+rowH/2)/feather;
      ctx.drawImage(source,0,sy+edge/scale,sw,rowH/scale,0,y+edge,cw*left,rowH);
    }
    ctx.restore();
    ctx.drawImage(source,0,sy+feather/scale,sw,(height-feather)/scale,0,y+feather,cw*left,height-feather);
    var end=y+height;
    if(end<panelTop){
      var sample=document.createElement('canvas');sample.width=Math.ceil(sw);sample.height=Math.ceil(sourceH);
      var c=sample.getContext('2d',{willReadFrequently:true});c.drawImage(source,0,sy,sw,sourceH,0,0,sample.width,sample.height);
      var pixels=c.getImageData(0,0,sample.width,sample.height).data,median=[];
      for(var x=0;x<sample.width;x++)for(var channel=0;channel<3;channel++){
        var values=[];for(var row=0;row<sample.height;row++)values.push(pixels[(row*sample.width+x)*4+channel]);
        values.sort(function(a,b){return a-b;});median[x*3+channel]=values[Math.floor(values.length/2)];
      }
      var band=Math.max(1,Math.min(12,Math.floor(sample.height/3))),best=0,score=Infinity;
      for(var row=0;row<=sample.height-band;row++){
        var difference=0;
        for(var yy=row;yy<row+band;yy++)for(var x=0;x<sample.width;x++)for(var channel=0;channel<3;channel++)
          difference+=Math.abs(pixels[(yy*sample.width+x)*4+channel]-median[x*3+channel]);
        if(difference<score){score=difference;best=row;}
      }
      // Prefer grain close to the column medians rather than prominent details.
      // Mirrored joins avoid hard horizontal tile seams.
      var tileHeight=band*scale,flip=false;
      for(var dy=end;dy<panelTop;dy+=tileHeight){
        ctx.save();ctx.beginPath();ctx.rect(0,dy,cw*left,Math.min(tileHeight,panelTop-dy));ctx.clip();
        ctx.translate(0,flip?dy+tileHeight:dy);ctx.scale(1,flip?-1:1);
        ctx.drawImage(sample,0,best,sample.width,band,0,0,cw*left,tileHeight);ctx.restore();flip=!flip;
      }
    }
    ctx.fsCombatArtwork.nativeFrame={source:source.src,topPx:y,bottomPx:panelTop,grainExtended:end<panelTop};
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
    var b = region.box, cw = ctx.canvas.width, ch = ctx.canvas.height;
    var box = {x:b[0]*cw,y:b[1]*ch,width:b[2]*cw,height:b[3]*ch};
    var size = ch*(startSize||.05), ink;
    var family=region.font||FONT[role]||FONT.title;
    for (var guard=0; guard<160; guard++) {
      ctx.font = size + 'px '+family;
      ink = ctx.measureText(label);
      if (ink.width<=box.width*.96 && ink.actualBoundingBoxAscent+ink.actualBoundingBoxDescent<=box.height*.9) break;
      size *= .96;
    }
    ctx.textAlign = 'left';
    var x=region.align==='center' ? box.x+box.width/2+(ink.actualBoundingBoxLeft-ink.actualBoundingBoxRight)/2 : box.x+ink.actualBoundingBoxLeft;
    var y=box.y+box.height/2+(ink.actualBoundingBoxAscent-ink.actualBoundingBoxDescent)/2;
    var bounds=recordInk(ctx,label,x,y,role,region.align);
    ctx.fillText(label,x,y);
    if(role==='type')ctx.fsEventType = {box:box,ink:bounds,font:family};
  }

  function drawEventType(ctx,label,region) {
    drawLabel(ctx,label,Object.assign({},region,{align:'center'}),'type',.04);
  }

  function textField(data,kind) {
    if(data.template?.body)return data.template.body;
    var patch=(data.template?.patches||[]).find(function(p){return p.role==='body-erasure';});
    if(patch){
      var b=patch.box;
      return {box:[b[0]+.025,b[1]+.005,b[2]-.05,b[3]-.02],align:kind==='orders'?'center':'left'};
    }
    return {box:FIELDS[kind].body,align:kind==='orders'?'center':'left'};
  }

  function labelField(data,kind) {
    if(data.template?.titleRegion)return data.template.titleRegion;
    var patch=(data.template?.patches||[]).find(function(p){return !p.role;});
    return {box:patch?patch.box:FIELDS[kind].title,align:kind==='orders'?'center':'left'};
  }

  function drawBodyTextBox(ctx, text, region) {
    var previousPrefixes=ctx.fsItalicPrefixes;
    if(region.italicPrefixes===false)ctx.fsItalicPrefixes=false;
    var b=region.box,cw=ctx.canvas.width,ch=ctx.canvas.height;
    var box={x:b[0]*cw,y:b[1]*ch,width:b[2]*cw,height:b[3]*ch};
    var size=ch*.03,interline=size*.257,height;
    for(var guard=0;guard<100;guard++){
      height=measureStyledWrappedText(ctx,text,box.width,interline,size);
      if(height+size*.25<=box.height && ctx.fsMeasuredWidth<=box.width)break;
      size*=.96;interline=size*.257;
    }
    if(height+size*.25>box.height || ctx.fsMeasuredWidth>box.width)throw new Error('Текст не помещается в область правил');
    var align=region.align||'left';
    drawStyledWrappedText(ctx,text,align==='center'?box.x+box.width/2:box.x,
      box.y,box.width,interline,size,align);
    ctx.fsBodyTextBox={box:box,inkBottomPx:box.y+height+size*.25,fontSizePx:size};
    ctx.fsItalicPrefixes=previousPrefixes;
  }

  // ---- card draw functions ----

  // Shared framed general/unit effects for blank templates and baked TDL cards.
  // Baked cards fill the complete old wording area so no English text is exposed
  // when the Russian wording is shorter or only one effect exists.
  function drawCombatEffects(data, ctx, panels, sourceArea, picture, nativeFrame) {
    var cw = ctx.canvas.width, ch = ctx.canvas.height;
    var endY=sourceArea?ch*sourceArea.bottom:ch;
    var textMarginX = cw * COMBAT_LAYOUT.textMarginX;
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
      var fontSize  = ch * COMBAT_LAYOUT.fontSize;
      var interline = ch * COMBAT_LAYOUT.lineSpacing;
      var marginH   = cw * COMBAT_LAYOUT.marginY;

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
        marginH   *= COMBAT_LAYOUT.marginShrinkFactor;
        fontSize  *= COMBAT_LAYOUT.fontShrinkFactor;
        interline *= COMBAT_LAYOUT.lineSpacingShrinkFactor;
        p = measurePanels();
        guard++;
      }
      if (ctx.fsStrict && overBudget()) throw new Error('Боевой текст не помещается на карте');

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
        drawH: p.bg + (fgPanel ? p.fg : 0),
        h: p.bg, decoH: bgDecoH, contentH: p.bgContent,
        bottomClear: fgPanel ? 0 : bottomH,
      } : null;

      if(!sourceArea && picture)extendArtwork(ctx,picture,(bgPanel||fgPanel).y);
      if(nativeFrame)restoreNativeFrame(ctx,nativeFrame,(bgPanel||fgPanel).y);

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
    }
    ctx.fsCombatBottom=endY;
    return bottomH;
  }

  async function drawCombatCard(data, ctx) {
    var cw = ctx.canvas.width, ch = ctx.canvas.height;
    var iconSz = cw * COMBAT_LAYOUT.iconSizeRatio, iconSp = cw * COMBAT_LAYOUT.iconSpacingRatio;
    var iconXPos = cw * COMBAT_LAYOUT.iconX, iconStartYPos = ch * COMBAT_LAYOUT.iconStartY;
    var iconChars = String(data.icons || '').split('').map(function (c) { return iconMap[c.toUpperCase()]; }).filter(Boolean);
    var nativeFrame=Promise.resolve(null);
    if(data.template?.picture){
      var frameSrc=data.thumbnail?'thumbnails/'+data.picture:data.picture;
      nativeFrame=loadImage(frameSrc).catch(function(error){if(!data.thumbnail)throw error;return loadImage(data.picture);});
    }
    var resources = await Promise.all([
      loadCardPicture(data), loadImage('pictures/background.png'),
      loadImage('pictures/foreground.png'), loadImage('pictures/bottom.png'),nativeFrame,
    ].concat(iconChars.map(loadImage)));
    var picture = resources[0], bottomImg = resources[3], iconImgs = resources.slice(5);
    ctx.drawImage(picture, 0, 0, cw, ch);
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
    ctx.drawImage(picture,0,0,ctx.canvas.width,ctx.canvas.height);
    drawLabel(ctx,data.title||'',labelField(data,'orders'),'title');
    if(general)drawBodyTextBox(ctx,general,textField(data,'orders'));
  }

  async function drawEventCard(data, ctx) {
    var picture=await loadCardPicture(data);
    var general=data.hasText?window.FSWord.symbolize(data.general||''):'';
    ctx.drawImage(picture,0,0,ctx.canvas.width,ctx.canvas.height);
    var patch=(data.template?.patches||[]).find(function(p){return p.role==='event-type';});
    drawEventType(ctx,data.type||'',data.template?.eventType||{box:patch?patch.box:FIELDS.events.type});
    drawLabel(ctx,data.title||'',labelField(data,'events'),'title');
    if(general)drawBodyTextBox(ctx,general,textField(data,'events'));
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
    if (!region.transparent) {
      ctx.fillStyle = region.fill || '#e9dfb6';
      ctx.fillRect(-w / 2, -h / 2, w, h);
    }
    ctx.fillStyle = region.ink || '#15120c';
    ctx.fsBodyFont = region.role === 'heading' ? FONT.title : region.font || FONT.body;
    ctx.fsTextRole = region.role || 'body';
    // Label names stay words even when body text uses token icons. Headline
    // intentionally has no token glyphs (its private-use slots contain a logo).
    var text = window.FSWord.symbolize(window.FSWord.format(region.value, ctx.fsBodyFont === FONT.title ? 'explicit' : wording));
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
    if (height > maxH || widestWord()>maxW) throw new Error('Перевод не помещается в текстовую область');
    drawStyledWrappedText(ctx, text, region.align === 'center' ? 0 : -w / 2 + margin,
      -h / 2 + margin, maxW, interline, size, region.align || 'left');
    ctx.fsBodyFont = null;
    ctx.fsTextRole = null;
    ctx.restore();
  }

  // Typography is shared; boxes identify printed fields in the source artwork.
  // Existing Russian raster lettering remains intact where it already uses the
  // game's fonts. New translations are drawn from the same ability data as HTML.
  async function drawFactionSheet(data, ctx) {
    var source = await sourceInfo({src:data.picture,text:{crop:data.crop}});
    var picture = document.createElement('canvas');
    picture.width=source.width;picture.height=source.height;
    picture.getContext('2d').drawImage(source.picture,source.x,source.y,source.width,source.height,0,0,source.width,source.height);
    ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
    ctx.drawImage(picture,0,0,ctx.canvas.width,ctx.canvas.height);
    sheetRegions(data).forEach(function (region) {
      if (region.role === 'ability') {
        eraseNativeField(ctx,picture,region.box);
        var b=region.box, inset=b[2]*.035, titleH=b[3]*.16, subH=b[3]*.12;
        var field=function (value,y,h,role,size) {
          drawTextRegion(ctx,{box:[b[0]+inset,y,b[2]-inset*2,h],value:value,role:role,
            transparent:true,align:role==='heading'?'center':'left',size:size},data.wording);
        };
        field(data.sheet.title,b[1]+b[3]*.035,titleH,'heading',.034);
        field(data.sheet.subtitle,b[1]+titleH+b[3]*.035,subH,'heading',.024);
        field(data.sheet.abilities.map(function (a) {return a.title+': '+a.text;}).join(' *newpara* '),
          b[1]+titleH+subH+b[3]*.08,b[3]*.87-titleH-subH,'body',.024);
      } else {
        eraseNativeField(ctx,picture,region.box);
        drawTextRegion(ctx,Object.assign({},region,{transparent:true}),data.wording);
      }
    });
  }

  // Recover blank grain from the same field instead of painting a flat rectangle.
  // The small tile with least ink/contrast works for parchment and coloured labels.
  function eraseNativeField(ctx,picture,box) {
    var crop=document.createElement('canvas');crop.width=Math.max(1,Math.round(box[2]*picture.width));crop.height=Math.max(1,Math.round(box[3]*picture.height));
    var c=crop.getContext('2d',{willReadFrequently:true});
    c.drawImage(picture,box[0]*picture.width,box[1]*picture.height,box[2]*picture.width,box[3]*picture.height,0,0,crop.width,crop.height);
    var pixels=c.getImageData(0,0,crop.width,crop.height).data;
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
    ctx.drawImage(crop,box[0]*ctx.canvas.width,box[1]*ctx.canvas.height,box[2]*ctx.canvas.width,box[3]*ctx.canvas.height);
  }

  async function drawRasterTranslation(data, ctx) {
    var picture = await loadImage(data.picture);
    ctx.drawImage(picture, 0, 0, ctx.canvas.width, ctx.canvas.height);
    if (data.kind === 'combat' && !data.regions) {
      var titleBox=FIELDS.raster.combat.title;
      eraseNativeField(ctx,picture,titleBox);
      drawLabel(ctx,data.title,{box:titleBox},'title',.044);
      var panels = await Promise.all([
        loadImage('pictures/background.png'), loadImage('pictures/foreground.png'), loadImage('pictures/bottom.png'),
      ]);
      var bottomH = drawCombatEffects(data, ctx, panels, combatSourceArea(picture));
      ctx.drawImage(panels[2], 0, 0, panels[2].width, panels[2].height,
        0, ctx.fsCombatBottom - bottomH, ctx.canvas.width, bottomH);
      return;
    }
    if(data.regions){data.regions.forEach(function(region){drawTextRegion(ctx,region,data.wording);});return;}
    var fields=FIELDS.raster[data.kind];
    if(!fields)throw new Error('Нет разметки исходной карты');
    var prepared=document.createElement('canvas');prepared.width=picture.width;prepared.height=picture.height;
    var layer=prepared.getContext('2d');layer.drawImage(picture,0,0);
    Object.keys(fields).forEach(function(role){eraseNativeField(layer,picture,fields[role]);});
    var clean=Object.assign({},data,{preparedPicture:prepared,template:{
      titleRegion:{box:fields.title,align:data.kind==='orders'?'center':'left'},
      body:{box:fields.body,align:'left'},eventType:fields.type?{box:fields.type}:null,
    }});
    if(data.kind==='orders')return drawOrderCard(clean,ctx);
    return drawEventCard(clean,ctx);
  }

  var DRAW = { combat: drawCombatCard, orders: drawOrderCard, events: drawEventCard, overlay: drawRasterTranslation, sheet: drawFactionSheet };

  // Ensure the custom fonts are loaded before measuring/drawing text.
  var _fontsReady;
  function loadFont(name) {
    return new Promise(function (resolve, reject) {
      if (!document.fonts) { reject(new Error('Браузер не поддерживает проверку шрифтов')); return; }
      var timer = setTimeout(function () { reject(new Error('Не завершена загрузка шрифта ' + name)); }, 15000);
      document.fonts.load('16px ' + name).then(function (faces) {
        clearTimeout(timer);
        if (!faces.length || !document.fonts.check('16px ' + name)) reject(new Error('Не загружен шрифт ' + name));
        else resolve();
      }, function (error) { clearTimeout(timer); reject(error); });
    });
  }
  function fontsReady() {
    if (_fontsReady) return _fontsReady;
    _fontsReady = Promise.all(Array.from(new Set(Object.values(FONT))).map(loadFont)).catch(function (error) {
      _fontsReady = null;
      throw error;
    });
    return _fontsReady;
  }

  var _composed = window.FSCache.create(32);

  function compose(card, options) {
    options = options || {};
    // Capture dimensions before asynchronous work. Printing never changes view resolution.
    var width = options.width || card.width || maxWidth, height = options.height || card.height;
    var bounded=!options.width && !card.width;
    var strict = !!options.strict;
    var rejectOnError = strict || !!options.rejectOnError;
    var wording = card.wording || 'images';
    var thumbnail = !strict && !!card.thumbnail;
    var cacheable=!strict && !options.onMetrics;
    var picture = strict ? card.src : (card.picture || card.src);
    var key = JSON.stringify([card.src, picture, width, height, wording, thumbnail, rejectOnError, card.text, card.template]);
    var cached = cacheable && _composed.get(key);
    if (cached) return cached;
    var fn = card.text && card.text.raster ? drawRasterTranslation : DRAW[card.kind];
    if (rejectOnError && (!fn || !card.text || !card.text.title)) return Promise.reject(new Error('Нет русского текста: ' + card.src));
    if(rejectOnError && ['combat','orders','events'].includes(card.kind) && !(card.text.background||card.text.foreground||card.text.general))return Promise.reject(new Error('Нет русского текста правил: '+card.src));
    if (!fn || !card.text) return Promise.resolve(card.src);

    var fontReady = strict ? Promise.all(Array.from(new Set(Object.values(FONT))).map(loadFont)) : fontsReady();
    // Fetch the source while fonts load; neither depends on the other.
    var ready = Promise.all([fontReady,!height?sourceInfo(Object.assign({},card,{src:picture})):null]);
    var result = ready.then(async function (resources) {
      if(!height){
        var source=resources[1];
        height=Math.round(width*source.height/source.width);
        if(bounded && height>maxHeight){width=Math.round(width*maxHeight/height);height=maxHeight;}
      }
      if(!Number.isFinite(width)||!Number.isFinite(height)||width<1||height<1||width>16384||height>16384)throw new Error('Некорректный размер изображения карты');
      var canvas = document.createElement('canvas');
      canvas.width  = width;
      canvas.height = height;
      var ctx = canvas.getContext('2d');
      ctx.fsStrict = strict;
      ctx.fsCollectMetrics=!!options.onMetrics;
      ctx.fsTextLines=[];ctx.fsKind=card.kind;
      var format = function (text) { return window.FSWord.format(text, wording); };
      var data = {
        template:   card.template,
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
        crop:       card.text.crop,
        sheet:      card.text.sheet,
        side:       card.text.side,
        thumbnail:  thumbnail,
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
        if (options.onMetrics) {
          var metrics = {minimumBodyPx:ctx.fsMinimumBodyPx};
          metrics.textLines=ctx.fsTextLines;
          if (ctx.fsCombatPanels) metrics.combatPanels=ctx.fsCombatPanels;
          if (ctx.fsCombatArtwork) metrics.artwork=ctx.fsCombatArtwork;
          if (ctx.fsCombatIcons) metrics.combatIcons=ctx.fsCombatIcons;
          if (ctx.fsEventType) metrics.eventType=ctx.fsEventType;
          if (ctx.fsBodyTextBox) metrics.bodyTextBox=ctx.fsBodyTextBox;
          if (ctx.fsTokenImageBounds) metrics.tokenImages=ctx.fsTokenImageBounds;
          options.onMetrics(metrics);
        }
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

  window.FSCardRender = { compose: compose, sourceInfo: sourceInfo, fontsReady: fontsReady, setResolution: setResolution };
})();
