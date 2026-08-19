export type DefectId =
  | 'missing-dot'
  | 'undersized-dot'
  | 'oversized-dot'
  | 'inconsistent-volume'
  | 'excessive-spread'
  | 'irregular-shape';

export type CauseId =
  | 'air-bubble'
  | 'nozzle-blockage'
  | 'material-viscosity'
  | 'pressure-unstable'
  | 'dispense-time'
  | 'needle-height'
  | 'temperature'
  | 'material-contamination'
  | 'syringe-empty'
  | 'valve-wear'
  | 'contamination-particle'
  | 'speed-motion'
  | 'material-cure'
  | 'fluid-separation'
  | 'equipment-inspection';

export type SymptomId =
  | 'amount-too-small'
  | 'amount-too-large'
  | 'inconsistent-size'
  | 'missing-occasionally'
  | 'missing-location'
  | 'spread-beyond'
  | 'shape-irregular'
  | 'occurrence-continuous'
  | 'occurrence-occasional'
  | 'occurrence-once'
  | 'time-based-drift'
  | 'recent-change-material'
  | 'recent-change-nozzle'
  | 'recent-change-parameter'
  | 'single-location'
  | 'multi-location'
  | 'surface-wetting'
  | 'material-voids'
  | 'starts-after-pause'
  | 'dot-elongated'
  | 'volume-decreases-over-time'
  | 'pressure-visible-fluctuation'
  | 'material-changed-batch'
  | 'speed-slow-fast'
  | 'height-distance'
  | 'temperature-varied'
  | 'purge-not-done'
  | 'needle-tip-buildup';

export type MaterialType = 'adhesive' | 'solder-paste' | 'epoxy' | 'sealant' | 'conformal-coating' | 'thermal-paste';

export interface CauseInfo {
  id: CauseId;
  name: string;
  category: 'Material' | 'Air' | 'Dispensing Parameter' | 'Nozzle' | 'Equipment' | 'Process';
  description: string;
  /** Base prior probability (0-1) before any evidence. Updated by learning DB. */
  prior: number;
}

export interface SymptomInfo {
  id: SymptomId;
  question: string;
  /** short label used in report / UI chips */
  label: string;
}

export interface DefectInfo {
  id: DefectId;
  name: string;
  description: string;
  symptoms: SymptomId[];
  /** likelihood of each cause for THIS defect (condition-independent weights) */
  causeWeights: Partial<Record<CauseId, number>>;
}

export interface QuestionOption {
  id: string;
  label: string;
  /** symptoms that become true if this option selected */
  adds: SymptomId[];
  /** key of a follow-up question to ask next (Bonus challenge) */
  followUp?: string;
}

export interface QuestionDef {
  id: string;
  text: string;
  intent: 'text' | 'single';
  options?: QuestionOption[];
}

export interface FollowUpRule {
  /** trigger: this question id plus one of these answer ids */
  questionId: string;
  answerId: string;
  nextQuestionId: string;
}
