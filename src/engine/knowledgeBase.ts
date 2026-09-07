import type {
  CauseId,
  CauseInfo,
  DefectId,
  DefectInfo,
  MaterialType,
  QuestionDef,
  SymptomId,
  SymptomInfo,
} from './types';

export const MATERIALS: Record<MaterialType, string> = {
  adhesive: 'Adhesive',
  'solder-paste': 'Solder Paste',
  epoxy: 'Epoxy',
  sealant: 'Sealant',
  'conformal-coating': 'Conformal Coating',
  'thermal-paste': 'Thermal Paste',
};

export const SYMPTOMS: Record<SymptomId, SymptomInfo> = {
  'amount-too-small': { id: 'amount-too-small', label: 'Amount too small', question: 'Is the dispensed amount too small?' },
  'amount-too-large': { id: 'amount-too-large', label: 'Amount too large', question: 'Is the dispensed amount too large?' },
  'inconsistent-size': { id: 'inconsistent-size', label: 'Inconsistent dot size', question: 'Are dot sizes inconsistent between shots?' },
  'missing-occasionally': { id: 'missing-occasionally', label: 'Missing dots occasionally', question: 'Are dots missing entirely on some shots?' },
  'missing-location': { id: 'missing-location', label: 'Missing at specific locations', question: 'Are dots missing at specific locations?' },
  'spread-beyond': { id: 'spread-beyond', label: 'Material spreads beyond area', question: 'Does material spread beyond the intended area?' },
  'shape-irregular': { id: 'shape-irregular', label: 'Irregular dot shape', question: 'Is the dot shape irregular (not round)?' },
  'occurrence-continuous': { id: 'occurrence-continuous', label: 'Happens continuously', question: 'Does the defect happen continuously?' },
  'occurrence-occasional': { id: 'occurrence-occasional', label: 'Happens occasionally', question: 'Does the defect happen occasionally?' },
  'occurrence-once': { id: 'occurrence-once', label: 'Happened once', question: 'Did it happen only once?' },
  'time-based-drift': { id: 'time-based-drift', label: 'Gets worse over run time', question: 'Does it get worse after the machine has been running a while?' },
  'recent-change-material': { id: 'recent-change-material', label: 'Material recently changed', question: 'Has the material recently been changed?' },
  'recent-change-nozzle': { id: 'recent-change-nozzle', label: 'Nozzle recently changed', question: 'Has the nozzle recently been changed or cleaned?' },
  'recent-change-parameter': { id: 'recent-change-parameter', label: 'Process settings recently changed', question: 'Have process settings (pressure / time) recently changed?' },
  'single-location': { id: 'single-location', label: 'Single location affected', question: 'Is the defect at one location only?' },
  'multi-location': { id: 'multi-location', label: 'Multiple locations affected', question: 'Is the defect across multiple locations?' },
  'surface-wetting': { id: 'surface-wetting', label: 'Poor wetting / spread', question: 'Does the material wet the surface more than expected?' },
  'material-voids': { id: 'material-voids', label: 'Voids / bubbles in material', question: 'Are there visible voids or bubbles in the dispensed material?' },
  'starts-after-pause': { id: 'starts-after-pause', label: 'Worse after machine pause', question: 'Is it worse right after a machine pause or restart?' },
  'dot-elongated': { id: 'dot-elongated', label: 'Dots elongated / tailing', question: 'Are dots stretched or have tails?' },
  'volume-decreases-over-time': { id: 'volume-decreases-over-time', label: 'Volume drops over time', question: 'Does dispense volume slowly decrease over time?' },
  'pressure-visible-fluctuation': { id: 'pressure-visible-fluctuation', label: 'Pressure gauge fluctuates', question: 'Does the pressure gauge fluctuate visibly?' },
  'material-changed-batch': { id: 'material-changed-batch', label: 'New material batch', question: 'Is this a new batch / lot of the same material?' },
  'speed-slow-fast': { id: 'speed-slow-fast', label: 'Dispense speed changed', question: 'Has the dispense speed changed recently?' },
  'height-distance': { id: 'height-distance', label: 'Needle height changed', question: 'Has the needle height / dispense gap changed?' },
  'temperature-varied': { id: 'temperature-varied', label: 'Temperature has varied', question: 'Has shop or material temperature varied?' },
  'purge-not-done': { id: 'purge-not-done', label: 'Syringe not purged', question: 'Was the syringe purged before starting?' },
  'needle-tip-buildup': { id: 'needle-tip-buildup', label: 'Material buildup on needle tip', question: 'Is there dried material built up on the needle tip?' },
};

