import { CAUSES, DEFECTS, SYMPTOMS, SYMPTOM_CAUSES } from './knowledgeBase';
import type { CauseId, DefectId, SymptomId } from './types';

export interface ScoredCause {
  causeId: CauseId;
  name: string;
  category: string;
  description: string;
  /** evidence-adjusted likelihood 0-1 */
  score: number;
  /** evidence points that contributed */
  reasons: string[];
}

export interface DiagnosisResult {
  defectId: DefectId;
  defectName: string;
  defectDescription: string;
  /** confidence in the defect identification 0-1 */
  defectConfidence: number;
  causes: ScoredCause[];
  /** the "WHY" narrative for the top-ranked cause */
  reasoning: string;
  /** symptom profile used */
  activeSymptoms: SymptomId[];
}

/** Strength multiplier of a symptom as evidence. Higher = sharper discriminator. */
const EVIDENCE_STRENGTH: Partial<Record<SymptomId, number>> = {
  'amount-too-small': 0.7,
  'amount-too-large': 0.7,
  'inconsistent-size': 1.0,
  'missing-occasionally': 1.0,
  'missing-location': 0.6,
  'spread-beyond': 1.0,
  'shape-irregular': 0.9,
  'occurrence-continuous': 0.55,
  'occurrence-occasional': 0.75,
  'occurrence-once': 0.3,
  'time-based-drift': 0.85,
  'volume-decreases-over-time': 0.85,
  'material-voids': 0.9,
  'starts-after-pause': 0.6,
  'dot-elongated': 0.8,
  'pressure-visible-fluctuation': 0.8,
  'material-changed-batch': 0.5,
  'recent-change-material': 0.5,
  'recent-change-nozzle': 0.5,
  'recent-change-parameter': 0.6,
  'single-location': 0.4,
  'multi-location': 0.5,
  'surface-wetting': 0.7,
  'temperature-varied': 0.7,
  'purge-not-done': 0.5,
  'needle-tip-buildup': 0.8,
  'speed-slow-fast': 0.5,
  'height-distance': 0.6,
};

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/**
 * Identify the most likely defect from the active symptom profile.
 * A defect matches well when it "explains" many active symptoms
 * (its listed symptoms overlap the observed symptoms).
 */
export function identifyDefect(active: SymptomId[]): { defectId: DefectId; confidence: number } {
  let best: DefectId = 'inconsistent-volume';
  let bestScore = -1;
  for (const defect of Object.values(DEFECTS)) {
    const overlap = defect.symptoms.filter((s) => active.includes(s)).length;
    const covered = active.filter((s) => defect.symptoms.includes(s)).length;
    const precision = active.length ? covered / active.length : 0;
    const recall = defect.symptoms.length ? overlap / defect.symptoms.length : 0;
    const score = precision * 0.6 + recall * 0.4;
    if (score > bestScore) {
      bestScore = score;
      best = defect.id;
    }
  }
  const confidence = clamp01(bestScore * 0.85 + 0.15);
  return { defectId: best, confidence };
}

/**
 * Score every cause for a defect.
 *
 * Each active symptom contributes evidence to every cause through two routes:
 *   1. the defect's own causeWeights (symptom is characteristic of this defect)
 *   2. the direct symptom->cause knowledge map (SYMPTOM_CAUSES)
 * Evidence is blended with the cause's prior probability. Results are
 * normalised against the strongest cause so scores spread meaningfully
 * (matching the spec's example: 85% / 70% / 65% / 45% / 25%) instead of
 * saturating at 100%.
 */
