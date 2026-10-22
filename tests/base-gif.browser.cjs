// Live migration checks use runtime data only; review images stay outside Git.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'../page'),output=process.env.BROWSER_OUTPUT||'/tmp/fs-seven-factions/review';
const factions=['base/chaos','base/ork','base/eldar','gif/ig','gif/necron','gif/tau','gif/tyranid'];
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.jpg':'image/jpeg','.png':'image/png','.woff2':'font/woff2'};
(async()=>{
 await fs.mkdir(output,{recursive:true});
 const server=http.createServer(async(req,res)=>{try{
  const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=path.resolve(root,'.'+(name==='/'?'/index.html':name));
  if(!file.startsWith(root+path.sep))throw Error('Invalid path');
  const bytes=await fs.readFile(file);
  res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'}).end(bytes);
 }catch{res.writeHead(404).end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port+'/',errors=[],metrics=[];
 const files=JSON.parse(await fs.readFile(path.join(root,'factions/general.json'))).filenames;
 let browser;
 try{
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
  const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
  await page.route('https://fonts.googleapis.com/**',route=>route.fulfill({contentType:'text/css',body:''}));
  page.on('pageerror',e=>errors.push(e.message));
  const ready=()=>page.waitForFunction(()=>document.querySelector('.fs-lb-imgwrap.is-ready img')?.naturalWidth>0);
  const link=(fac,cat,file)=>base+'#exp='+fac.split('/')[0]+'&faction='+fac.split('/')[1]+'&category='+cat+'&card='+encodeURIComponent('factions/'+fac+'/'+cat+'/'+file);
  for(const fac of factions){
   const data=JSON.parse(await fs.readFile(path.join(root,'factions',fac,'text.json')));
   await fs.mkdir(path.join(output,fac),{recursive:true});
   for(const cat of ['combat','orders','events'])for(const [index,file] of files[cat].flat().entries()){
    const row=data[cat+'Text'].flat()[index],template=data.templates[cat+'/'+file];
    await page.goto(link(fac,cat,file));await ready();
    await page.locator('#fs-lb-wording').selectOption('icons');await ready();
    const result=await page.evaluate(async({fac,cat,file,row,template})=>{
     const before=JSON.stringify(localStorage);
     const img=document.querySelector('.fs-lb-imgwrap img'),text=cat==='combat'?{...row,background:row.general,foreground:row.unit}:row;
     const card={src:'factions/'+fac+'/'+cat+'/'+file,kind:cat,text,template,wording:'icons'};
     let mono,coloured;
     const expected=await FSCardRender.compose(card,{strict:true,width:img.naturalWidth,height:img.naturalHeight});
     const png=await FSCardRender.compose(card,{strict:true,width:902,height:Math.round(902/row.aspect),onMetrics:m=>{mono=m;}});
     const images=await FSCardRender.compose({...card,wording:'images'},{strict:true,width:902,height:Math.round(902/row.aspect),onMetrics:m=>{coloured=m;}});
     delete mono.tokenImages;delete coloured.tokenImages;
     const rect=img.getBoundingClientRect();
     return {png,identical:img.src===expected,aspect:img.naturalWidth/img.naturalHeight,scale:img.naturalWidth/rect.width,
      fits:rect.x>=0&&rect.y>=0&&rect.right<=innerWidth+1&&rect.bottom<=innerHeight+1,
      sameLayout:JSON.stringify(mono)===JSON.stringify(coloured),metrics:mono,settingsUnchanged:before===JSON.stringify(localStorage),
      selectedText:document.querySelector('.fs-card-text').textContent,hasImageAlternative:images.startsWith('data:image/png')};
    },{fac,cat,file,row,template});
    const id=fac+'/'+cat+'/'+file;
    assert.equal(result.identical,true,id+' live/strict render differ');
    assert.ok(Math.abs(result.aspect-row.aspect)<.001,id+' native aspect');
    assert.ok(result.scale>=1.99,id+' HD text');assert.ok(result.fits,id+' viewport');
    assert.equal(result.sameLayout,true,id+' token style affects layout');assert.equal(result.settingsUnchanged,true);assert.ok(result.hasImageAlternative);
    if(cat==='combat'){
     const panels=result.metrics.combatPanels;
     assert.equal(!!panels.general,!!row.general,id+' general panel');assert.equal(!!panels.unit,!!row.unit,id+' unit panel');
     for(const panel of [panels.general,panels.unit].filter(Boolean))assert.ok(panel.textTopPx>=panel.innerTopPx-.1&&panel.textBottomPx<=panel.innerBottomPx+.1,id+' panel overflow');
     const join=result.metrics.combatJoin;assert.ok(join.upperBottomPx>join.decorativeBottomPx,id+' seam');
    }else{
     const m=result.metrics.bodyTextBox;assert.ok(m.inkBottomPx<=m.box.y+m.box.height+.1,id+' body overflow');
     if(cat==='events'){
      const m=result.metrics.eventType,ink=m.ink,box=m.box;
      assert.ok(Math.abs((ink.left+ink.right)/2-(box.x+box.width/2))<1,id+' type horizontal center');
      assert.ok(Math.abs((ink.top+ink.bottom)/2-(box.y+box.height/2))<1,id+' type vertical center');
     }
    }
    assert.ok(result.selectedText.includes(row.title),id+' selectable text');
    await fs.writeFile(path.join(output,fac,cat+'-'+file.replace('.jpg','.png')),Buffer.from(result.png.split(',')[1],'base64'));
    delete result.png;metrics.push({id,...result});
   }
   console.log('PASS '+fac+': 27 live direct links, native aspects, HD, strict layouts and both token styles');
  }
  await page.setViewportSize({width:390,height:844});
  // Exercise every migrated card at the mobile viewer size and image style too.
  for(const fac of factions){
   const data=JSON.parse(await fs.readFile(path.join(root,'factions',fac,'text.json')));
   for(const cat of ['combat','orders','events'])for(const file of files[cat].flat()){
    await page.goto(link(fac,cat,file));await ready();
    await page.locator('#fs-lb-wording').selectOption('images');await ready();
    assert.ok(await page.locator('.fs-lb-imgwrap img').evaluate(img=>{const r=img.getBoundingClientRect();return r.x>=0&&r.y>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;}),fac+'/'+cat+'/'+file+' mobile viewport');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile horizontal scroll');
   }
   await page.screenshot({path:path.join(output,fac,'mobile.png'),animations:'disabled'});
   console.log('PASS '+fac+': 27 mobile direct links and image-token rendering');
  }
  await page.setViewportSize({width:1440,height:1000});
  for(const fac of factions){
   const data=JSON.parse(await fs.readFile(path.join(root,'factions',fac,'text.json'))),row=data.combatText[0][0];
   const query=(row.unit||row.general).split(':')[0].split(/[\[(]/)[0].trim();
   await page.goto(base+'#q='+encodeURIComponent(query));
   await page.locator('.fs-card[data-card-id="factions/'+fac+'/combat/s1.jpg"]').waitFor();
  }
  console.log('PASS all seven factions searchable by current Russian rules');
  const recovery=await browser.newPage({viewport:{width:1440,height:1000}});
  await recovery.route('https://fonts.googleapis.com/**',r=>r.fulfill({contentType:'text/css',body:''}));
  recovery.on('pageerror',e=>errors.push(e.message));
  let missing=true;
  await recovery.route('**/pictures/templates/base-chaos-event-paper.png',r=>missing?r.fulfill({status:404,body:''}):r.continue());
  await recovery.goto(link('base/chaos','events','e_5.jpg'));
  await recovery.locator('.fs-lb-imgwrap.is-error').waitFor();
  assert.equal(await recovery.locator('.fs-lb-imgwrap img').getAttribute('src'),null);
  missing=false;await recovery.getByRole('button',{name:'Повторить загрузку',exact:true}).click();
  await recovery.waitForFunction(()=>document.querySelector('.fs-lb-imgwrap.is-ready img')?.naturalWidth>0);
  await recovery.close();
  console.log('PASS missing parchment fails explicitly and retries without a broken or partly rendered card');
  assert.deepEqual(errors,[]);await fs.writeFile(path.join(output,'metrics.json'),JSON.stringify(metrics,null,2)+'\n');
  console.log('PASS 189 desktop + 189 mobile cards, 378 strict compositions; no JavaScript errors');
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