export const CAUSES: Record<CauseId, CauseInfo> = {
  'air-bubble': {
    id: 'air-bubble',
    name: 'Air trapped in syringe / supply',
    category: 'Air',
    prior: 0.22,
    description: 'Air pockets inside the syringe or supply line compress before dispensing, causing intermittent under-fill or missed dots.',
  },
  'nozzle-blockage': {
    id: 'nozzle-blockage',
    name: 'Partially blocked nozzle',
    category: 'Nozzle',
    prior: 0.24,
    description: 'Dried material or contamination partially blocks the needle bore, reducing or redirecting flow.',
  },
  'material-viscosity': {
    id: 'material-viscosity',
    name: 'Material viscosity change',
    category: 'Material',
    prior: 0.24,
    description: 'Viscosity drifted (temperature, batch, evaporation), changing the flow rate for the same pressure and time.',
  },
  'pressure-unstable': {
    id: 'pressure-unstable',
    name: 'Unstable dispensing pressure',
    category: 'Dispensing Parameter',
    prior: 0.23,
    description: 'Air supply fluctuation, regulator drift or leaks make the applied pressure inconsistent.',
  },
  'dispense-time': {
    id: 'dispense-time',
    name: 'Dispense time / shot size incorrect',
    category: 'Dispensing Parameter',
    prior: 0.22,
    description: 'On/off valve timing or open time yields more or less material than the target shot size.',
  },
  'needle-height': {
    id: 'needle-height',
    name: 'Needle height / gap incorrect',
    category: 'Process',
    prior: 0.21,
    description: 'Needle-to-part gap affects dot shape, tailing, and whether material wets out before the needle lifts.',
  },
  temperature: {
    id: 'temperature',
    name: 'Temperature variation',
    category: 'Material',
    prior: 0.20,
    description: 'Material viscosity is temperature sensitive; temperature swings change flow.',
  },
  'material-contamination': {
    id: 'material-contamination',
    name: 'Material contamination / separation',
    category: 'Material',
    prior: 0.18,
    description: 'Contamination or separation of components (e.g., filler settling) changes flow behaviour.',
  },
  'syringe-empty': {
    id: 'syringe-empty',
    name: 'Syringe / cartridge running low',
    category: 'Equipment',
    prior: 0.22,
    description: 'Low material level allows air to be drawn in or reduces achievable pressure.',
  },
  'valve-wear': {
    id: 'valve-wear',
    name: 'Valve or seal wear',
    category: 'Equipment',
    prior: 0.18,
    description: 'Worn seals, needle packing or valve seat cause inconsistent opening/closing.',
  },
  'contamination-particle': {
    id: 'contamination-particle',
    name: 'Particle contamination',
    category: 'Material',
    prior: 0.18,
    description: 'Foreign particles intermittently lodge in the needle, causing occasional missed or undersized dots.',
  },
  'speed-motion': {
    id: 'speed-motion',
    name: 'Motion / speed setting',
    category: 'Process',
    prior: 0.20,
    description: 'Dispense speed or motion path affects dot placement, tails and spread.',
  },
  'material-cure': {
    id: 'material-cure',
    name: 'Material curing / skinning in needle',
    category: 'Material',
    prior: 0.20,
    description: 'Material begins to cure in the needle tip between shots, gradually restricting flow.',
  },
  'fluid-separation': {
    id: 'fluid-separation',
    name: 'Fluid separation (fillers settle)',
    category: 'Material',
    prior: 0.18,
    description: 'Heavy fillers settle over time producing richer/leaner sections of material.',
  },
  'equipment-inspection': {
    id: 'equipment-inspection',
    name: 'General equipment condition',
    category: 'Equipment',
    prior: 0.14,
    description: 'Overall system requires routine inspection and maintenance.',
  },
};

