const randomInt=(min,max)=>{const range=max-min,limit=Math.floor(4294967296/range)*range;let n;do{n=crypto.getRandomValues(new Uint32Array(1))[0];}while(n>=limit);return min+n%range;};
export function chooseCompletionSeconds(draw = randomInt) { return draw(300,421); }
export const SECTION_IDS = ['page-2-B','page-2B-journey','page-2C-lastmile','page-3-C','page-4-C-last-mile','page-5-acceptance','page-5-D','page-1-E','page-6-F'];
export const DCE_IDS = ['page-3-C','page-4-C-last-mile'];
export function createTimingPlan(model, targetSeconds, cardCounts, scale = 1) {
  const consent = Math.min(15,model.sections['page-0-consent']?.medianSeconds || 10);
  const pageWeight = id => Math.max(1,model.sections[id]?.medianSeconds || 20);
  const cardWeights = Object.fromEntries(DCE_IDS.map(id=>[id,(cardCounts[id] || 0)*Math.max(5,model.perCard[id]?.medianSeconds || 10)]));
  const cardTotal = Object.values(cardWeights).reduce((a,b)=>a+b,0);
  const total = Math.max(targetSeconds-consent,cardTotal ? cardTotal/0.55 : 0);
  const cardBudget = cardTotal ? total*0.55 : 0;
  const others = SECTION_IDS.filter(id=>!cardWeights[id]);
  const otherWeight = others.reduce((sum,id)=>sum+(DCE_IDS.includes(id)?5:pageWeight(id)),0);
  const pages = Object.fromEntries(SECTION_IDS.map(id=>[id,scale*(cardWeights[id] ? cardBudget*cardWeights[id]/cardTotal : (total-cardBudget)*(DCE_IDS.includes(id)?5:pageWeight(id))/otherWeight)]));
  return { source:model.sha256, dceMinimumShare:cardTotal?0.55:0, scale, consentSeconds:consent*scale, totalSeconds:(total+consent)*scale, cardCounts, pages };
}
