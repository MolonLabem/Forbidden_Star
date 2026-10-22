// Full TDL renderer/URL/mobile check. Optional dependency: Playwright + Chromium.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'../page'),output=path.resolve(__dirname,'../reports/tdl/artifacts');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.css':'text/css; charset=utf-8','.woff2':'font/woff2','.jpg':'image/jpeg','.png':'image/png'};
(async()=>{
 await fs.mkdir(output,{recursive:true});
 const server=http.createServer(async(req,res)=>{try{const file=path.resolve(root,'.'+(new URL(req.url,'http://localhost').pathname==='/'?'/index.html':decodeURIComponent(new URL(req.url,'http://localhost').pathname)));if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'}).end(await fs.readFile(file));}catch{res.writeHead(404).end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${server.address().port}/`,errors=[],results=[];
 let browser;
 try{
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
  const page=await browser.newPage({viewport:{width:1440,height:1050}});
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&m.text().includes('compose failed'))errors.push(m.text());});
  await page.addInitScript(()=>{
   window.tdlInk=[];const fill=CanvasRenderingContext2D.prototype.fillText;
   CanvasRenderingContext2D.prototype.fillText=function(s,...args){window.tdlInk.push(s);return fill.call(this,s,...args);};
  });
  await page.goto(base);await page.waitForFunction(()=>!!window.FSCardRender);
  const cards=await page.evaluate(async()=>{
   const list=[];
   for(const fac of ['adeptuscustodes','genestealercult','thousandsons','leaguesofvotann']){
    const d=await(await fetch('factions/tdl/'+fac+'/text.json')).json();
    for(const cat of ['combat','orders','events']){
     const files=d.filenames[cat].flat(),texts=d[cat+'Text'].flat();
     files.forEach((file,i)=>{const t=texts[i];list.push({id:`tdl/${fac}/${cat}/${file}`,src:`factions/tdl/${fac}/${cat}/${file}`,kind:cat,text:cat==='combat'?{...t,raster:true,background:t.general,foreground:t.unit}:t});});
    }
    for(const [file,t] of Object.entries(d.componentsText))list.push({id:`tdl/${fac}/${file}`,src:`factions/tdl/${fac}/${file}`,kind:'overlay',text:t});
   }return list;
  });
  assert.equal(cards.length,131);
  for(const card of cards){
   for(const mode of ['explicit','icons']){
    const result=await page.evaluate(async({card,mode})=>{
     let metrics;const before=JSON.stringify(localStorage);
     const png=await FSCardRender.compose({...card,wording:mode},{strict:true,width:card.kind==='overlay'?1600:816,height:1110,onMetrics:m=>metrics=m});
     const im=new Image();im.src=png;await im.decode();
     return {png,metrics,width:im.width,height:im.height,settingsUnchanged:before===JSON.stringify(localStorage)};
    },{card,mode});
    assert.ok(result.png.startsWith('data:image/png;base64,'),card.id);
    if(!card.id.includes('/maps/'))assert.ok(result.metrics.minimumBodyPx>0,card.id);
    assert.equal(result.settingsUnchanged,true);
    assert.equal(result.width,card.kind==='overlay'?1600:816);
    assert.equal(result.height,card.kind==='overlay'?Math.round(1600/card.text.aspect):1110);
    if(card.kind==='combat'){
     const panels=result.metrics.combatPanels;
     assert.ok(panels,card.id+' must use framed combat effects');
     assert.equal(!!panels.general,!!card.text.general,card.id+' general panel');
     assert.equal(!!panels.unit,!!card.text.unit,card.id+' unit panel');
     assert.ok(Math.abs(panels.coveredTopPx-result.height*.6)<.01,card.id+' covers baked wording');
     for(const panel of [panels.general,panels.unit].filter(Boolean)){
      assert.ok(panel.textTopPx>=panel.innerTopPx-.01,card.id+' overlaps upper frame');
      assert.ok(panel.textBottomPx<=panel.innerBottomPx+.01,card.id+' overflows its effect panel');
     }
     if(panels.general&&panels.unit)assert.ok(Math.abs(panels.general.topPx+panels.general.heightPx-panels.unit.topPx)<.01,card.id+' has an inter-panel gap');
    }
    if(mode==='explicit'){
     const file=card.id.replaceAll('/','__').replace(/\.jpg$/,'.png');await fs.writeFile(path.join(output,file),Buffer.from(result.png.split(',')[1],'base64'));
    }
    delete result.png;results.push({id:card.id,mode,...result});
   }
   console.log('PASS '+card.id);
  }
  // Real UI direct links, source attribution and wording preference.
  await page.goto(base+'#exp=tdl&faction=leaguesofvotann&category=orders&card=factions%2Ftdl%2Fleaguesofvotann%2Forders%2Fo_1.jpg');
  const waitCard=()=>page.waitForFunction(()=>document.querySelector('.fs-lb-imgwrap.is-ready img')?.src.startsWith('data:image/png'));
  await waitCard();assert.match(await page.locator('.fs-card-text').innerText(),/жетон кузницы/);
  assert.match(await page.locator('.fs-card-text a').getAttribute('href'),/a31d0e9/);
  await page.screenshot({path:path.join(output,'desktop.png')});
  await page.locator('#fs-lb-wording').selectOption('icons');await waitCard();
  assert.ok(await page.locator('.fs-card-text .fs-token[aria-label="жетон кузницы"]').count());
  await page.screenshot({path:path.join(output,'desktop-icons.png')});
  await page.locator('.fs-lb-close').click();
  await page.locator('.fs-faq-search').fill('потратить 2 материала');await page.locator('.fs-card').first().waitFor();
  assert.ok((await page.locator('.fs-search-name').allTextContents()).some(t=>/туннелей/i.test(t)));
  await page.setViewportSize({width:390,height:844});
  await page.goto(base+'#exp=tdl&faction=thousandsons&category=combat&card=factions%2Ftdl%2Fthousandsons%2Fcombat%2Fs1.jpg');
  await waitCard();await page.screenshot({path:path.join(output,'mobile.png')});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.goto(base+'#exp=tdl&faction=genestealercult&category=faction_card&card=factions%2Ftdl%2Fgenestealercult%2Ffaction_card%2Fsheet_front_1.jpg');
  await waitCard();const size=await page.locator('.fs-lb img').evaluate(im=>[im.naturalWidth,im.naturalHeight]);assert.equal(size[0],1600);assert.equal(size[1],Math.round(1600/(3118/1878)));
  await page.locator('.fs-card-text summary').click();
  assert.match(await page.locator('.fs-card-text').innerText(),/Вместимость/);
  await page.goto(base+'#exp=tdl&faction=adeptuscustodes&category=combat&card=factions%2Ftdl%2Fadeptuscustodes%2Fcombat%2Fs1.jpg');
  await waitCard();
  await page.screenshot({path:path.join(output,'combat-panels-mobile.png')});
  await page.setViewportSize({width:1440,height:1050});
  await page.waitForTimeout(200);await waitCard();
  await page.screenshot({path:path.join(output,'combat-panels-desktop.png')});
  await page.locator('.fs-lb img').screenshot({path:path.join(output,'combat-panels-card.png'),animations:'disabled'});
  // Replacing the entire baked wording area must not change any pixel below the
  // new frames. Transparent decorative headers must not expose old English ink.
  const coverage=await page.evaluate(async()=>{
   const d=await(await fetch('factions/tdl/adeptuscustodes/text.json')).json(),t=d.combatText[0][0];
   const source='factions/tdl/adeptuscustodes/combat/s1.jpg';
   const image=new Image();image.src=source;await image.decode();
   const poison=document.createElement('canvas');poison.width=image.width;poison.height=image.height;
   const p=poison.getContext('2d');p.drawImage(image,0,0);p.fillStyle='#ff00ff';p.fillRect(0,image.height*.6,image.width,image.height*.4);
   const text={...t,raster:true,background:t.general,foreground:t.unit};
   const images=await Promise.all([source,poison.toDataURL()].map(async src=>{
    const url=await FSCardRender.compose({src,kind:'combat',text},{strict:true,width:1024,height:1479});
    const im=new Image();im.src=url;await im.decode();return im;
   }));
   const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=1479;const ctx=canvas.getContext('2d');
   const pixels=images.map(im=>{ctx.drawImage(im,0,0);return ctx.getImageData(0,Math.ceil(1479*.6)+1,1024,1479-Math.ceil(1479*.6)-1).data;});
   let changed=0;for(let i=0;i<pixels[0].length;i+=4)if(Math.max(...[0,1,2].map(c=>Math.abs(pixels[0][i+c]-pixels[1][i+c])))>2)changed++;
   return {changedPixels:changed,coveredFrom:Math.ceil(1479*.6)+1};
  });assert.equal(coverage.changedPixels,0,'Baked English wording remains visible through frames');
  assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(output,'browser-results.json'),JSON.stringify({renders:results.length,combatRenders:results.filter(r=>r.id.includes('/combat/')).length,coverage,ui:['direct-card-link','source-link','token-wording','rules-search','mobile','landscape-sheet','combat-panels'],errors,results},null,2)+'\n');
  console.log('PASS 262 strict renders, including 118 structured combat renders; pixel coverage, direct links, sources, token wording, rules search, mobile and landscape sheets; no JavaScript errors');
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
