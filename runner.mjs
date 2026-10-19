import * as policy from './answer-policy.mjs';
import {resolvePerson} from './sampling.mjs';
import {chooseCompletionSeconds,createTimingPlan} from './pacing.mjs';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,Math.max(0,ms)));
export async function runPerson({frame,profile,model,pacingModel,personIndex=0,seed,signal,report=()=>{},scale=1}){
  frame.hidden=false;
  // Scale is only exposed to the automated QA harness. The app always uses 1.
  const started=Date.now(),targetSeconds=chooseCompletionSeconds();
  const selected=resolvePerson(profile,model,seed,personIndex),steps=[];
  const check=()=>{if(signal?.aborted)throw new DOMException('Run stopped','AbortError');};
  const wait=async ms=>{const end=Date.now()+ms;while(Date.now()<end){check();await sleep(Math.min(250,end-Date.now()));}check();};
  if(frame.contentWindow?.phoneBridge)frame.contentWindow.phoneBridge.clear();
  localStorage.removeItem('charDhamSurveyDraftV1');
  for(const key of ['charDhamChoiceBlock','charDhamChoiceTaskNumbers','charDhamChoiceTaskMap'])sessionStorage.removeItem(key);
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Survey could not load. Check the connection.')),45000);
    frame.onload=()=>{clearTimeout(timer);resolve();};frame.src=`./survey/index.html?person=${crypto.randomUUID()}`;
  });
  const win=frame.contentWindow;
  try{
    const readyDeadline=Date.now()+45000;
    while(!win.phoneBridge?.ready()){check();if(Date.now()>readyDeadline)throw Error('Survey initialization timed out');await sleep(100);}
    win.phoneBridge.init(policy,field=>{check();report({type:'field',...field});});
    let plan;
    for(let step=0;step<11;step++){
      check();const before=win.phoneBridge.current();if(before.id==='page-7-thankyou')break;
      const pageStarted=Date.now();
      if(before.index===0 || before.index===2)plan=createTimingPlan(pacingModel,targetSeconds,win.phoneBridge.counts(),scale);
      let seconds=before.index===0?plan.consentSeconds:plan.pages[before.id] || 0;
      report({type:'page',page:before.id,targetSeconds});
      const filled=await win.phoneFill({profile:selected.profile,donor:selected.donor,model,fieldDelay:80,pageBudgetSeconds:seconds,pageStarted});
      if(before.index===1){plan=createTimingPlan(pacingModel,targetSeconds,win.phoneBridge.counts(),scale);seconds=plan.pages[before.id] || 0;}
      report({type:'field',name:'Reviewing section',value:`${Math.ceil(Math.max(0,pageStarted+seconds*1000-Date.now())/1000)} seconds`});
      await wait(pageStarted+seconds*1000-Date.now());
      steps.push({...before,filled,plannedSeconds:seconds,actualSeconds:(Date.now()-pageStarted)/1000});
      win.phoneBridge.next();if(win.phoneBridge.current().index===before.index)throw Error(`Survey validation stopped at ${before.id}: ${win.__phoneAlerts.join('; ')}`);
    }
    check();const response=win.phoneBridge.response();
    if(!win.__phonePost || !response)throw Error('No completed survey was captured');
    return {status:'completed',label:profile.label || profile.id,empiricalTemplate:selected.donor.id,samplePool:selected.samplePool,targetSeconds,timingPlan:plan,elapsedSeconds:(Date.now()-started)/1000,response,post:win.__phonePost,steps,comments:steps.flatMap(s=>s.filled.filter(f=>/fallback|broader-context|assum/.test(f.source) && f.source!=='assumed-priority-choice-rule').map(f=>`${f.name}: ${f.source}`)),submission:{status:'local-only'}};
  }finally{win.phoneBridge?.clear();}
}

export async function sendToSheet(post,fetcher=fetch){
  const url=new URL(post.url);
  if(url.protocol!=='https:' || url.hostname!=='script.google.com' || !/^\/macros\/s\/[^/]+\/exec$/.test(url.pathname))throw Error('Unexpected Sheet endpoint');
  const body=new URLSearchParams(post.fields);body.delete('syntheticTest');
  const response=await fetcher(url,{method:'POST',body,redirect:'follow',signal:AbortSignal.timeout(60000)});
  if(!response.ok)throw Error(`Sheet returned HTTP ${response.status}`);
  const data=await response.json();if(data.result!=='success' || !data.responseId)throw Error('No Sheet acknowledgement received');
  return {status:'confirmed',responseId:data.responseId};
}
