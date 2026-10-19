// Runs in the survey realm so the original conditional handlers and timers are used.
window.__phoneAlerts=[];
window.alert=message=>window.__phoneAlerts.push(String(message));
HTMLFormElement.prototype.submit=function(){window.__phonePost={url:this.action,fields:[...new FormData(this).entries()]};};
window.phoneBridge={
  ready:()=>typeof draftReady!=='undefined' && draftReady,
  current:()=>({index:currentTab,id:pages[currentTab].id}),
  counts:()=>Object.fromEntries(['page-3-C','page-4-C-last-mile'].map(id=>[id,new Set([...document.getElementById(id).querySelectorAll('input[type="radio"][name]')].map(c=>c.name).filter(n=>/^(main_haul|last_mile)_.*Task/.test(n))).size])),
  next:()=>nextPrev(1),
  response:()=>JSON.parse(localStorage.getItem('charDhamSurvey') || '[]').at(-1),
  clear:()=>{clearTimeout(draftSaveTimer);draftStarted=false;localStorage.removeItem(SURVEY_DRAFT_KEY);},
  init:(policy,report)=>{
    window.answerPolicy=policy;window.reportBotField=report;
    const banner=document.createElement('div');banner.id='bot-live-status';banner.style.cssText='position:fixed;bottom:4px;left:4px;right:4px;padding:8px;background:#193d32;color:white;font:12px sans-serif;z-index:999999;pointer-events:none';banner.textContent='Phone runner · local survey';document.body.append(banner);
  }
};
