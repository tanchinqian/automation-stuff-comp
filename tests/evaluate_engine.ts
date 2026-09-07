import { runDiagnosis } from '../src/engine/scorer';
import { buildActionPlan, type ActionStep } from '../src/engine/actions';
import { CAUSES, DEFECTS, SYMPTOMS } from '../src/engine/knowledgeBase';
import type { CauseId, DefectId, SymptomId, MaterialType } from '../engine/types';
import benchmarkCases from './data/benchmark_cases.json';

export interface BenchmarkCase {
  id: string;
  name: string;
  material: string;
  mockUserInput: string;
  symptoms: string[];
  emphasized?: string[];
  groundTruthDefect: string;
  expectedTopCause: string;
  expectedTop3Causes: string[];
  expectedActionPlanSequence: string[];
}

export interface CaseEvaluationResult {
  id: string;
  name: string;
  predictedDefect: DefectId;
  defectMatch: boolean;
  defectConfidence: number;
  topCause: CauseId;
  topCauseScore: number;
  top1Match: boolean;
  top3Causes: CauseId[];
  top3Match: boolean;
  reasoningPassed: boolean;
  reasoningLength: number;
  actionPlanPassed: boolean;
  actionStepCount: number;
  latencyMs: number;
}

export interface BenchmarkSummary {
  totalCases: number;
  defectAccuracy: number;
  top1Accuracy: number;
  top3Accuracy: number;
  explainabilityPassRate: number;
  actionPlanPassRate: number;
  avgLatencyMs: number;
  totalTimeMs: number;
  results: CaseEvaluationResult[];
}

export function evaluateBenchmarkCases(): BenchmarkSummary {
  const cases = benchmarkCases as BenchmarkCase[];
  const results: CaseEvaluationResult[] = [];
  const startTotal = performance.now();

  for (const tc of cases) {
    const startCase = performance.now();
    const symptoms = tc.symptoms as SymptomId[];
    const emphasized = (tc.emphasized ?? []) as SymptomId[];
    const report = runDiagnosis(symptoms, tc.material as MaterialType, undefined, emphasized);
    const actions = buildActionPlan(report.defect.causes.map((c) => c.causeId));
    const latencyMs = Number((performance.now() - startCase).toFixed(2));

    const diag = report.defect;
    const topCause = diag.causes[0]?.causeId;
    const topCauseScore = diag.causes[0]?.score ?? 0;
    const top3Causes = diag.causes.slice(0, 3).map((c) => c.causeId);

    const defectMatch = diag.defectId === tc.groundTruthDefect;
    const top1Match = topCause === tc.expectedTopCause;
    const top3Match = tc.expectedTop3Causes.includes(topCause) || top3Causes.includes(tc.expectedTopCause as CauseId);

    // Explainability check: reasoning must be non-empty, substantive, and cite symptoms
    const reasoningText = diag.reasoning.trim();
    const reasoningPassed =
      reasoningText.length > 25 &&
      (reasoningText.toLowerCase().includes('ranked first') || reasoningText.toLowerCase().includes('align with')) &&
      symptoms.some((s) => reasoningText.toLowerCase().includes(SYMPTOMS[s]?.label.toLowerCase().slice(0, 5) ?? ''));

    // Action plan validation: check order sequence, non-empty content, and test shot ending
    let actionPlanPassed = actions.length >= 2;
    for (let i = 0; i < actions.length; i++) {
      if (actions[i].order !== i + 1 || !actions[i].title || !actions[i].detail) {
        actionPlanPassed = false;
      }
    }
    const lastAction = actions[actions.length - 1];
    if (!lastAction || !lastAction.title.includes('test dispensing shots')) {
      actionPlanPassed = false;
    }

    results.push({
      id: tc.id,
      name: tc.name,
      predictedDefect: diag.defectId,
      defectMatch,
      defectConfidence: diag.defectConfidence,
      topCause,
      topCauseScore,
      top1Match,
      top3Causes,
      top3Match,
      reasoningPassed,
      reasoningLength: reasoningText.length,
      actionPlanPassed,
      actionStepCount: actions.length,
      latencyMs,
    });
  }

  const totalTimeMs = Number((performance.now() - startTotal).toFixed(2));
  const total = results.length;
  const defectCorrect = results.filter((r) => r.defectMatch).length;
  const top1Correct = results.filter((r) => r.top1Match).length;
  const top3Correct = results.filter((r) => r.top3Match).length;
  const explainableCorrect = results.filter((r) => r.reasoningPassed).length;
  const actionPlanCorrect = results.filter((r) => r.actionPlanPassed).length;
  const avgLatency = Number((results.reduce((acc, r) => acc + r.latencyMs, 0) / total).toFixed(3));

  return {
    totalCases: total,
    defectAccuracy: Number(((defectCorrect / total) * 100).toFixed(1)),
    top1Accuracy: Number(((top1Correct / total) * 100).toFixed(1)),
    top3Accuracy: Number(((top3Correct / total) * 100).toFixed(1)),
    explainabilityPassRate: Number(((explainableCorrect / total) * 100).toFixed(1)),
    actionPlanPassRate: Number(((actionPlanCorrect / total) * 100).toFixed(1)),
    avgLatencyMs: avgLatency,
    totalTimeMs,
    results,
  };
}

