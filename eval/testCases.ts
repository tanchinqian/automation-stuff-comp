/**
 * Labelled eval dataset for the PasteTrace rule engine + free-text NLU.
 *
 * Every description below is written as an operator would say it, and is
 * deliberately worded differently from the app's own symptom labels, question
 * text and knowledge-base strings. The point is to measure generalisation of
 * the parser + scorer, not keyword recall against memorised UI copy.
 *
 * Expectations encode the clinically correct answer, not the engine's current
 * output. A failing case is a real result and is listed in the run summary.
 *
 * Fields:
 *   expectedDefect    - defect the description is describing (omit if out of scope)
 *   expectedTopCause  - cause a human would rank first (omit when the wording
 *                       does not pin one cause)
 *   expectLowConfidence - true for genuinely vague, contradictory or out-of-scope
 *                       text, where the low-confidence caveat SHOULD fire
 */
import type { CauseId, DefectId } from '../src/engine/types';

export interface EvalCase {
  id: string;
  description: string;
  expectedDefect?: DefectId;
  expectedTopCause?: CauseId;
  expectLowConfidence?: boolean;
  note?: string;
}

export const TEST_CASES: EvalCase[] = [
  // ---------------------------------------------------------------------
  // Clearly-described known defects / causes
  // ---------------------------------------------------------------------
  {
    id: 'known-missing-air-bubble',
    description:
      'The head goes through the cycle but the pad gets skipped completely, and it sometimes happens with no set pattern.',
    expectedDefect: 'missing-dot',
    expectedTopCause: 'air-bubble',
  },
  {
    id: 'known-undersized-nozzle-blockage',
    description:
      'Every time the machine fires, the pad comes out thinner than the drawing calls for, and the amount drops steadily through the shift. The needle bore looks partly restricted when we pull it.',
    expectedDefect: 'undersized-dot',
    expectedTopCause: 'nozzle-blockage',
  },
  {
    id: 'known-oversized-viscosity',
    description:
      'We switched to a different material lot and now every time the head fires the pad gets too much material - the dots are thick blobs.',
    expectedDefect: 'oversized-dot',
    expectedTopCause: 'material-viscosity',
  },
  {
    id: 'known-shape-needle-height',
    description:
      'Since the needle height was readjusted to sit higher above the board, the dots come out squashed and the outline is not round.',
    expectedDefect: 'irregular-shape',
    expectedTopCause: 'needle-height',
  },
  {
    id: 'known-spread-viscosity',
    description:
      'The paste runs well past the pad edges and the surface looks wet, so the footprint ends up way bigger than the stencil opening.',
    expectedDefect: 'excessive-spread',
    expectedTopCause: 'material-viscosity',
  },
  {
    id: 'known-inconsistent-voids',
    description:
      'The bead size varies from pad to pad, and when we look closely there are bubbles trapped in the material.',
    expectedDefect: 'inconsistent-volume',
    expectedTopCause: 'air-bubble',
  },
  {
    id: 'known-missing-single-location',
    description:
      'There is one spot on the panel that never gets any paste even though the rest is coated properly. It is the same place every cycle, and only that one place is affected. We also just swapped in a new needle.',
    expectedDefect: 'missing-dot',
    expectedTopCause: 'nozzle-blockage',
  },
  {
    id: 'known-inconsistent-pressure',
    description:
      'The operator noticed the gauge needle swinging back and forth during the pour, and the weight of each deposit swings with it.',
    expectedDefect: 'inconsistent-volume',
    expectedTopCause: 'pressure-unstable',
  },
  {
    id: 'known-undersized-cured-tip',
    description:
      'The needle tip has dried residue caked on it and each cycle pushes less and less through, with no other changes made on the line.',
    expectedDefect: 'undersized-dot',
    expectedTopCause: 'material-cure',
  },
  {
    id: 'known-oversized-dispense-time',
    description:
      'We changed pressure on the line on Monday, and now every time the head moves each pad gets too much material and it floods out toward the neighbouring pads.',
    expectedDefect: 'oversized-dot',
    expectedTopCause: 'dispense-time',
    note: 'Observed: the engine ranks material-viscosity above the explicitly pinned parameter change. Kept as a known gap, not retuned to match output.',
  },
  {
    id: 'known-shape-speed-motion',
    description:
      'Since the axis was set to travel faster between pads, the dots have a drawn out streak on one side.',
    expectedDefect: 'irregular-shape',
    expectedTopCause: 'speed-motion',
  },

  // ---------------------------------------------------------------------
  // Vague descriptions - no usable symptom should be confidently inferred
  // ---------------------------------------------------------------------
  {
    id: 'vague-unspecified',
    description:
      'A colleague flagged the output as odd, but I would have to stand at the machine before I could say what is actually wrong.',
    expectLowConfidence: true,
  },
  {
    id: 'vague-no-detail',
    description:
      'We are seeing problems with the deposits again and I am honestly not sure how to characterise them.',
    expectLowConfidence: true,
  },

  // ---------------------------------------------------------------------
  // Unrelated equipment - must not be force-fit to a dispensing cause
  // ---------------------------------------------------------------------
  {
    id: 'out-of-scope-reflow-oven',
    description:
      'The reflow oven conveyor keeps changing pace between shifts and the maintenance crew is handling it separately.',
    expectLowConfidence: true,
  },
  {
    id: 'out-of-scope-stray-token',
    description:
      'The conveyor speed on the reflow oven drifts between shifts and the maintenance team wants it looked at.',
    expectLowConfidence: true,
    note: 'Adversarial probe: a single incidental token (speed) is still a dispensing symptom id to the keyword tier. Expected to fail until the parser is context-aware.',
  },

  // ---------------------------------------------------------------------
  // Contradictory evidence - no single defect explains it
  // ---------------------------------------------------------------------
  {
    id: 'ambiguous-contradictory',
    description:
      'Every time I look the results are different - one pad flooded, the next one barely gets a thin line, and occasionally a whole area is skipped.',
    expectLowConfidence: true,
    note: 'Contradictory volume signals (over, under, missing). A human cannot name one defect; the engine currently still picks a confident top defect.',
  },
];
