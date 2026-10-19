// Empirical test-fixture policy. No independent random answers or timing jitter.
const canonical = value => String(value ?? '').normalize('NFKC').replace(/[–—−]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();
const isTime = name => /(?:Time|Waiting)/.test(name) && !/^priority|^eval|^lastMileEval|^integrated/.test(name);
const isLeg = name => /^(primary|mainHaulTransfer|lastMile|interDham)/.test(name);
function modeField(name) {
  return name.replace(/(?:TimeBand|CostBand|TimeRange|CostRange|Time|Cost|FareBasis|Occupancy|WaitingRange|WaitingTime)_/, 'Mode_');
}
function modeValue(answers, name) { return answers[modeField(name)]; }
function compatible(value, options) {
  if (value === undefined || value === null) return undefined;
  if (!options?.length) return String(value);
  return options.find(o => canonical(o) === canonical(value));
}
function modal(rows, name, options) {
  const counts = new Map();
  for (const row of rows) {
    const raw = row.answers[name];
    const key = Array.isArray(raw) ? raw.filter(v => options.includes(v)).join('; ') : compatible(raw, options);
    if (key === undefined || key === '' || key === 'exact') continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en', { numeric: true }));
  return sorted.length ? { value: sorted[0][0], support: [...counts.values()].reduce((a,b) => a+b,0), modalCount: sorted[0][1] } : null;
}
export function selectDonor(model, profile) {
  const specified = model.donors.find(d => d.id === profile.empiricalDonor);
  if (specified) return specified;
  const score = d => {
    let score = d.shrines[0] === profile.shrines[0] ? 30 : 0;
    score += d.shrines.filter(s => profile.shrines.includes(s)).length * 8;
    score -= Math.abs(d.shrines.length - profile.shrines.length) * 3;
    for (const [name, weight] of [['travelType',12],['tripStatus',10],['age',6],['groupSize',2],['startPoint',8]]) if (profile.answers?.[name] === d.answers[name]) score += weight;
    return score;
  };
  return [...model.donors].sort((a,b) => score(b)-score(a) || a.id.localeCompare(b.id))[0];
}
export function chooseAnswer({ name, type, options = [], required, profile, donor, model, values = {}, cards = [] }) {
  const make = (value, source, support = 0) => ({ value, source, support });
  if (Object.hasOwn(profile.answers || {}, name)) {
    const raw = profile.answers[name];
    if (type === 'checkbox') return make([].concat(raw), 'manual-override');
    const value = compatible(raw, options);
    if (value === undefined) throw Error(`Invalid profile answer ${name}: ${raw}`);
    return make(value, 'manual-override');
  }
  if (name === 'dhamCurrentVisit') return make(profile.shrines, 'persona-itinerary');
  if (name.startsWith('dhamSequence_')) return make(profile.shrines[Number(name.split('_').pop())-1], 'persona-itinerary');
  if (/^group(Adults|Children|Elderly|AssistanceCount)$|^luckyDrawUpi$|^originCityDistrict$|^feedback/.test(name)) return make(null, 'optional-not-imputed');
  if (name === 'groupSize' && values.travelType === 'Solo') return make('1', 'party-consistency');
  if (isLeg(name) && /Cost/.test(name) && /^(Trek\/Walk|Walk)$/.test(modeValue(values, name) || '')) {
    const zero = options.find(o => /No cost|Included/.test(o)) || (!options.length ? '0' : options.find(o => o === '0'));
    if (zero !== undefined) return make(zero, 'walking-zero-fare-rule');
  }
  if (name === 'returnDham[]' || name === 'returnRoute[]') return make(values[name] || null, 'survey-generated-return-route');
  if (/^return(Mode|Time|Cost|FareBasis|Occupancy)_/.test(name)) {
    const key = name.split('_')[0];
    const value = compatible(donor?.returnAnswers?.[key], options);
    if (value !== undefined) return make(value, 'observed-return-template', 1);
    return make(null, 'missing-return-template');
  }
  if (/^(primary|interDham).*Occupancy/.test(name) || /^primaryOccupancy_/.test(name)) {
    const mode = modeValue(values, name) || '';
    if (/Bike/.test(mode)) return make(options.includes('2') ? '2' : options[0], 'vehicle-capacity-rule');
    const observed = compatible(donor?.answers[name], options);
    if (observed === undefined && mode) {
      const rows = [];
      for (const d of model.donors) for (const [key, value] of Object.entries(d.answers)) {
        if (/^(primaryOccupancy|interDhamOccupancy)_/.test(key) && canonical(modeValue(d.answers, key)) === canonical(mode)) rows.push({ answers: { [name]: value } });
      }
      const stat = modal(rows, name, options);
      if (stat) return { ...stat, source: 'empirical-vehicle-occupancy' };
    }
  }
  if (/^(main_haul|last_mile)_.*Task/.test(name)) {
    // A transparent scenario heuristic, not an estimated choice model.
    const preferences = { ...donor?.answers, ...profile.answers };
    const weight = key => Number(preferences[key] || 3);
    const maxCost = Math.max(1, ...cards.map(c => c.cost || 0)), maxTime = Math.max(1, ...cards.map(c => c.time || 0));
    const utility = c => -weight('priorityCost') * (c.cost || 0) / maxCost - weight('priorityTime') * (c.time || 0) / maxTime
      + weight('priorityComfort') * (c.comfort || 0) / 3 + weight('priorityReliability') * (c.reliability || 0) / 3;
    const best = [...cards].sort((a,b) => utility(b)-utility(a) || a.value.localeCompare(b.value))[0];
    return { ...make(best?.value || options[0], 'assumed-priority-choice-rule'), alternatives: cards.map(c => ({ ...c, utility: utility(c) })) };
  }
  // Timing is deliberately held at the modal observed band for the active leg and mode.
  // Legacy rows where primaryRoute is a whole multi-shrine itinerary cannot calibrate a single leg.
  if (isTime(name) && isLeg(name)) {
    let rows = model.donors.filter(d => d.answers[name] !== undefined && (!name.startsWith('primaryTime_') || (d.routes?.[name.replace('primaryTime_', 'primaryRoute_')] || '').split('→').length === 2));
    const mode = modeValue(values, name);
    const withMode = rows.filter(d => !mode || canonical(modeValue(d.answers, name)) === canonical(mode));
    const borrowedMode = Boolean(mode && !withMode.length);
    if (withMode.length) rows = withMode;
    let context = [];
    if (name.startsWith('primaryTime_')) context = ['startPoint', ...(values.startPoint === 'Other' ? ['otherStartPoint'] : [])];
    if (/MountainTime/.test(name)) context = ['lastMileApproachDestination_HemkundSahib'];
    const routeKey = name.replace(/TimeBand_|Time_/, 'Route_');
    const liveRoute = values[routeKey];
    if (liveRoute) {
      const sameRoute = rows.filter(d => canonical(d.routes?.[routeKey] || d.answers[routeKey]) === canonical(liveRoute));
      if (sameRoute.length) rows = sameRoute;
    }
    const matched = rows.filter(d => context.every(key => !values[key] || canonical(d.answers[key]) === canonical(values[key])));
    const exact = modal(matched, name, options);
    if (exact) return { ...exact, source: borrowedMode ? 'empirical-leg-other-mode-assumption' : 'empirical-leg-mode-context' };
    const broader = modal(rows, name, options);
    if (broader) return { ...broader, source: borrowedMode ? 'empirical-leg-other-mode-assumption' : 'empirical-leg-mode-broader-context' };
    return make(null, 'missing-leg-time-data');
  }
  // Reuse the coherent template before attempting broader imputation.
  const raw = donor?.answers[name];
  if (type === 'checkbox' && raw !== undefined) return make([].concat(raw).filter(v => options.includes(v) && canonical(v) !== 'other'), 'observed-template', 1);
  const donorValue = compatible(raw, options);
  const noFreeOther = value => canonical(value) !== 'other' && value !== 'exact';
  const numeric = ['number','range'].includes(type);
  if (donorValue === 'exact' && /CostBand|CostRange/.test(name) && Number.isFinite(Number(donor.answers[name.replace(/CostBand|CostRange/, 'Cost')]))) return make('exact', 'observed-exact-cost', 1);
  if (donorValue !== undefined && noFreeOther(donorValue) && (!numeric || Number.isFinite(Number(donorValue)))) return make(donorValue, 'observed-template', 1);
  let pool = model.donors;
  if (isLeg(name)) {
    const mode = modeValue(values, name);
    if (mode) pool = pool.filter(d => canonical(modeValue(d.answers, name)) === canonical(mode));
  }
  if (numeric) pool = pool.filter(d => d.answers[name] !== undefined && Number.isFinite(Number(d.answers[name])));
  const usable = options.filter(noFreeOther);
  const stat = modal(pool, name, options.length ? usable : []);
  if (stat) return { ...stat, value: type === 'checkbox' ? stat.value.split('; ').filter(Boolean) : stat.value, source: 'empirical-field-mode' };
  if (/^interDhamMode_/.test(name)) {
    const mode = Object.entries(values).find(([key]) => /^primaryMode_/.test(key))?.[1];
    const value = compatible(mode, options);
    if (value) return make(value, 'assumed-same-road-mode-different-vehicle');
  }
  // No unsupported arbitrary values for optional fields or journey facts.
  if (!required) return make(null, 'optional-no-data');
  if (isLeg(name)) return make(null, 'missing-required-journey-data');
  const neutral = usable.find(o => /^(prefer not|not applicable|no$|maybe$)/i.test(o)) || usable.find(o => o === '3');
  return make(neutral ?? null, neutral ? 'explicit-neutral-fallback' : 'missing-required-data');
}
