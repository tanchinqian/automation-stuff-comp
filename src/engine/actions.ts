import { CAUSES } from './knowledgeBase';
import type { CauseId, DefectId } from './types';

export interface ActionStep {
  order: number;
  causeId: CauseId;
  title: string;
  detail: string;
}

interface CauseAction {
  title: string;
  detail: string;
}

const CAUSE_ACTIONS: Record<CauseId, CauseAction> = {
  'air-bubble': {
    title: 'Check syringe for visible air bubbles',
    detail: 'Inspect the syringe and supply line under good lighting. Purge until the flow is continuous with no bubbles, then re-prime.',
  },
  'nozzle-blockage': {
    title: 'Inspect the dispensing nozzle for blockage',
    detail: 'Remove the needle, inspect the bore for dried material, clean or replace, then perform a purge cycle.',
  },
  'material-viscosity': {
    title: 'Verify material condition & viscosity',
    detail: 'Check the material batch number, expiry, and temperature. Confirm it matches the approved specification for this process.',
  },
  'pressure-unstable': {
    title: 'Verify dispensing pressure stability',
    detail: 'Watch the pressure gauge over several cycles. Check the regulator, supply line, and filters for drift or leaks.',
  },
  'dispense-time': {
    title: 'Verify dispensing time / shot size settings',
    detail: 'Confirm the on/off valve open time matches the recipe. Compare against the validated process parameters.',
  },
  'needle-height': {
    title: 'Check needle height / dispense gap',
    detail: 'Measure the gap between the needle tip and the part. Adjust to the validated height to prevent tailing and spread.',
  },
  temperature: {
    title: 'Check temperature stability',
    detail: 'Verify shop temperature and any heated dispense system. Material viscosity is temperature sensitive.',
  },
  'material-contamination': {
    title: 'Check material for contamination',
    detail: 'Look for separation, crusting, or foreign material. If contaminated, replace with a fresh, sealed cartridge.',
  },
  'syringe-empty': {
    title: 'Check syringe / cartridge fill level',
    detail: 'Confirm there is adequate material and the syringe is not pulling air from an empty state. Refill or replace.',
  },
  'valve-wear': {
    title: 'Inspect valve seals and wear',
    detail: 'Check needle packing, valve seat and seals for wear. Replace worn parts and recalibrate.',
  },
  'contamination-particle': {
    title: 'Check for particle contamination',
    detail: 'Filter or replace material, clean supply lines, and purge to remove intermittent foreign particles.',
  },
  'speed-motion': {
    title: 'Verify dispense speed and motion path',
    detail: 'Compare motion speed and acceleration to the validated recipe. Slow moves can cause tails; fast moves cause splash.',
  },
  'material-cure': {
    title: 'Check for material curing / skinning at the tip',
    detail: 'Look for dried material at the needle tip. Clean the tip and check dispense frequency or open-time settings.',
  },
  'fluid-separation': {
    title: 'Check for filler settling / separation',
    detail: 'If material has stood for a long time, re-mix according to the manufacturer instructions before use.',
  },
  'equipment-inspection': {
    title: 'Perform routine equipment inspection',
    detail: 'Run the preventive maintenance checklist: filters, regulators, couplings, and calibration.',
  },
};

/** Build a logical troubleshooting sequence ordered by the cause ranking. */
export function buildActionPlan(rankedCauses: CauseId[]): ActionStep[] {
  return rankedCauses
    .slice(0, 5)
    .map((causeId, i) => {
      const action = CAUSE_ACTIONS[causeId];
      return { order: i + 1, causeId, title: action.title, detail: action.detail };
    })
    .concat([
      {
        order: rankedCauses.slice(0, 5).length + 1,
        causeId: 'equipment-inspection',
        title: 'Perform test dispensing shots and compare results',
        detail: 'After each check, dispense several test shots and compare them against the golden sample before re-entering production.',
      },
    ]);
}

export function causeName(id: CauseId): string {
  return CAUSES[id]?.name ?? id;
}

export function defectIntro(defectId: DefectId): string {
  const map: Record<DefectId, string> = {
    'missing-dot': 'No material reaches the target location on the affected shots.',
    'undersized-dot': 'Material is dispensed but consistently below the required shot volume.',
    'oversized-dot': 'Material is dispensed but consistently above the required shot volume.',
    'inconsistent-volume': 'Shot-to-shot volume is not repeatable across the run.',
    'excessive-spread': 'Material floods beyond the intended footprint on the substrate.',
    'irregular-shape': 'Dots are present but misshapen (tails, teardrops, voids, non-round).',
  };
  return map[defectId] ?? '';
}