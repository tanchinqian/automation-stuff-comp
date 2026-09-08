import type { DiagnosticReport } from '../engine/scorer';
import type { ActionStep } from '../engine/actions';
import type { BoardAnalysis } from '../vision/analyzeImage';
import type { QualityBreakdown } from '../vision/qualityScore';
import type { MaterialType, SymptomId } from '../engine/types';

export interface AppState {
  material?: MaterialType;
  symptoms: Set<SymptomId>;
  /** symptoms the operator stressed (carry extra scoring weight) */
  emphasized?: Set<SymptomId>;
  lastDiagnosis?: DiagnosticReport;
  lastActions?: ActionStep[];
  lastImage?: { label: string; board?: BoardAnalysis; quality?: QualityBreakdown; imageUrl: string };
  lastEngineLabel: string;
  /** true once the user chooses to proceed without an inspection image this session */
  imageSkipped: boolean;

  // ── 8D-Lite report fields ─────────────────────────────────────────────────
  /** Auto-generated report ID: "8D-YYYYMMDD-XXXX" */
  reportId: string;
  /** D2: which machine or production line */
  machineId?: string;
  /** D2: affected unit count, free text e.g. "12 of 100 boards" */
  affectedCount?: string;
  /** D3: operator confirmed containment action was taken */
  containmentVerified: boolean;
  /** D4: operator confirmed root cause */
  rootCauseVerified: boolean;
  /** D5/D6: operator confirmed corrective action was applied */
  correctiveActionVerified: boolean;
  /** D1 Individual: employee name */
  employeeName?: string;
  /** D1 Individual: employee ID */
  employeeId?: string;
  /** Sign-off: operator name */
  closedBy?: string;
  /** Sign-off: date string (ISO) set when operator signs off */
  closedDate?: string;
}

function makeReportId(): string {
  const now = new Date();
  const ymd = now.toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.floor(Math.random() * 9000) + 1000;
  return `8D-${ymd}-${rand}`;
}

export const appState: AppState = {
  symptoms: new Set(),
  lastEngineLabel: 'Embedded rules engine',
  imageSkipped: false,
  reportId: makeReportId(),
  containmentVerified: false,
  rootCauseVerified: false,
  correctiveActionVerified: false,
};

export function addSymptoms(syms: SymptomId[]): void {
  for (const s of syms) appState.symptoms.add(s);
}

export function resetState(): void {
  appState.material = undefined;
  appState.symptoms.clear();
  appState.emphasized = undefined;
  appState.lastDiagnosis = undefined;
  appState.lastActions = undefined;
  appState.lastImage = undefined;
  appState.imageSkipped = false;
  // Reset 8D-Lite fields and generate a fresh report ID
  appState.reportId = makeReportId();
  appState.machineId = undefined;
  appState.affectedCount = undefined;
  appState.containmentVerified = false;
  appState.rootCauseVerified = false;
  appState.correctiveActionVerified = false;
  appState.employeeName = undefined;
  appState.employeeId = undefined;
  appState.closedBy = undefined;
  appState.closedDate = undefined;
}