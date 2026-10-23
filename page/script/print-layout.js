/* One physical layout for the A4 preview and the browser-generated PDF.
 * Card faces are already rasterized by FSCardRender; JPEG image streams,
 * vector cut marks and a built-in ruler font need no third-party dependency.
 */
(function (root) {
  'use strict';
  var PT = 72 / 25.4, PAPER = {a4:[210,297],letter:[215.9,279.4]};
  function layout(spec, options) {
    var paper = PAPER[options.paper || 'a4'], margin = options.marginMm, gap = 2;
    if (!paper || !Number.isFinite(margin) || margin < 5 || margin > 20 || spec.widthMm !== 63 || spec.heightMm !== 88) throw new Error('Проверьте формат бумаги и поля от 5 до 20 мм');
    var columns = Math.floor((paper[0] - margin * 2 + gap) / (spec.widthMm + gap));
    var rows = Math.floor((paper[1] - margin * 2 + gap) / (spec.heightMm + gap));
    if (!columns || !rows) throw new Error('Карты не помещаются на лист');
    return {width:paper[0],height:paper[1],columns:columns,rows:rows,capacity:columns*rows,
      cardWidth:spec.widthMm,cardHeight:spec.heightMm,gap:gap,
      x:(paper[0]-columns*spec.widthMm-(columns-1)*gap)/2,
      y:(paper[1]-rows*spec.heightMm-(rows-1)*gap)/2};
  }
  function placements(items, sheet, back, grid, flip) {
    if (!['long','short'].includes(flip) || !Number.isInteger(sheet) || sheet < 0) throw new Error('Некорректная сторона листа');
    return items.slice(sheet*grid.capacity,(sheet+1)*grid.capacity).map(function (card,slot) {
      var x=grid.x+(slot%grid.columns)*(grid.cardWidth+grid.gap);
      var y=grid.y+Math.floor(slot/grid.columns)*(grid.cardHeight+grid.gap);
      if (back && flip==='long') x=grid.width-x-grid.cardWidth;
      if (back && flip==='short') y=grid.height-y-grid.cardHeight;
      return {id:card.id,key:back?card.backSrc:card.id,x:x,y:y,width:grid.cardWidth,height:grid.cardHeight};
    });
  }
  function decorations(positions, grid, calibration) {
    var lines=[],labels=[];
    positions.forEach(function (p) {
      [p.x,p.x+p.width].forEach(function (x) { [p.y,p.y+p.height].forEach(function (y) {
        var dx=x===p.x?-1:1,dy=y===p.y?-1:1;
        lines.push([x+dx*.3,y,x+dx*2,y],[x,y+dy*.3,x,y+dy*2]);
      }); });
    });
    if (calibration) {
      var x=(grid.width-100)/2,y=grid.height-6;
      lines.push([x,y,x+100,y]);
      for(var i=0;i<=10;i++) lines.push([x+i*10,y-1,x+i*10,y+1]);
      labels.push({text:'100 mm',x:x+43,y:y-2});
    }
    return {lines:lines,labels:labels};
  }
  function drawPreview(canvas, grid, positions, images, calibration) {
    var ctx=canvas.getContext('2d'),scale=canvas.width/grid.width;
    canvas.height=Math.round(grid.height*scale);
    ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.save();ctx.scale(scale,scale);
    positions.forEach(function (p) {
      var img=images.get(p.key);
      if(img) ctx.drawImage(img,p.x,p.y,p.width,p.height);
      else {ctx.fillStyle='#f1efeb';ctx.fillRect(p.x,p.y,p.width,p.height);}
    });
    var deco=decorations(positions,grid,calibration);
    ctx.strokeStyle='#777';ctx.lineWidth=.15;ctx.beginPath();
    deco.lines.forEach(function (l) {ctx.moveTo(l[0],l[1]);ctx.lineTo(l[2],l[3]);});ctx.stroke();
    ctx.fillStyle='#666';ctx.font='2.5px sans-serif';
    deco.labels.forEach(function (l) {ctx.fillText(l.text,l.x,l.y);});ctx.restore();
  }
  // Image-only PDF: explicit byte offsets, reusable JPEG XObjects, vector trim
  // marks and physical page/card sizes. Both sides use placements() above.
  function pdf(pages, images, grid) {
    if(!pages.length) throw new Error('Выберите карты для печати');
    var encoder=new TextEncoder(),objects=[null],resources=new Map();
    function reserve() {objects.push(null);return objects.length-1;}
    function put(parts) {var id=reserve();objects[id]=parts;return id;}
    function bytes(value) {return encoder.encode(value);}
    function n(value) {return Number(value.toFixed(4));}
    var catalogId=reserve(),pagesId=reserve();
    var fontId=put([bytes('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')]);
    images.forEach(function (img,key) {
      if(!img.width || !img.height || !(img.bytes instanceof Uint8Array) || img.bytes[0]!==255 || img.bytes[1]!==216) throw new Error('Не завершён рендер изображения');
      var name='I'+(resources.size+1);
      var id=put([bytes('<< /Type /XObject /Subtype /Image /Width '+img.width+' /Height '+img.height+' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+img.bytes.length+' >>\nstream\n'),img.bytes,bytes('\nendstream')]);
      resources.set(key,{name:name,id:id});
    });
    var pageIds=pages.map(function (page) {
      var commands=[],used=new Map();
      page.positions.forEach(function (p) {
        var resource=resources.get(p.key);if(!resource) throw new Error('Нет изображения карты: '+p.id);
        used.set(resource.name,resource.id);
        commands.push('q '+[p.width*PT,0,0,p.height*PT,p.x*PT,(grid.height-p.y-p.height)*PT].map(n).join(' ')+' cm /'+resource.name+' Do Q');
      });
      var deco=decorations(page.positions,grid,page.calibration);
      commands.push('0.45 G 0.3 w');
      deco.lines.forEach(function (l) {commands.push([n(l[0]*PT),n((grid.height-l[1])*PT),'m',n(l[2]*PT),n((grid.height-l[3])*PT),'l S'].join(' '));});
      deco.labels.forEach(function (l) {commands.push('BT /F1 7 Tf 0.4 g '+n(l.x*PT)+' '+n((grid.height-l.y)*PT)+' Td ('+l.text+') Tj ET');});
      var content=bytes(commands.join('\n'));
      var streamId=put([bytes('<< /Length '+content.length+' >>\nstream\n'),content,bytes('\nendstream')]);
      var xobjects=Array.from(used,function (pair) {return '/'+pair[0]+' '+pair[1]+' 0 R';}).join(' ');
      return put([bytes('<< /Type /Page /Parent '+pagesId+' 0 R /MediaBox [0 0 '+n(grid.width*PT)+' '+n(grid.height*PT)+'] /Resources << /XObject << '+xobjects+' >> /Font << /F1 '+fontId+' 0 R >> >> /Contents '+streamId+' 0 R >>')]);
    });
    objects[catalogId]=[bytes('<< /Type /Catalog /Pages '+pagesId+' 0 R >>')];
    objects[pagesId]=[bytes('<< /Type /Pages /Count '+pageIds.length+' /Kids ['+pageIds.map(function (id) {return id+' 0 R';}).join(' ')+'] >>')];
    var chunks=[bytes('%PDF-1.4\n')],offsets=[0],size=chunks[0].length;
    function append(chunk) {chunks.push(chunk);size+=chunk.length;}
    for(var i=1;i<objects.length;i++) {
      offsets[i]=size;append(bytes(i+' 0 obj\n'));objects[i].forEach(append);append(bytes('\nendobj\n'));
    }
    var xref=size;
    append(bytes('xref\n0 '+objects.length+'\n0000000000 65535 f \n'+offsets.slice(1).map(function (offset) {return String(offset).padStart(10,'0')+' 00000 n \n';}).join('')+'trailer\n<< /Size '+objects.length+' /Root '+catalogId+' 0 R >>\nstartxref\n'+xref+'\n%%EOF\n'));
    return new Blob(chunks,{type:'application/pdf'});
  }
  var api={layout:layout,placements:placements,decorations:decorations,drawPreview:drawPreview,pdf:pdf};
  if(typeof module!=='undefined' && module.exports) module.exports=api;else root.FSPaper=api;
})(typeof window!=='undefined'?window:globalThis);