export const DEFECTS: Record<DefectId, DefectInfo> = {
  'missing-dot': {
    id: 'missing-dot',
    name: 'Missing Dispensing Dot',
    description: 'The machine cycle runs, but no material or only a trace appears at the target location.',
    symptoms: ['missing-occasionally', 'missing-location', 'amount-too-small', 'occurrence-occasional', 'occurrence-once', 'single-location', 'starts-after-pause'],
    causeWeights: {
      'nozzle-blockage': 0.85,
      'syringe-empty': 0.85,
      'contamination-particle': 0.80,
      'air-bubble': 0.65,
      'pressure-unstable': 0.50,
      'valve-wear': 0.40,
      'equipment-inspection': 0.20,
    },
  },
  'undersized-dot': {
    id: 'undersized-dot',
    name: 'Undersized Dispensing Dot',
    description: 'A dot is dispensed but consistently smaller in volume than specification.',
    symptoms: ['amount-too-small', 'volume-decreases-over-time', 'occurrence-continuous', 'time-based-drift', 'needle-tip-buildup', 'temperature-varied', 'material-changed-batch'],
    causeWeights: {
      'nozzle-blockage': 0.85,
      'material-viscosity': 0.80,
      'material-cure': 0.80,
      'syringe-empty': 0.75,
      'dispense-time': 0.65,
      'pressure-unstable': 0.60,
      temperature: 0.50,
      'air-bubble': 0.35,
      'equipment-inspection': 0.15,
    },
  },
  'oversized-dot': {
    id: 'oversized-dot',
    name: 'Oversized Dispensing Dot',
    description: 'A dot is dispensed but consistently larger in volume than specification.',
    symptoms: ['amount-too-large', 'occurrence-continuous', 'temperature-varied', 'material-changed-batch', 'spread-beyond', 'recent-change-parameter'],
    causeWeights: {
      'dispense-time': 0.85,
      'material-viscosity': 0.80,
      'pressure-unstable': 0.75,
      'needle-height': 0.60,
      temperature: 0.60,
      'valve-wear': 0.40,
      'equipment-inspection': 0.15,
    },
  },
  'inconsistent-volume': {
    id: 'inconsistent-volume',
    name: 'Inconsistent Dispensing Volume',
    description: 'Dot-to-dot volume varies; some dots are larger and some smaller, results are not repeatable.',
    symptoms: ['inconsistent-size', 'volume-decreases-over-time', 'occurrence-occasional', 'material-voids', 'multi-location', 'time-based-drift', 'starts-after-pause', 'pressure-visible-fluctuation', 'surface-wetting', 'material-changed-batch'],
    causeWeights: {
      'pressure-unstable': 0.80,
      'valve-wear': 0.75,
      'fluid-separation': 0.80,
      'air-bubble': 0.75,
      'nozzle-blockage': 0.70,
      'material-viscosity': 0.65,
      'material-cure': 0.50,
      'equipment-inspection': 0.25,
    },
  },
  'excessive-spread': {
    id: 'excessive-spread',
    name: 'Excessive Material Spreading',
    description: 'Material spreads beyond the required footprint, flooding surrounding area.',
    symptoms: ['spread-beyond', 'surface-wetting', 'occurrence-continuous', 'temperature-varied', 'recent-change-parameter', 'amount-too-large', 'height-distance', 'material-changed-batch'],
    causeWeights: {
      'material-viscosity': 0.85,
      'needle-height': 0.85,
      temperature: 0.85,
      'dispense-time': 0.60,
      'pressure-unstable': 0.50,
      'speed-motion': 0.50,
      'equipment-inspection': 0.15,
    },
  },
  'irregular-shape': {
    id: 'irregular-shape',
    name: 'Irregular / Abnormal Dispensing Shape',
    description: 'Dots are present but misshapen: tails, teardrops, voids or non-round outlines.',
    symptoms: ['shape-irregular', 'dot-elongated', 'material-voids', 'occurrence-occasional', 'speed-slow-fast', 'height-distance', 'needle-tip-buildup', 'temperature-varied', 'material-changed-batch', 'recent-change-material'],
    causeWeights: {
      'speed-motion': 0.85,
      'needle-height': 0.85,
      'material-contamination': 0.85,
      'nozzle-blockage': 0.75,
      'material-cure': 0.65,
      'material-viscosity': 0.60,
      'air-bubble': 0.45,
      temperature: 0.40,
      'equipment-inspection': 0.20,
    },
  },
};