export function printBenchmarkReport(summary: BenchmarkSummary): void {
  console.log('========================================================================================================');
  console.log('                            DISPENSE.AI - DIAGNOSTIC ENGINE BENCHMARK REPORT                            ');
  console.log('========================================================================================================');
  console.log(`Evaluated: ${summary.totalCases} Industrial Failure Vectors | Total Runtime: ${summary.totalTimeMs} ms | Avg Latency: ${summary.avgLatencyMs} ms/case\n`);

  console.log('CASE ID       | CASE NAME                           | DEFECT (CONF)   | TOP CAUSE (SCORE) | T1  | T3  | EXP | ACT | LATENCY');
  console.log('--------------+-------------------------------------+-----------------+-------------------+-----+-----+-----+-----+--------');

  for (const r of summary.results) {
    const id = r.id.padEnd(13);
    const name = (r.name.length > 35 ? r.name.slice(0, 32) + '...' : r.name).padEnd(35);
    const def = `${r.predictedDefect} (${Math.round(r.defectConfidence * 100)}%)`.padEnd(17);
    const cause = `${r.topCause} (${Math.round(r.topCauseScore * 100)}%)`.padEnd(19);
    const t1 = r.top1Match ? 'PASS' : 'FAIL';
    const t3 = r.top3Match ? 'PASS' : 'FAIL';
    const exp = r.reasoningPassed ? 'PASS' : 'FAIL';
    const act = r.actionPlanPassed ? 'PASS' : 'FAIL';
    const lat = `${r.latencyMs}ms`.padStart(7);

    console.log(`${id} | ${name} | ${def} | ${cause} | ${t1} | ${t3} | ${exp} | ${act} | ${lat}`);
  }

  console.log('--------------+-------------------------------------+-----------------+-------------------+-----+-----+-----+-----+--------');
  console.log('\n--- BENCHMARK PERFORMANCE METRICS ---');
  console.log(`Defect Classification Accuracy: ${summary.defectAccuracy}%`);
  console.log(`Top-1 Root Cause Accuracy:       ${summary.top1Accuracy}%`);
  console.log(`Top-3 Root Cause Accuracy:       ${summary.top3Accuracy}%`);
  console.log(`Explainability Check Pass Rate:  ${summary.explainabilityPassRate}%`);
  console.log(`Action Plan Validation Rate:     ${summary.actionPlanPassRate}%`);
  console.log('========================================================================================================\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const summary = evaluateBenchmarkCases();
  printBenchmarkReport(summary);
}
