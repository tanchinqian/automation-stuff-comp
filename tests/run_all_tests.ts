import { evaluateBenchmarkCases, printBenchmarkReport } from './evaluate_engine';
import { runSchemaAndEdgeCaseTests, printSchemaTestReport } from './schema_edge_cases.test';

async function main() {
  console.log('\n');
  console.log('########################################################################################################');
  console.log('                     DISPENSE.AI AUTOMATED TEST SUITE & VALIDATION HARNESS                             ');
  console.log('                      AI Horizon Solution Challenge 2026 - QA & Validation                             ');
  console.log('########################################################################################################\n');

  // 1. Benchmark cases evaluation
  const benchmarkSummary = evaluateBenchmarkCases();
  printBenchmarkReport(benchmarkSummary);

  // 2. Schema integrity & edge-case unit testing
  const schemaResults = await runSchemaAndEdgeCaseTests();
  printSchemaTestReport(schemaResults);

  // 3. Consolidated Executive Summary
  const schemaPassed = schemaResults.filter((r) => r.passed).length;
  const allSchemaPassed = schemaPassed === schemaResults.length;
  const benchmarkPassed = benchmarkSummary.top1Accuracy >= 90.0 && benchmarkSummary.explainabilityPassRate === 100.0;
  const allPassed = allSchemaPassed && benchmarkPassed;

  console.log('========================================================================================================');
  console.log('                                  FINAL QA & VALIDATION SUMMARY CARD                                    ');
  console.log('========================================================================================================');
  console.log(`• Total Validation Test Vectors:       ${benchmarkSummary.totalCases} Failure Modes`);
  console.log(`• Defect Classification Accuracy:      ${benchmarkSummary.defectAccuracy}%`);
  console.log(`• Top-1 Root Cause Accuracy:           ${benchmarkSummary.top1Accuracy}%`);
  console.log(`• Top-3 Root Cause Accuracy:           ${benchmarkSummary.top3Accuracy}%`);
  console.log(`• Explainability & Grounding Score:    ${benchmarkSummary.explainabilityPassRate}%`);
  console.log(`• Action Plan Validation Rate:         ${benchmarkSummary.actionPlanPassRate}%`);
  console.log(`• Schema & Edge-Case Pass Rate:        ${((schemaPassed / schemaResults.length) * 100).toFixed(1)}% (${schemaPassed}/${schemaResults.length} tests)`);
  console.log(`• Average Diagnostic Latency:          ${benchmarkSummary.avgLatencyMs} ms`);
  console.log(`• Overall Validation Status:           ${allPassed ? '✅ PASSED (READY FOR JUDGING)' : '❌ FAILED'}`);
  console.log('========================================================================================================\n');

  if (!allPassed) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Test suite encountered an unhandled fatal error:', err);
  process.exit(1);
});
