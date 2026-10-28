/* Dependency-free loopback preparation server. PNG output stays in a staging
 * directory until a separate validated apply step. No external image service. */
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {inputs,hash,page}=require('./template-inputs.cjs');
const args=process.argv.slice(2),option=(key,fallback)=>{const i=args.indexOf(key);return i<0?fallback:args[i+1];};
const out=path.resolve(option('--out-dir',path.join(os.tmpdir(),'forbidden-star-prepared-'+Date.now()))),port=Number(option('--port','8081'));
const baselineFile=option('--baseline-renderer',null),baseline=baselineFile?fs.readFileSync(path.resolve(baselineFile),'utf8'):null;
let jobs=inputs();const ids=option('--ids','').split(',').filter(Boolean);if(ids.length)jobs=jobs.filter(j=>ids.includes(j.key));
if(ids.some(id=>!jobs.some(j=>j.key===id)))throw new Error('Unknown requested preparation ID');
if(args.includes('--verify-applied'))jobs.forEach(job=>job.verifyApplied=true);
const token=crypto.randomBytes(24).toString('hex'),byKey=new Map(jobs.map(j=>[j.key,j]));
fs.mkdirSync(out,{recursive:true});const results={schemaVersion:1,rendererHash:jobs[0]?.rendererHash,jobs:{}};
function json(res,code,value){res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
function persist(){fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2)+'\n');}
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1:'+port);
  if(req.method==='GET'&&url.pathname==='/baseline-renderer.js'){res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'});return res.end(baseline?baseline.replace('fontsReady: fontsReady, setResolution: setResolution','fontsReady: fontsReady, releasePreparationResources:function(){_imgCache.clear();_sheetBackgrounds.clear();_sourceAreas.clear();_titleAreas.clear();_artworkAreas.clear();_composed.clear();}, setResolution: setResolution'):'window.FSCardRender=null;');}
  if(req.method==='GET'&&url.pathname==='/api/jobs'){if(url.searchParams.get('token')!==token)return json(res,403,{error:'Invalid preparation session'});return json(res,200,jobs);}
  if(req.method==='POST'&&url.pathname==='/api/result'){
   if(req.headers.origin!=='http://127.0.0.1:'+port||req.headers['x-preparation-token']!==token)return json(res,403,{error:'Invalid preparation session'});
   let length=0,chunks=[];for await(const chunk of req){length+=chunk.length;if(length>64*1024*1024)throw new Error('Preparation result too large');chunks.push(chunk);}
   const body=JSON.parse(Buffer.concat(chunks).toString('utf8')),job=byKey.get(body.key);if(!job)throw new Error('Unknown preparation job');
   if(!/^data:image\/png;base64,[a-zA-Z0-9+/=]+$/.test(body.png))throw new Error('Expected PNG result');
   const bytes=Buffer.from(body.png.split(',')[1],'base64');if(bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw new Error('Invalid PNG');
   if(bytes.readUInt32BE(16)!==body.width||bytes.readUInt32BE(20)!==body.height||body.width<1||body.height<1||body.width>16384||body.height>16384)throw new Error('Invalid result dimensions');
   if(!Array.isArray(body.comparisons)||body.comparisons.length!==job.comparisons.length)throw new Error('Missing render comparisons');
   if(body.comparisons.some((c,i)=>c.mode!==job.comparisons[i].mode||!Number.isInteger(c.changedPixels)||!Number.isInteger(c.maxDelta)))throw new Error('Invalid comparison evidence');
   const passed=body.comparisons.every(c=>c.changedPixels===0&&!c.error);
   const name=job.recipe.output.split('/').pop();fs.writeFileSync(path.join(out,name),bytes);
   results.jobs[body.key]={cardId:job.recipe.cardId,mode:job.recipe.mode,output:job.recipe.output,file:name,sha256:hash(bytes),width:body.width,height:body.height,
    template:body.template,profile:body.profile,assetKind:body.assetKind,inputHash:job.inputHash,sourceHashes:job.sourceHashes,rendererHash:job.rendererHash,
    comparisons:body.comparisons,passed,baselineRendererHash:baseline?hash(baseline):job.rendererHash,comparisonSource:baseline?'saved-original-renderer':'retained-compatibility-renderer',browser:body.browser,quality:'reconstructed-background; not an original clean master'};
   if(!passed)for(const side of ['before','after'])if(typeof body[side]==='string'&&body[side].startsWith('data:image/png;base64,'))fs.writeFileSync(path.join(out,name+'.'+side+'.png'),Buffer.from(body[side].split(',')[1],'base64'));
   persist();console.log((passed?'PASS ':'DIFF ')+body.key+' '+body.comparisons.map(c=>c.mode+':'+c.changedPixels).join(' '));return json(res,200,{passed});
  }
  if(req.method!=='GET')return json(res,405,{error:'Read-only endpoint'});
  if(url.pathname==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});return res.end(fs.readFileSync(path.join(__dirname,'prepare-templates.html'),'utf8').replace('__TOKEN__',token));}
  let file;
  if(url.pathname==='/prepare-client.js')file=path.join(__dirname,'prepare-client.js');
  else if(url.pathname.startsWith('/page/')){file=path.resolve(page,decodeURIComponent(url.pathname.slice(6)));if(!file.startsWith(page+path.sep))throw new Error('Path escapes page');}
  else return json(res,404,{error:'Not found'});
  const types={'.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2','.css':'text/css; charset=utf-8'};
  if(!fs.statSync(file).isFile())throw new Error('Not a file');
  res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(file).pipe(res);
 }catch(error){json(res,400,{error:error.message});}
});
server.listen(port,'127.0.0.1',()=>console.log('Preparation: http://127.0.0.1:'+port+'/?token='+token+'\nStaging: '+out+'\nJobs: '+jobs.length));
