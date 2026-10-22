// Live structured-card rendering checks; no review reports or generated PNG inputs.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'../page');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.jpg':'image/jpeg','.png':'image/png','.woff2':'font/woff2'};
(async()=>{
 const server=http.createServer(async(req,res)=>{try{
  const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const file=path.resolve(root,'.'+(name==='/'?'/index.html':name));
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  const bytes=await fs.readFile(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'}).end(bytes);
 }catch{res.writeHead(404).end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port+'/',errors=[];
 const data=JSON.parse(await fs.readFile(path.join(root,'factions/base/spacemarines/text.json')));
 const files=JSON.parse(await fs.readFile(path.join(root,'factions/general.json'))).filenames;
 let browser;
 try{
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
  const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:2});
  await page.route('https://fonts.googleapis.com/**',route=>route.fulfill({contentType:'text/css',body:''}));
  page.on('pageerror',e=>errors.push(e.message));
  const ready=()=>page.waitForFunction(()=>document.querySelector('.fs-lb-imgwrap.is-ready img')?.naturalWidth>0);
  async function matches(category,file,wording='explicit'){
   const row=data[category+'Text'].flat()[files[category].flat().indexOf(file)];
   const result=await page.evaluate(async({category,file,row,template,wording})=>{
    const img=document.querySelector('.fs-lb img'),width=img.naturalWidth,height=img.naturalHeight;
    const text=category==='combat'?{...row,background:row.general,foreground:row.unit}:row;
    const expected=await FSCardRender.compose({src:'factions/base/spacemarines/'+category+'/'+file,kind:category,text,template,wording},{strict:true,width,height});
    const rect=img.getBoundingClientRect();
    return {identical:img.src===expected,width,height,displayed:[rect.width,rect.height],x:rect.x,y:rect.y,viewport:[innerWidth,innerHeight],dpr:devicePixelRatio};
   },{category,file,row,template:data.templates[category+'/'+file],wording});
   assert.equal(result.identical,true,category+'/'+file+' differs from the approved strict composition');
   assert.ok(Math.abs(result.width/result.height-451/640)<.001);
   assert.ok(result.width>=result.displayed[0]*Math.max(2,result.dpr)-1);
   assert.ok(result.x>=0&&result.x+result.displayed[0]<=result.viewport[0]+1);
   assert.ok(result.y>=0&&result.y+result.displayed[1]<=result.viewport[1]+1);
   assert.equal(await page.locator('.fs-card-text a').textContent(),'Источник русского текста');
   const count=page.locator('.fs-fac-sub.is-active .fs-fac-count');
   if(await count.count())assert.equal(await count.innerText(),'27');
  }
  let checked=0;
  for(const category of ['combat','orders','events'])for(const file of files[category].flat()){
   const src='factions/base/spacemarines/'+category+'/'+file;
   await page.goto(base+'#exp=base&faction=spacemarines&category='+category+'&card='+encodeURIComponent(src));await ready();
   await matches(category,file);checked++;
  }
  await page.setViewportSize({width:390,height:844});
  await page.goto(base+'#exp=base&faction=spacemarines&category=orders&card=factions%2Fbase%2Fspacemarines%2Forders%2Fo_1.jpg');await ready();
  await page.locator('#fs-lb-wording').selectOption('icons');await ready();
  await matches('orders','o_1.jpg','icons');
  assert.equal(await page.locator('.fs-card-text .fs-token[aria-label="жетон подкрепления"]').count(),1);
  await page.goto(base+'#q='+encodeURIComponent('выбранную боевую карту противника'));
  await page.locator('.fs-card[data-card-id="factions/base/spacemarines/combat/s2.jpg"]').click();await ready();
  await page.locator('#fs-lb-wording').selectOption('explicit');await ready();
  await matches('combat','s2.jpg');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);
  console.log(`PASS ${checked} live cards match the approved composition; search, direct links, mobile, token modes and 27-card count; no JavaScript errors`);
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
