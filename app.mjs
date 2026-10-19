import {runPerson,sendToSheet} from './runner.mjs';
import {get,put} from './store.mjs';
import {makeCustomProfile,validateExtraAnswers} from './persona-settings.mjs';
const $=id=>document.getElementById(id);
let rows=[],queue=[],results=[],active=false,anotherTab=false,controller,wakeLock;
const [profiles,custom,model,pacingModel]=await Promise.all(['profiles.json','custom-personas.json','empirical-model.json','pacing-model.json'].map(file=>fetch(file).then(r=>{if(!r.ok)throw Error(`Cannot load ${file}`);return r.json();})));
const library=[...profiles,...custom];
const fail=message=>{$('error').textContent=message;$('error').hidden=!message;};
const persist=()=>put('state',{rows,queue,results,label:$('deviceLabel').value,pushSheet:$('pushSheet').checked});
for(const p of library)$('persona').add(new Option(p.label || p.id,p.id));
function preview(){const p=library.find(p=>p.id===$('persona').value);$('personaPreview').textContent=JSON.stringify({shrines:p.shrines,...p.answers},null,2);}
$('persona').onchange=preview;preview();
function render(){
  $('setup').disabled=active || anotherTab;$('stop').disabled=!active;
  $('batch').replaceChildren();
  rows.forEach((row,i)=>{const li=document.createElement('li');li.textContent=`${row.label} · ${row.copies} copies · ${row.sampling==='similar'?'Similar observed samples':'Repeat details'}`;const remove=document.createElement('button');remove.textContent='Remove';remove.onclick=()=>{rows.splice(i,1);render();persist().catch(e=>fail(e.message));};li.append(remove);$('batch').append(li);});
  const total=rows.reduce((n,r)=>n+r.copies,0);
  $('estimate').textContent=`${total} people · about ${total*5}–${total*7} minutes on this device. Multiple devices can run independently.`;
  $('start').disabled=active || anotherTab || !total;
  $('queue').replaceChildren();for(const row of queue){const li=document.createElement('li');li.textContent=`${row.number}. ${row.profile.label || row.profile.id} · ${row.status}`;$('queue').append(li);}
  const done=queue.filter(r=>['completed','sheet confirmed'].includes(r.status)).length;$('progress').max=queue.length || 1;$('progress').value=done;
  $('resume').hidden=active || anotherTab || !queue.some(r=>r.status==='queued');
}
try{
 const locks=await navigator.locks?.query();anotherTab=Boolean(locks?.held.some(lock=>lock.name==='yatra-phone-runner'));
 const saved=await get('state');if(saved){({rows,queue,results}=saved);$('deviceLabel').value=saved.label || '';$('pushSheet').checked=Boolean(saved.pushSheet);let interrupted=false;for(const row of queue)if(!anotherTab && ['filling','submitting'].includes(row.status)){row.status='interrupted — check saved results / Sheet before repeating';interrupted=true;}
 if(interrupted){$('status').textContent='Previous run was interrupted. Completed results are retained; resume runs only people still queued.';await persist();}}
}catch(e){fail(`Device storage: ${e.message}`);}
if(anotherTab){$('badge').textContent='Running in another tab';$('status').textContent='This device already has a running batch. Return to its original tab. This page will not change it.';}
$('add').onclick=()=>{try{
 const copies=Number($('copies').value);if(!Number.isInteger(copies)||copies<1||copies>1000)throw Error('Copies must be 1–1000');
 const answers=JSON.parse($('overrides').value || '{}');if(!answers || Array.isArray(answers) || typeof answers!=='object')throw Error('Fixed answers must be a JSON object');
 for(const [key,value] of Object.entries(answers))if(!/^[a-zA-Z][a-zA-Z0-9_]*(?:\[\])?$/.test(key)||/^(synthetic|device|geo|survey|choiceBlock|__)/i.test(key)||!(['string','number','boolean'].includes(typeof value)||Array.isArray(value)&&value.every(v=>typeof v==='string')))throw Error(`Unsupported setting: ${key}`);
 const p=library.find(p=>p.id===$('persona').value);rows.push({presetId:p.id,label:p.label || p.id,copies,sampling:$('sampling').value,answers});render();persist().catch(e=>fail(e.message));fail('');
 }catch(e){fail(e.message);}};