/**
 * Direct symptom -> cause evidence. Encodes standard industrial dispensing
 * troubleshooting knowledge: each symptom points at the causes it classically
 * implies, with a strength for how strongly it implicates that cause.
 */
export const SYMPTOM_CAUSES: Partial<Record<SymptomId, Partial<Record<CauseId, number>>>> = {
  'amount-too-small': { 'nozzle-blockage': 0.90, 'syringe-empty': 0.85, 'material-cure': 0.80, 'material-viscosity': 0.65, 'pressure-unstable': 0.50, 'dispense-time': 0.50, 'air-bubble': 0.35 },
  'amount-too-large': { 'dispense-time': 0.90, 'material-viscosity': 0.85, 'pressure-unstable': 0.75, temperature: 0.70, 'needle-height': 0.50, 'valve-wear': 0.45 },
  'inconsistent-size': { 'pressure-unstable': 0.85, 'valve-wear': 0.80, 'air-bubble': 0.75, 'nozzle-blockage': 0.70, 'fluid-separation': 0.70, 'material-viscosity': 0.55 },
  'missing-occasionally': { 'contamination-particle': 0.85, 'nozzle-blockage': 0.80, 'syringe-empty': 0.80, 'air-bubble': 0.65, 'valve-wear': 0.50 },
  'missing-location': { 'syringe-empty': 0.90, 'nozzle-blockage': 0.85, 'contamination-particle': 0.75, 'equipment-inspection': 0.40 },
  'spread-beyond': { 'material-viscosity': 0.90, 'needle-height': 0.85, temperature: 0.85, 'dispense-time': 0.60, 'pressure-unstable': 0.50 },
  'shape-irregular': { 'speed-motion': 0.85, 'needle-height': 0.80, 'material-contamination': 0.85, 'nozzle-blockage': 0.75, 'material-viscosity': 0.60, 'air-bubble': 0.40 },
  'occurrence-continuous': { 'nozzle-blockage': 0.70, 'material-viscosity': 0.65, 'dispense-time': 0.60, 'needle-height': 0.60, 'pressure-unstable': 0.50, temperature: 0.50 },
  'occurrence-occasional': { 'contamination-particle': 0.80, 'valve-wear': 0.75, 'pressure-unstable': 0.65, 'air-bubble': 0.55, 'material-cure': 0.50 },
  'occurrence-once': { 'contamination-particle': 0.70, 'material-contamination': 0.50, 'equipment-inspection': 0.40 },
  'time-based-drift': { 'fluid-separation': 0.95, 'material-cure': 0.90, 'material-viscosity': 0.80, 'syringe-empty': 0.80, temperature: 0.75, 'valve-wear': 0.65 },
  'volume-decreases-over-time': { 'syringe-empty': 0.95, 'material-cure': 0.90, 'nozzle-blockage': 0.75, 'fluid-separation': 0.65 },
  'material-voids': { 'air-bubble': 0.98, 'material-contamination': 0.75, 'fluid-separation': 0.50 },
  'starts-after-pause': { 'material-cure': 0.95, 'fluid-separation': 0.90, 'valve-wear': 0.80, 'nozzle-blockage': 0.75, 'air-bubble': 0.35 },
  'dot-elongated': { 'speed-motion': 0.95, 'needle-height': 0.90, 'material-viscosity': 0.60, 'material-cure': 0.50 },
  'pressure-visible-fluctuation': { 'pressure-unstable': 0.98, 'valve-wear': 0.75, 'equipment-inspection': 0.50 },
  'material-changed-batch': { 'material-viscosity': 0.95, 'material-contamination': 0.85, 'fluid-separation': 0.80, temperature: 0.40 },
  'recent-change-material': { 'material-viscosity': 0.90, 'material-contamination': 0.85, 'fluid-separation': 0.75 },
  'recent-change-nozzle': { 'nozzle-blockage': 0.90, 'needle-height': 0.85, 'equipment-inspection': 0.50 },
  'recent-change-parameter': { 'dispense-time': 0.95, 'pressure-unstable': 0.85, 'speed-motion': 0.80, 'needle-height': 0.75 },
  'single-location': { 'nozzle-blockage': 0.75, 'contamination-particle': 0.75, 'syringe-empty': 0.60, 'valve-wear': 0.40 },
  'multi-location': { 'pressure-unstable': 0.80, 'material-viscosity': 0.75, 'valve-wear': 0.70, temperature: 0.65, 'fluid-separation': 0.60, 'air-bubble': 0.40 },
  'surface-wetting': { temperature: 0.85, 'material-viscosity': 0.80, 'needle-height': 0.75, 'pressure-unstable': 0.45 },
  'temperature-varied': { temperature: 0.98, 'material-viscosity': 0.70, 'material-cure': 0.50 },
  'purge-not-done': { 'air-bubble': 0.98, 'nozzle-blockage': 0.75, 'material-cure': 0.65 },
  'needle-tip-buildup': { 'nozzle-blockage': 0.95, 'material-cure': 0.90, 'speed-motion': 0.40 },
  'speed-slow-fast': { 'speed-motion': 0.98, 'needle-height': 0.60, 'material-viscosity': 0.40 },
  'height-distance': { 'needle-height': 0.98, 'speed-motion': 0.55, 'material-viscosity': 0.40 },
};

