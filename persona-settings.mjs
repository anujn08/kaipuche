const SHRINES = ['Yamunotri', 'Gangotri', 'Kedarnath', 'Badrinath', 'Hemkund Sahib'];
const AGES = ['Under 15', '15-24', '25-34', '35-44', '45-54', '55-64', '65 and above'];
export function validateExtraAnswers(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Extra answers must be a JSON object');
  for (const [key, v] of Object.entries(value)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]*(?:\[\])?$/.test(key) || /^(synthetic|device|geo|survey|choiceBlock|__)/i.test(key)) throw Error(`Unsupported answer field: ${key}`);
    if (!['string','number','boolean'].includes(typeof v) && !(Array.isArray(v) && v.every(item => typeof item === 'string'))) throw Error(`Invalid answer value for ${key}`);
  }
  return value;
}
export function makeCustomProfile(c, presets = [], id = 'custom-persona') {
  if (!c || !Array.isArray(c.shrines) || !c.shrines.length || c.shrines.some(s => !SHRINES.includes(s)) || new Set(c.shrines).size !== c.shrines.length) throw Error('Select at least one shrine, without duplicates');
  if (!['Solo', 'Group'].includes(c.travelType) || !['Completed', 'Ongoing', 'Being planned'].includes(c.tripStatus) || !AGES.includes(c.age)) throw Error('Invalid custom persona');
  const size = c.travelType === 'Solo' ? 1 : c.groupSize;
  if (!Number.isInteger(size) || size < 1 || size > 1000 || (c.travelType === 'Group' && size < 2)) throw Error('Group size must be an integer from 2 to 1000');
  const base = c.baseId ? presets.find(p => p.id === c.baseId) : undefined;
  if (c.baseId && !base) throw Error('The base persona no longer exists');
  const core = { travelType:c.travelType, groupSize:String(size), tripStatus:c.tripStatus, age:c.age };
  const extra = validateExtraAnswers(c.extraAnswers || {});
  for (const key of Object.keys(core)) if (Object.hasOwn(extra, key)) throw Error(`Set ${key} using the person-detail controls instead of extra answers`);
  return { id, ...(c.label ? {label:String(c.label).trim().slice(0,80)} : {}), shrines:[...c.shrines],
    ...(base?.empiricalDonor && base.shrines[0] === c.shrines[0] ? {empiricalDonor:base.empiricalDonor} : {}),
    ...(base ? {basedOn:base.id} : {}),
    answers:{...base?.answers,...core,...extra}, fixedAnswers:{...base?.fixedAnswers,...core,...extra} };
}
export function prepareRun(input, presets) {
  const integer = (value, min, max, label) => {
    if (!Number.isInteger(value) || value < min || value > max) throw Error(`${label} must be an integer from ${min} to ${max}`);
    return value;
  };
  let count = input.mode === 'batch' ? 0 : integer(input.count, 1, 10000, 'People');
  const fieldDelay = integer(input.fieldDelay, 0, 5000, 'Field delay');
  if (!['normal', 'fast'].includes(input.pacing)) throw Error('Choose normal or fast pacing');
  if (!['msedge', 'chrome', 'chromium'].includes(input.browser)) throw Error('Choose a supported browser');
  if (typeof input.showBrowser !== 'boolean' || typeof input.pushSheet !== 'boolean') throw Error('Invalid run options');
  let profiles;
  const customProfile = (c, id) => makeCustomProfile(c, presets, id);
  const overrides = validateExtraAnswers;
  if (input.mode === 'custom') {
    profiles = [customProfile(input.custom)];
  } else if (input.mode === 'presets') {
    if (!Array.isArray(input.personas) || !input.personas.length || input.personas.some(id => !presets.some(p => p.id === id))) throw Error('Choose at least one persona');
    profiles = [...new Set(input.personas)].map(id => presets.find(p => p.id === id));
  } else if (input.mode === 'batch') {
    if (!Array.isArray(input.batch) || !input.batch.length || input.batch.length > 500) throw Error('Add 1–500 rows to the batch');
    profiles = [];
    input.batch.forEach((row, index) => {
      try {
        const copies = integer(row.count, 1, 10000, 'Row count');
        count += copies;
        if (count > 10000) throw Error('Batch total cannot exceed 10,000');
        if (!['template','similar'].includes(row.sampling)) throw Error('Choose template or similar samples');
        const base = row.presetId === 'manual' ? customProfile(row.custom, `manual-${index+1}`) : presets.find(p => p.id === row.presetId);
        if (!base) throw Error('Choose a valid source persona');
        const answers = overrides(row.answers || {});
        for (let sample = 0; sample < copies; sample++) profiles.push({ ...base,
          id: `batch-${index+1}-${sample+1}`, label: String(row.label || base.label || base.id).slice(0,80),
          sampleSimilar: row.sampling === 'similar', fixedAnswers: row.presetId === 'manual' ? { ...base.answers, ...answers } : { ...(base.userCreated ? base.fixedAnswers || base.answers : {}), ...answers },
          answers: { ...base.answers, ...answers }, batchRow: index + 1 });
      } catch (err) { throw Error(`Row ${index+1}: ${err.message}`); }
    });
  } else throw Error('Choose a persona mode');
  if (input.sampleSimilar && input.mode === 'presets') profiles = profiles.map(p => ({ ...p, sampleSimilar: true, fixedAnswers: p.userCreated ? p.fixedAnswers || p.answers : {} }));
  const args = ['--count', String(count), '--field-delay-ms', String(fieldDelay)];
  if (input.browser !== 'chromium') args.push('--channel', input.browser);
  if (input.showBrowser) args.push('--headed');
  if (input.pushSheet) args.push('--push-sheet');
  if (input.pacing === 'fast') args.push('--fast');
  return { profiles, args, count, pushSheet: input.pushSheet };
}
