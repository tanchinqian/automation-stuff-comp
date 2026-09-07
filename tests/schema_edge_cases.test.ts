import { runDiagnosis, identifyDefect, scoreCauses } from '../src/engine/scorer';
import { buildActionPlan } from '../src/engine/actions';
import { HeuristicNlu } from '../src/nlu/llmRouter';
import { CAUSES, DEFECTS, SYMPTOMS, MATERIALS } from '../src/engine/knowledgeBase';
import type { CauseId, DefectId, SymptomId, MaterialType } from '../src/engine/types';
import type { ReportData } from '../src/report/pdfReport';

export interface TestResult {
  suite: string;
  name: string;
  passed: boolean;
  message?: string;
}

export async function runSchemaAndEdgeCaseTests(): Promise<TestResult[]> {
  const results: TestResult[] = [];

  const record = (suite: string, name: string, fn: () => void | Promise<void>) => {
    try {
      fn();
      results.push({ suite, name, passed: true });
    } catch (e: any) {
      results.push({ suite, name, passed: false, message: e.message || String(e) });
    }
  };

  const asyncRecord = async (suite: string, name: string, fn: () => Promise<void>) => {
    try {
      await fn();
      results.push({ suite, name, passed: true });
    } catch (e: any) {
      results.push({ suite, name, passed: false, message: e.message || String(e) });
    }
  };

  // ── 1. Schema & Range Invariants ──────────────────────────────────────────
  record('Schema & Range Invariants', 'Likelihood and confidence scores are bounded strictly [0, 1]', () => {
    const report = runDiagnosis(['inconsistent-size', 'material-voids'], 'adhesive');
    if (report.defect.defectConfidence < 0 || report.defect.defectConfidence > 1) {
      throw new Error(`Defect confidence out of bounds: ${report.defect.defectConfidence}`);
    }
    if (Number.isNaN(report.defect.defectConfidence)) {
      throw new Error('Defect confidence is NaN');
    }
    for (const c of report.defect.causes) {
      if (c.score < 0 || c.score > 1 || Number.isNaN(c.score)) {
        throw new Error(`Cause ${c.causeId} score out of bounds [0, 1]: ${c.score}`);
      }
    }
  });

  record('Schema & Range Invariants', 'All known causes are ranked with required schema properties', () => {
    const report = runDiagnosis(['amount-too-small'], 'adhesive');
    const allCauseIds = Object.keys(CAUSES);
    if (report.defect.causes.length !== allCauseIds.length) {
      throw new Error(`Expected ${allCauseIds.length} ranked causes, got ${report.defect.causes.length}`);
    }
    for (const c of report.defect.causes) {
      if (!c.causeId || !c.name || !c.category || typeof c.score !== 'number' || !Array.isArray(c.reasons)) {
        throw new Error(`Cause ${c.causeId} missing required schema fields`);
      }
    }
  });

  record('Schema & Range Invariants', 'PDF ReportData contract validation', () => {
    const report = runDiagnosis(['amount-too-small'], 'adhesive');
    const actions = buildActionPlan(report.defect.causes.map((c) => c.causeId));
    const reportData: ReportData = {
      diagnosis: report,
      actions,
      engineLabel: 'Embedded rules engine',
      imageLabel: 'Good Board (100% Quality)',
      engineerNotes: 'Shift handoff verification passed.',
    };
    if (!reportData.diagnosis?.defect?.defectName) {
      throw new Error('ReportData missing diagnosis defectName');
    }
    if (!Array.isArray(reportData.actions) || reportData.actions.length === 0) {
      throw new Error('ReportData missing valid actions array');
    }
  });

  // ── 2. Adversarial & Edge Case Inputs ─────────────────────────────────────
  record('Adversarial & Edge Cases', 'Empty symptom array returns valid baseline diagnosis without crashing', () => {
    const report = runDiagnosis([], 'adhesive');
    if (!report.defect || !report.defect.defectId || report.defect.causes.length === 0) {
      throw new Error('Empty symptom array did not return a valid fallback diagnosis');
    }
    if (report.defect.reasoning.length === 0) {
      throw new Error('Reasoning string was empty for empty symptoms');
    }
  });

  record('Adversarial & Edge Cases', 'Contradictory symptoms handled gracefully without NaN', () => {
    // Both too small and too large, continuous and once
    const contradictory: SymptomId[] = ['amount-too-small', 'amount-too-large', 'occurrence-continuous', 'occurrence-once'];
    const report = runDiagnosis(contradictory, 'epoxy');
    if (Number.isNaN(report.defect.defectConfidence) || report.defect.causes.some((c) => Number.isNaN(c.score))) {
      throw new Error('Contradictory symptoms produced NaN scores');
    }
    if (report.defect.causes[0].score <= 0) {
      throw new Error('Expected positive top score for contradictory input');
    }
  });

  record('Adversarial & Edge Cases', 'All symptoms active simultaneously (Max saturation test)', () => {
    const allSymptoms = Object.keys(SYMPTOMS) as SymptomId[];
    const report = runDiagnosis(allSymptoms, 'solder-paste');
    for (const c of report.defect.causes) {
      if (c.score < 0 || c.score > 1) {
        throw new Error(`Symptom saturation caused out-of-bounds score: ${c.score}`);
      }
    }
    if (!report.defect.reasoning || report.defect.reasoning.length < 10) {
      throw new Error('Reasoning invalid under max symptom load');
    }
  });

  record('Adversarial & Edge Cases', 'Invalid/unregistered symptom string handled safely', () => {
    const mixed = ['inconsistent-size', 'invalid-nonexistent-symptom' as SymptomId];
    const report = runDiagnosis(mixed, 'sealant');
    if (!report.defect.defectId || report.defect.causes.length === 0) {
      throw new Error('Unknown symptom string caused engine failure');
    }
  });

  record('Adversarial & Edge Cases', 'Emphasized symptoms do not cause out-of-bounds probability score', () => {
    const report = runDiagnosis(['material-voids', 'inconsistent-size'], 'adhesive', undefined, ['material-voids']);
    const top = report.defect.causes[0];
    if (top.score < 0 || top.score > 1) {
      throw new Error(`Emphasized symptom pushed score out of [0, 1]: ${top.score}`);
    }
  });

  // ── 3. NLU Free-Text Parser Edge Cases ────────────────────────────────────
  await asyncRecord('NLU Parser Robustness', 'Empty / whitespace / punctuation free-text input does not throw', async () => {
    const nlu = new HeuristicNlu();
    const emptyRes = await nlu.parse('');
    const spaceRes = await nlu.parse('    \n\t   ');
    const punctRes = await nlu.parse('??!!....,,,---');
    if (!Array.isArray(emptyRes.symptoms) || !Array.isArray(spaceRes.symptoms) || !Array.isArray(punctRes.symptoms)) {
      throw new Error('NLU failed to return array of symptoms on blank input');
    }
  });

  await asyncRecord('NLU Parser Robustness', 'Adversarial gibberish does not crash NLU', async () => {
    const nlu = new HeuristicNlu();
    const res = await nlu.parse('x9871239841723 @#$%^&*()_+ zzzzz 123456');
    if (!res.summary || res.symptoms.length !== 0) {
      // should return empty symptoms and summary gracefully
      if (!res.summary.includes('No specific symptoms detected')) {
        throw new Error(`Unexpected summary for gibberish input: ${res.summary}`);
      }
    }
  });

  await asyncRecord('NLU Parser Robustness', 'Sentiment and emphasis extraction on high-emotion prompt', async () => {
    const nlu = new HeuristicNlu();
    const res = await nlu.parse('The dots are completely missing and it is driving me crazy! Urgent fix needed now!');
    if (!res.symptoms.includes('missing-occasionally')) {
      throw new Error('NLU missed missing-occasionally symptom in frustrated prompt');
    }
    if (res.sentiment !== 'frustrated' && res.sentiment !== 'urgent') {
      throw new Error(`Expected frustrated or urgent sentiment, got: ${res.sentiment}`);
    }
  });

  return results;
}

export function printSchemaTestReport(results: TestResult[]): void {
  console.log('========================================================================================================');
  console.log('                          SCHEMA INTEGRITY & ADVERSARIAL EDGE-CASE TEST REPORT                          ');
  console.log('========================================================================================================');

  let passedCount = 0;
  for (const r of results) {
    const status = r.passed ? 'PASS' : 'FAIL';
    if (r.passed) passedCount++;
    const suiteName = r.suite.padEnd(28);
    const testName = r.name.padEnd(65);
    console.log(`[${status}] ${suiteName} | ${testName} ${r.message ? `\n       Error: ${r.message}` : ''}`);
  }

  console.log('--------------------------------------------------------------------------------------------------------');
  console.log(`Total Unit Tests: ${results.length} | Passed: ${passedCount} | Failed: ${results.length - passedCount}`);
  console.log(`Schema & Edge-Case Pass Rate: ${((passedCount / results.length) * 100).toFixed(1)}%`);
  console.log('========================================================================================================\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runSchemaAndEdgeCaseTests().then((results) => {
    printSchemaTestReport(results);
  });
}