export const QUESTION_FLOW: { ids: string[] } = {
  ids: ['q-material', 'q-amount', 'q-occurrence', 'q-recent-change', 'q-location'],
};

/** Primary smart questions (Step 1 of the spec) */
export const BASE_QUESTIONS: QuestionDef[] = [
  {
    id: 'q-material',
    text: 'What material is being dispensed?',
    intent: 'single' as const,
    options: Object.entries(MATERIALS).map(([id, label]) => ({
      id,
      label,
      adds: [] as SymptomId[],
    })),
  },
  {
    id: 'q-amount',
    text: 'How does the dispensed result look?',
    intent: 'single' as const,
    options: [
      { id: 'too-small', label: 'Too little material', adds: ['amount-too-small'] },
      { id: 'too-large', label: 'Too much material', adds: ['amount-too-large'] },
      { id: 'inconsistent', label: 'Inconsistent sizes between shots', adds: ['inconsistent-size'] },
      { id: 'missing', label: 'Dots missing entirely', adds: ['missing-occasionally', 'missing-location'] },
      { id: 'spreading', label: 'Material spreading beyond area', adds: ['spread-beyond', 'surface-wetting'] },
      { id: 'shape', label: 'Irregular or abnormal shape', adds: ['shape-irregular', 'dot-elongated'] },
    ],
  },
  {
    id: 'q-occurrence',
    text: 'How often does the defect occur?',
    intent: 'single' as const,
    options: [
      { id: 'continuous', label: 'Continuously / every shot', adds: ['occurrence-continuous'] },
      { id: 'occasional', label: 'Occasionally / sometimes', adds: ['occurrence-occasional'] },
      { id: 'once', label: 'Only happened once', adds: ['occurrence-once'] },
    ],
  },
  {
    id: 'q-recent-change',
    text: 'Has anything recently changed (material, nozzle, or process settings)?',
    intent: 'single' as const,
    options: [
      { id: 'material', label: 'Material changed', adds: ['recent-change-material', 'material-changed-batch'] },
      { id: 'nozzle', label: 'Nozzle changed / cleaned', adds: ['recent-change-nozzle', 'purge-not-done'] },
      { id: 'parameter', label: 'Process settings changed', adds: ['recent-change-parameter', 'pressure-visible-fluctuation'] },
      { id: 'nothing', label: 'Nothing changed', adds: [] },
    ],
  },
  {
    id: 'q-location',
    text: 'Where is the defect happening?',
    intent: 'single' as const,
    options: [
      { id: 'single', label: 'At one specific location', adds: ['single-location', 'missing-location'] },
      { id: 'multiple', label: 'Across multiple locations', adds: ['multi-location'] },
      { id: 'varies', label: 'Location varies between runs', adds: ['multi-location', 'occurrence-occasional'] },
    ],
  },
];

