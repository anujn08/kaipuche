import { selectDonor } from './answer-policy.mjs';

export function resolvePerson(profile, model, seed, personIndex) {
  const base = selectDonor(model, profile);
  if (!profile.sampleSimilar) return { profile, donor: base, samplePool: 1 };
  const first = profile.shrines[0], modeField = `primaryMode_${first.replaceAll(' ', '')}_route`;
  const fixed = profile.fixedAnswers || (profile.empiricalDonor ? {} : profile.answers || {});
  const mode = fixed[modeField] || base.answers[modeField];
  const candidates = model.donors.filter(d => d.shrines[0] === first
    && d.shrines.length === profile.shrines.length && d.shrines.every(s => profile.shrines.includes(s))
    && (!mode || d.answers[modeField] === mode)
    && Object.entries(fixed).every(([key,value]) => d.answers[key] === undefined || String(d.answers[key]) === String(value)));
  const pool = candidates.length ? candidates : [base];
  const index = ((seed + personIndex) % pool.length + pool.length) % pool.length;
  const donor = pool[index];
  const identity = Object.fromEntries(['age','gender','travelType','groupSize','tripStatus','startPoint','otherStartPoint','occupation','originStateUT'].filter(k => donor.answers[k] !== undefined).map(k => [k, donor.answers[k]]));
  return { profile: { ...profile, empiricalDonor: donor.id, answers: { ...identity, ...fixed } }, donor, samplePool: pool.length };
}
