/**
 * PasteTrace eval harness - rule engine + free-text symptom parsing.
 *
 * Runs the exact same code path as the live app, with no browser, no DOM and
 * no network:
 *   HeuristicNlu.parse()  -> symptom ids        (src/nlu/llmRouter.ts)
 *   runDiagnosis()        -> defect + causes    (src/engine/scorer.ts)
 *   isLowConfidence()     -> badge condition    (src/ui/confidence.ts)
 *
 * Usage: npm run eval
 * Output: eval/results/<timestamp>.json plus a console summary.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runDiagnosis } from '../src/engine/scorer';
import type { CauseId, DefectId, SymptomId } from '../src/engine/types';
import { HeuristicNlu } from '../src/nlu/llmRouter';
import { isLowConfidence, LOW_DEFECT_CONFIDENCE, LOW_TOP_CAUSE_SCORE } from '../src/ui/confidence';
import { TEST_CASES, type EvalCase } from './testCases';

interface CaseResult {
  id: string;
  kind: 'known' | 'low-confidence';
  description: string;
  note?: string;
  parsed: {
    engine: string;
    symptoms: SymptomId[];
    material?: string;
    emphasis?: SymptomId[];
  };
  expected: {
    defect?: DefectId;
    topCause?: CauseId;
    lowConfidence?: boolean;
  };
  actual: {
    defectId: DefectId;
    defectName: string;
    topCauseId: CauseId;
    topCauseName: string;
    topCauseScore: number;
    confidence: number;
    activeSymptomCount: number;
    flaggedLowConfidence: boolean;
    topCauses: { causeId: CauseId; score: number }[];
  };
  defectOk: boolean | null;
  causeOk: boolean | null;
  pass: boolean;
}

function isKnownCase(tc: EvalCase): boolean {
  return Boolean(tc.expectedDefect || tc.expectedTopCause);
}

function formatPct(part: number, total: number): string {
  if (total === 0) return 'n/a';
  return `${((part / total) * 100).toFixed(1)}%`;
}

function describeExpected(tc: EvalCase): string {
  const defect = tc.expectedDefect ?? 'any';
  const cause = tc.expectedTopCause ?? 'any';
  return `${defect} / ${cause}`;
}

function describeActual(r: CaseResult): string {
  return `${r.actual.defectId} / ${r.actual.topCauseId}`;
}

function truncate(text: string, max = 92): string {
  return text.length <= max ? text : `${text.slice(0, max - 3)}...`;
}

async function main(): Promise<void> {
  const startedAt = new Date();
  const parser = new HeuristicNlu();
  const results: CaseResult[] = [];

  for (const tc of TEST_CASES) {
    const parsed = await parser.parse(tc.description);
    const report = runDiagnosis(parsed.symptoms, parsed.material ?? 'solder-paste', undefined, parsed.emphasis);
    const defect = report.defect;
    const topCause = defect.causes[0];
    const activeSymptomCount = report.activeSymptoms.length;
    const flagged = isLowConfidence(defect.defectConfidence, activeSymptomCount);

    const known = isKnownCase(tc);
    const defectOk = tc.expectedDefect ? defect.defectId === tc.expectedDefect : null;
    const causeOk = tc.expectedTopCause ? topCause.causeId === tc.expectedTopCause : null;
    const pass = known
      ? defectOk !== false && causeOk !== false
      : flagged === Boolean(tc.expectLowConfidence);

    results.push({
      id: tc.id,
      kind: known ? 'known' : 'low-confidence',
      description: tc.description,
      note: tc.note,
      parsed: {
        engine: parsed.engine,
        symptoms: parsed.symptoms,
        material: parsed.material,
        emphasis: parsed.emphasis,
      },
      expected: {
        defect: tc.expectedDefect,
        topCause: tc.expectedTopCause,
        lowConfidence: tc.expectLowConfidence,
      },
      actual: {
        defectId: defect.defectId,
        defectName: defect.defectName,
        topCauseId: topCause.causeId,
        topCauseName: topCause.name,
        topCauseScore: topCause.score,
        confidence: defect.defectConfidence,
        activeSymptomCount,
        flaggedLowConfidence: flagged,
        topCauses: defect.causes.slice(0, 3).map((c) => ({ causeId: c.causeId, score: c.score })),
      },
      defectOk,
      causeOk,
      pass,
    });
  }

  const known = results.filter((r) => r.kind === 'known');
  const low = results.filter((r) => r.kind === 'low-confidence');
  const knownPassed = known.filter((r) => r.pass).length;
  const lowPassed = low.filter((r) => r.pass).length;
  const defectPassed = known.filter((r) => r.defectOk === true).length;
  const defectScored = known.filter((r) => r.defectOk !== null).length;
  const causePassed = known.filter((r) => r.causeOk === true).length;
  const causeScored = known.filter((r) => r.causeOk !== null).length;
  const failures = results.filter((r) => !r.pass);

  const stamp = startedAt.toISOString().replace(/[:.]/g, '-');
  const resultFile = join(process.cwd(), 'eval', 'results', `${stamp}.json`);
  mkdirSync(join(process.cwd(), 'eval', 'results'), { recursive: true });
  writeFileSync(
    resultFile,
    `${JSON.stringify(
      {
        run: {
          startedAt: startedAt.toISOString(),
          parser: 'HeuristicNlu (on-device NLU floor, no network/browser)',
          scorer: 'runDiagnosis (identifyDefect + scoreCauses), baseline priors',
          materialDefault: 'solder-paste',
          thresholds: { LOW_DEFECT_CONFIDENCE, LOW_TOP_CAUSE_SCORE },
        },
        summary: {
          totalCases: results.length,
          known: {
            total: known.length,
            passed: knownPassed,
            matchRate: known.length ? knownPassed / known.length : null,
            defectMatch: { passed: defectPassed, scored: defectScored },
            topCauseMatch: { passed: causePassed, scored: causeScored },
          },
          lowConfidence: {
            total: low.length,
            correctlyFlagged: lowPassed,
            flagRate: low.length ? lowPassed / low.length : null,
          },
          failedCaseIds: failures.map((r) => r.id),
        },
        cases: results,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  console.log(`Eval run: ${startedAt.toISOString().slice(0, 16).replace('T', ' ')}`);
  console.log(`Parser: ${results[0]?.parsed.engine ?? 'heuristic'} | scorer: runDiagnosis, baseline priors`);
  console.log(
    `Known-defect cases: ${knownPassed}/${known.length} correct (${formatPct(knownPassed, known.length)} top-1 match)`,
  );
  console.log(
    `  defect identified: ${defectPassed}/${defectScored} (${formatPct(defectPassed, defectScored)}) | top cause: ${causePassed}/${causeScored} (${formatPct(causePassed, causeScored)})`,
  );
  console.log(
    `Low-confidence cases: ${lowPassed}/${low.length} correctly flagged (${formatPct(lowPassed, low.length)}; caveat fires below ${(LOW_DEFECT_CONFIDENCE * 100).toFixed(0)}% defect confidence or 0 parsed symptoms)`,
  );
  if (failures.length === 0) {
    console.log('Failed cases: none');
  } else {
    console.log(`Failed cases (${failures.length}):`);
    for (const r of failures) {
      if (r.kind === 'known') {
        const tc = TEST_CASES.find((c) => c.id === r.id);
        console.log(`  - ${r.id} [known] "${truncate(r.description)}"`);
        console.log(
          `      expected ${tc ? describeExpected(tc) : '?'} | got ${describeActual(r)} | confidence ${(r.actual.confidence * 100).toFixed(0)}%`,
        );
      } else {
        console.log(`  - ${r.id} [low-confidence] "${truncate(r.description)}"`);
        console.log(
          `      expected flag | got confidence ${(r.actual.confidence * 100).toFixed(0)}% from ${r.actual.activeSymptomCount} parsed symptom(s) [${r.parsed.symptoms.join(', ') || 'none'}]`,
        );
      }
      if (r.note) console.log(`      note: ${r.note}`);
    }
  }
  console.log(`Results: ${resultFile}`);
}

main().catch((err) => {
  console.error('Eval failed to run:', err);
  process.exitCode = 1;
});
