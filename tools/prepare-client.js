(async function(){
 'use strict';
 const start=document.getElementById('start'),cancel=document.getElementById('cancel'),status=document.getElementById('status'),log=document.getElementById('log'),progress=document.getElementById('progress'),examples=document.getElementById('examples');
 const response=await fetch('/api/jobs?token='+window.preparationToken),jobs=await response.json();if(!response.ok){status.textContent=jobs.error;return;}
 progress.max=jobs.length;status.textContent='Заданий: '+jobs.length;let stopped=false;cancel.onclick=()=>{stopped=true;};
 const image=src=>new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('Не загружен результат сравнения'));img.src=src;});
 async function compare(before,after){
  const [a,b]=await Promise.all([image(before),image(after)]);if(a.naturalWidth!==b.naturalWidth||a.naturalHeight!==b.naturalHeight)return {changedPixels:-1,error:'Different dimensions'};
  const canvas=document.createElement('canvas');canvas.width=a.naturalWidth;canvas.height=a.naturalHeight;const ctx=canvas.getContext('2d',{willReadFrequently:true});
  ctx.drawImage(a,0,0);const x=ctx.getImageData(0,0,canvas.width,canvas.height).data;ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(b,0,0);const y=ctx.getImageData(0,0,canvas.width,canvas.height).data;
  let changedPixels=0,maxDelta=0;for(let i=0;i<x.length;i+=4){let changed=false;for(let c=0;c<4;c++){const d=Math.abs(x[i+c]-y[i+c]);maxDelta=Math.max(maxDelta,d);if(d)changed=true;}if(changed)changedPixels++;}
  canvas.width=canvas.height=0;return {changedPixels,maxDelta,pixels:a.naturalWidth*a.naturalHeight};
 }
 start.onclick=async()=>{
  start.disabled=true;cancel.disabled=false;stopped=false;let completed=0,passed=0;log.textContent='';
  try{
   for(const job of jobs){if(stopped)break;status.textContent=(completed+1)+' / '+jobs.length+' · '+job.key;
    const prepared=await window.FSCardRender.prepareBackground(job.card),comparisons=[];let lastBefore,lastAfter;
    for(const check of job.comparisons){
     const candidate=job.verifyApplied?check.current:Object.assign({},check.card,{text:Object.assign({},check.card.text),template:Object.assign({},prepared.template,prepared.assetKind==='label-layer'?{titleLayer:prepared.png}:{picture:prepared.png})});candidate.text.raster=false;
     if(candidate.kind==='sheet')delete candidate.text.raster;
     const options={width:450,rejectOnError:true,onMetrics:function(){}};
     lastBefore=await (window.FSBaselineCardRender||window.FSCardRender).compose(check.card,options);lastAfter=await window.FSCardRender.compose(candidate,options);
     comparisons.push(Object.assign({mode:check.mode},await compare(lastBefore,lastAfter)));
    }
    const saved=await fetch('/api/result',{method:'POST',headers:{'Content-Type':'application/json','X-Preparation-Token':window.preparationToken},body:JSON.stringify(Object.assign({key:job.key,browser:navigator.userAgent,comparisons,before:lastBefore,after:lastAfter},prepared))});const result=await saved.json();if(!saved.ok)throw new Error(result.error);
    if(result.passed)passed++;else{
     log.textContent+='Различия: '+job.key+' '+JSON.stringify(comparisons)+'\n';
     examples.replaceChildren();for(const [label,src] of [['До',lastBefore],['После',lastAfter],['Подготовленный фон',prepared.png]]){const figure=document.createElement('figure'),caption=document.createElement('figcaption'),img=document.createElement('img');caption.textContent=label;img.src=src;img.alt=label+' '+job.key;figure.append(caption,img);examples.append(figure);}
    }
    completed++;progress.value=completed;window.FSCardRender.releasePreparationResources();window.FSBaselineCardRender?.releasePreparationResources?.();await new Promise(resolve=>setTimeout(resolve,0));
   }
   status.textContent=(stopped?'Остановлено':'Завершено')+' · '+completed+' / '+jobs.length+' · точное совпадение: '+passed;status.dataset.complete=String(!stopped&&completed===jobs.length);
  }catch(error){status.textContent='Ошибка: '+error.message;log.textContent+=error.stack;}
  finally{cancel.disabled=true;start.disabled=false;}
 };
})();