/** Bonus challenge: dynamic follow-up questions that branch off user answers */
export const FOLLOW_UPS: QuestionDef[] = [
  {
    id: 'fu-drift',
    text: 'Does the problem get worse after the machine has been running for a while?',
    intent: 'single',
    options: [
      { id: 'yes-drift', label: 'Yes, it gets worse over time', adds: ['time-based-drift', 'volume-decreases-over-time'] },
      { id: 'no-drift', label: 'No, it is consistent from the start', adds: [] },
    ],
  },
  {
    id: 'fu-pause',
    text: 'Is it worse right after a machine pause or restart?',
    intent: 'single',
    options: [
      { id: 'yes-pause', label: 'Yes, worse after a pause', adds: ['starts-after-pause'] },
      { id: 'no-pause', label: 'No', adds: [] },
    ],
  },
  {
    id: 'fu-temperature',
    text: 'Has shop or material temperature varied during production?',
    intent: 'single',
    options: [
      { id: 'yes-temp', label: 'Yes, temperature has varied', adds: ['temperature-varied'] },
      { id: 'no-temp', label: 'No, temperature is stable', adds: [] },
    ],
  },
  {
    id: 'fu-bubbles',
    text: 'Can you see air bubbles or voids in the syringe or dispensed material?',
    intent: 'single',
    options: [
      { id: 'yes-bubbles', label: 'Yes, visible bubbles', adds: ['material-voids'] },
      { id: 'no-bubbles', label: 'No', adds: [] },
    ],
  },
  {
    id: 'fu-tip',
    text: 'Is there dried material built up on the needle tip?',
    intent: 'single',
    options: [
      { id: 'yes-tip', label: 'Yes', adds: ['needle-tip-buildup', 'volume-decreases-over-time'] },
      { id: 'no-tip', label: 'No', adds: [] },
    ],
  },
];

/** Mapping: base-question answer -> follow-up question to ask (Bonus Challenge 1) */
export const FOLLOW_UP_RULES = [
  { questionId: 'q-occurrence', answerId: 'occasional', nextQuestionId: 'fu-drift' },
  { questionId: 'q-occurrence', answerId: 'continuous', nextQuestionId: 'fu-pause' },
  { questionId: 'q-recent-change', answerId: 'material', nextQuestionId: 'fu-temperature' },
  { questionId: 'q-recent-change', answerId: 'nothing', nextQuestionId: 'fu-bubbles' },
  { questionId: 'q-amount', answerId: 'missing', nextQuestionId: 'fu-bubbles' },
  { questionId: 'q-amount', answerId: 'shape', nextQuestionId: 'fu-tip' },
  { questionId: 'q-recent-change', answerId: 'nozzle', nextQuestionId: 'fu-tip' },
];