export function scoreCauses(
  defectId: DefectId,
  active: SymptomId[],
  priors?: Partial<Record<CauseId, number>>,
): ScoredCause[] {
  const defect = DEFECTS[defectId];
  const rows: ScoredCause[] = [];

  const rawEvidence = new Map<CauseId, number>();
  const reasonMap = new Map<CauseId, SymptomId[]>();

  for (const sym of active) {
    const strength = EVIDENCE_STRENGTH[sym] ?? 0.5;
    const direct = SYMPTOM_CAUSES[sym] ?? {};
    const causes = new Set<CauseId>([...Object.keys(direct), ...Object.keys(defect.causeWeights)] as CauseId[]);
    for (const causeId of causes) {
      const viaSymptomMap = direct[causeId] ?? 0;
      const viaDefect = defect.symptoms.includes(sym) ? (defect.causeWeights[causeId] ?? 0.2) : 0;
      const contribution = Math.max(viaSymptomMap, viaDefect) * strength;
      if (contribution > 0) {
        rawEvidence.set(causeId, (rawEvidence.get(causeId) ?? 0) + contribution);
        const list = reasonMap.get(causeId) ?? [];
        if (!list.includes(sym)) list.push(sym);
        reasonMap.set(causeId, list);
      }
    }
  }

  const maxEvidence = Math.max(1, ...rawEvidence.values());
  const PRIOR_BLEND = 0.3;

  for (const [causeId, cause] of Object.entries(CAUSES)) {
    const prior = priors?.[causeId as CauseId] ?? cause.prior;
    const ev = rawEvidence.get(causeId as CauseId) ?? 0;
    const normEv = ev / maxEvidence;
    const score = Math.min(1, Math.max(0, PRIOR_BLEND * prior + (1 - PRIOR_BLEND) * normEv));

    const reasonSyms = reasonMap.get(causeId as CauseId) ?? [];
    const reasons =
      reasonSyms.length > 0
        ? reasonSyms.map((s) => `'${SYMPTOMS[s].label}' points toward this cause (evidence weight ${(EVIDENCE_STRENGTH[s] ?? 0.5).toFixed(2)}).`)
        : ['No direct symptom evidence; scored from baseline prior probability.'];

    rows.push({
      causeId: causeId as CauseId,
      name: cause.name,
      category: cause.category,
      description: cause.description,
      score,
      reasons,
    });
  }

  rows.sort((a, b) => b.score - a.score);
  return rows;
}

/** Build the explainable "WHY" narrative for the top cause. */
export function buildReasoning(result: DiagnosisResult): string {
  const top = result.causes[0];
  const second = result.causes[1];
  const syms = result.activeSymptoms.map((s) => SYMPTOMS[s].label.toLowerCase());

  if (result.activeSymptoms.length === 0) {
    return 'Limited symptom data was provided. This ranking is based on the baseline likelihood of known dispensing failure causes.';
  }

  const parts: string[] = [];
  parts.push(
    `"${top.name}" is ranked first because the reported symptoms (${syms.slice(0, 3).join(', ')}) align with its characteristic failure mode.`,
  );
  if (second) {
    const gap = Math.max(1, Math.round((top.score - second.score) * 100));
    parts.push(`It leads "${second.name}" by ${gap}% likelihood in the evidence-adjusted score.`);
  }
  const specific = top.reasons.filter((r) => r !== 'No direct symptom evidence; scored from baseline prior probability.');
  if (specific.length > 0) {
    parts.push(specific.slice(0, 2).join(' '));
  }
  return parts.join(' ');
}

export interface DiagnosticReport {
  defect: DiagnosisResult;
  material: string;
  timestamp: number;
  activeSymptoms: SymptomId[];
  qualityScore?: number;
}

export function runDiagnosis(
  active: SymptomId[],
  material: string,
  priors?: Partial<Record<CauseId, number>>,
): DiagnosticReport {
  const { defectId, confidence } = identifyDefect(active);
  const defect = DEFECTS[defectId];
  const causes = scoreCauses(defectId, active, priors);
  const diagnosis: DiagnosisResult = {
    defectId,
    defectName: defect.name,
    defectDescription: defect.description,
    defectConfidence: confidence,
    causes,
    activeSymptoms: [...active],
    reasoning: '',
  };
  diagnosis.reasoning = buildReasoning(diagnosis);
  return { defect: diagnosis, material, timestamp: Date.now(), activeSymptoms: [...active] };
}