import type { CauseId, DefectId, SymptomId } from './types';
import type { DiagnosisResult, ScoredCause } from './scorer';
import historicalData from '../data/historical_cases.json';

export interface HistoricalIncident {
  caseId: string;
  line: string;
  material: string;
  defectId: DefectId;
  symptoms: SymptomId[];
  resolvedCause: CauseId;
  resolutionCount: number;
  totalMatchingIncidents: number;
  actionTaken: string;
  resolutionSummary: string;
}

export const HISTORICAL_CASES: HistoricalIncident[] = historicalData as HistoricalIncident[];

/**
 * Queries historical incident repository to find cases with matching symptoms and failure mode.
 */
export function findMatchingHistoricalIncidents(
  activeSymptoms: SymptomId[],
  defectId?: DefectId,
  causeId?: CauseId,
): HistoricalIncident[] {
  return HISTORICAL_CASES.filter((item) => {
    if (defectId && item.defectId !== defectId) return false;
    if (causeId && item.resolvedCause !== causeId) return false;

    // Calculate symptom overlap
    const overlap = item.symptoms.filter((s) => activeSymptoms.includes(s)).length;
    return overlap >= 1;
  });
}

/**
 * Returns the best historical grounding note for a given cause under the active symptom profile.
 */
export function getHistoricalGroundingForCause(
  causeId: CauseId,
  activeSymptoms: SymptomId[],
  defectId?: DefectId,
): string | null {
  const matches = findMatchingHistoricalIncidents(activeSymptoms, defectId, causeId);
  if (matches.length === 0) return null;

  // Pick the match with highest symptom overlap
  matches.sort((a, b) => {
    const overlapA = a.symptoms.filter((s) => activeSymptoms.includes(s)).length;
    const overlapB = b.symptoms.filter((s) => activeSymptoms.includes(s)).length;
    return overlapB - overlapA;
  });

  const best = matches[0];
  return best.resolutionSummary;
}

/**
 * Enriches a DiagnosisResult with grounded historical factory incidents.
 */
export function enrichDiagnosisWithHistory(diagnosis: DiagnosisResult): DiagnosisResult {
  const topCause = diagnosis.causes[0];
  if (!topCause) return diagnosis;

  const historyNote = getHistoricalGroundingForCause(topCause.causeId, diagnosis.activeSymptoms, diagnosis.defectId);
  if (historyNote) {
    topCause.reasons.push(`[Historical Grounding] ${historyNote}`);
    // Also append to the main explainable reasoning
    diagnosis.reasoning = `${diagnosis.reasoning} Factory History: ${historyNote}`;
  }

  // Also attach historical notes to any other causes that have verified factory records
  for (let i = 1; i < diagnosis.causes.length; i++) {
    const c = diagnosis.causes[i];
    const matchNote = getHistoricalGroundingForCause(c.causeId, diagnosis.activeSymptoms, diagnosis.defectId);
    if (matchNote) {
      c.reasons.push(`[Historical Grounding] ${matchNote}`);
    }
  }

  return diagnosis;
}