async function acquireWake(){try{if('wakeLock' in navigator){wakeLock=await navigator.wakeLock.request('screen');$('wake').textContent='Screen wake lock requested. Keep the page in the foreground.';wakeLock.addEventListener('release',()=>{$('wake').textContent='Screen wake lock released. Keep the screen awake manually.';});}else $('wake').textContent='Automatic screen wake lock is unavailable. Keep the screen awake manually.';}catch{$('wake').textContent='Screen wake lock unavailable. Keep the screen awake manually.';}}
document.addEventListener('visibilitychange',()=>{$('visibility').hidden=!active || document.visibilityState==='visible';if(active && document.visibilityState==='visible')acquireWake();});
window.addEventListener('beforeunload',event=>{if(active){event.preventDefault();event.returnValue='';}});
async function execute(resume=false){
 fail('');if(!navigator.locks){fail('Use a current browser over HTTPS (or localhost). This device needs browser locks to prevent duplicate runs.');return;}
 await navigator.locks.request('yatra-phone-runner',{ifAvailable:true},async lock=>{
  if(!lock){fail('A batch is already running in another tab on this device. Return to that tab.');return;}
  active=true;controller=new AbortController();const runId=crypto.randomUUID(),seed=crypto.getRandomValues(new Uint32Array(1))[0];
  try{
   if(!resume){queue=[];for(const row of rows){const base=row.profile || library.find(p=>p.id===row.presetId);if(!base)throw Error(`Persona no longer available: ${row.label}`);for(let n=0;n<row.copies;n++)queue.push({number:queue.length+1,status:'queued',profile:{...base,answers:{...base.answers,...row.answers},sampleSimilar:row.sampling==='similar',fixedAnswers:{...(row.custom?base.answers:base.userCreated?base.fixedAnswers || base.answers:{}),...row.answers}}});}}
   render();await persist();await acquireWake();$('monitor').scrollIntoView({behavior:'smooth'});$('badge').textContent='Running';
   for(let i=0;i<queue.length;i++){
    if(controller.signal.aborted)break;const entry=queue[i];if(entry.status!=='queued')continue;
    entry.status='filling';render();await persist();$('status').textContent=`Person ${i+1} of ${queue.length} · ${entry.profile.label || entry.profile.id}`;
    let result;
    try{
     result=await runPerson({frame:$('survey'),profile:entry.profile,model,pacingModel,personIndex:i,seed,signal:controller.signal,report:event=>{if(event.type==='page')$('field').textContent=event.page.replaceAll('-',' ');else $('field').textContent=`${event.name}: ${event.value}`;}});
     result.deviceLabel=$('deviceLabel').value;result.runId=runId;result.person=entry.number;results.push(result);entry.status='completed';await persist();
     if($('pushSheet').checked){entry.status='submitting';result.submission={status:'pending'};await persist();render();
      try{result.submission=await sendToSheet(result.post);entry.status='sheet confirmed';}
      catch(error){result.submission={status:'unconfirmed',error:error.message};result.comments.push('Sheet acknowledgement unavailable. Check the Sheet before retrying; delivery may have occurred.');entry.status='sheet unconfirmed — check before repeating';await persist();throw Error('Sheet acknowledgement could not be verified. Batch stopped; local response retained. Check the Sheet before retrying.');}
     }
     render();await persist();
    }catch(error){if(!result){entry.status=controller.signal.aborted?'stopped':'failed';results.push({status:entry.status,runId,person:entry.number,label:entry.profile.label || entry.profile.id,error:error.message,comments:[error.message]});}await persist();throw error;}
   }
   $('status').textContent=controller.signal.aborted?'Stopped. Queued people can be resumed.':'Batch complete. Download the results from this device.';
  }catch(error){$('status').textContent=controller.signal.aborted?'Stopped. Completed results are retained.':'Batch stopped; review the issue below.';if(!controller.signal.aborted)fail(error.message);}
  finally{active=false;await wakeLock?.release().catch(()=>{});$('badge').textContent='Ready';$('visibility').hidden=true;render();await persist();}
 });
}
$('start').onclick=()=>{if(queue.some(r=>r.status!=='queued') && !confirm('Start a NEW batch from this list? People already completed will run again. Use Resume queued people to continue only pending people.'))return;execute().catch(e=>fail(e.message));};
$('resume').onclick=()=>execute(true).catch(e=>fail(e.message));
$('stop').onclick=()=>{controller?.abort();$('stop').disabled=true;$('status').textContent='Stopping after the current browser operation. Do not close the page yet.';};
$('export').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify({deviceLabel:$('deviceLabel').value,exportedAt:new Date().toISOString(),queue,results},null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=`yatra-phone-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);};
$('deviceLabel').onchange=()=>persist().catch(e=>fail(e.message));$('pushSheet').onchange=()=>persist().catch(e=>fail(e.message));render();
$('saveList').onclick=()=>{
 const list=rows.map(r=>({label:r.label,presetId:r.presetId,count:r.copies,sampling:r.sampling,answers:r.answers,custom:r.custom}));
 const url=URL.createObjectURL(new Blob([JSON.stringify(list,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='phone-batch.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
};
$('importList').onclick=()=>$('listFile').click();
$('listFile').onchange=async event=>{
 try{const file=event.target.files[0];if(!file)return;if(file.size>1000000)throw Error('List must be under 1 MB');const list=JSON.parse(await file.text());if(!Array.isArray(list)||list.length<1||list.length>500)throw Error('Import a list of 1–500 batch rows');
 const imported=list.map((r,i)=>{const copies=Number(r.count ?? r.copies);if(!Number.isInteger(copies)||copies<1||copies>1000)throw Error(`Row ${i+1}: copies must be 1–1000`);if(!['similar','template'].includes(r.sampling))throw Error(`Row ${i+1}: invalid sampling`);const profile=r.presetId==='manual'?makeCustomProfile(r.custom,library,`manual-${i}`):library.find(p=>p.id===r.presetId);if(!profile)throw Error(`Row ${i+1}: source persona is unavailable`);return {presetId:r.presetId,label:String(r.label || profile.label || profile.id).slice(0,80),copies,sampling:r.sampling,answers:validateExtraAnswers(r.answers || {}),...(r.custom?{custom:r.custom,profile}:{})};});
 rows=imported;render();await persist();fail('');
 }catch(error){fail(error.message);}finally{event.target.value='';}
};
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
