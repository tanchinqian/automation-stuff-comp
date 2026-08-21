import type { DiagnosticReport } from '../engine/scorer';
import type { ActionStep } from '../engine/actions';
import type { BoardAnalysis } from '../vision/analyzeImage';
import type { QualityBreakdown } from '../vision/qualityScore';
import type { MaterialType, SymptomId } from '../engine/types';

export interface AppState {
  material?: MaterialType;
  symptoms: Set<SymptomId>;
  lastDiagnosis?: DiagnosticReport;
  lastActions?: ActionStep[];
  lastImage?: { label: string; board?: BoardAnalysis; quality?: QualityBreakdown; imageUrl: string };
  lastEngineLabel: string;
}

export const appState: AppState = {
  symptoms: new Set(),
  lastEngineLabel: 'Embedded rules engine',
};

export function addSymptoms(syms: SymptomId[]): void {
  for (const s of syms) appState.symptoms.add(s);
}

export function resetState(): void {
  appState.material = undefined;
  appState.symptoms.clear();
  appState.lastDiagnosis = undefined;
  appState.lastActions = undefined;
  appState.lastImage = undefined;
}