import { runDiagnosis, identifyDefect } from './src/engine/scorer.ts';
import { buildActionPlan } from './src/engine/actions.ts';
import { seedCases, priorOverrides } from './src/db/caseDB.ts';
import { HeuristicNlu } from './src/nlu/llmRouter.ts';
import { qualityScore } from './src/vision/qualityScore.ts';
import type { ImageAnalysis } from './src/vision/analyzeImage.ts';

async function main() {
  const seeds = seedCases();
  console.log(`Seeded cases: ${seeds.length}`);
  const priors = priorOverrides(seeds as any);

  const scenario: any = {
    material: 'adhesive',
    symptoms: ['inconsistent-size', 'occurrence-occasional', 'material-voids', 'multi-location'],
  };

  const report = runDiagnosis(scenario.symptoms, scenario.material, priors);
  const d = report.defect;
  console.log('\n=== SCENARIO: inconsistent size, occasional, visible bubbles ===');
  console.log(`Defect: ${d.defectName} (confidence ${(d.defectConfidence * 100).toFixed(0)}%)`);
  console.log('Causes:');
  for (const c of d.causes.slice(0, 5)) {
    console.log(`  ${(c.score * 100).toFixed(0).padStart(3)}%  ${c.name} (${c.category})`);
  }
  console.log(`Reasoning: ${d.reasoning}`);
  console.log('Actions:');
  for (const a of buildActionPlan(d.causes.map((c) => c.causeId))) {
    console.log(`  ${a.order}. ${a.title}`);
  }

  // NLU heuristic test
  const nlu = new HeuristicNlu();
  const parsed = await nlu.parse('the dot is sometimes too small and I see air bubbles');
  console.log('\n=== NLU HEURISTIC ===');
  console.log(`Symptoms: ${parsed.symptoms.join(', ')}`);
  console.log(`Summary: ${parsed.summary}`);

  const parsed2 = await nlu.parse('too much material is spreading everywhere');
  console.log(`\nS2 symptoms: ${parsed2.symptoms.join(', ')}`);

  const id = identifyDefect(['missing-occasionally', 'missing-location', 'occurrence-occasional']);
  console.log(`\nidentifyDefect(missing symptoms) -> ${id.defectId} (${(id.confidence * 100).toFixed(0)}%)`);

  // Quality score from a mock analysis (perfect frame)
  const perfectAnalysis: ImageAnalysis = {
    blobs: [1, 2, 3].map((i) => ({
      cx: i * 50, cy: 50, area: 400, bbox: { x: i * 50 - 10, y: 40, w: 20, h: 20 }, perimeter: 80, circularity: 0.785, eccentricity: 0,
    })),
    dots: [1, 2, 3].map((i) => ({
      class: 'perfect' as const, area: 400, circularity: 0.785, eccentricity: 0, cx: i * 50, cy: 50, expectedArea: 400, deviation: 0,
    })),
    metrics: { count: 3, expectedCount: 3, missingCount: 0, meanArea: 400, areaCv: 0.01, meanCircularity: 0.785, meanEccentricity: 0.02, spreadRatio: 1.0, maxDeviation: 0.02 },
    dominantClass: 'perfect',
    defectDetected: false,
  };
  const q = qualityScore(perfectAnalysis);
  console.log(`\nQuality (perfect frame): ${q.overall}/100 (shape ${q.shape}, size ${q.size}, pos ${q.position}, risk ${q.defectRisk})`);
  if (q.overall < 70) throw new Error('Perfect frame should score high');

  // Defective frame
  const badAnalysis: ImageAnalysis = {
    blobs: [{ cx: 50, cy: 50, area: 900, bbox: { x: 30, y: 40, w: 40, h: 20 }, perimeter: 120, circularity: 0.3, eccentricity: 0.8 }],
    dots: [{ class: 'irregular' as const, area: 900, circularity: 0.3, eccentricity: 0.8, cx: 50, cy: 50, expectedArea: 400, deviation: 1.25 }],
    metrics: { count: 1, expectedCount: 4, missingCount: 3, meanArea: 900, areaCv: 0.0, meanCircularity: 0.3, meanEccentricity: 0.8, spreadRatio: 2.0, maxDeviation: 1.25 },
    dominantClass: 'irregular',
    defectDetected: true,
  };
  const qb = qualityScore(badAnalysis);
  console.log(`Quality (bad frame): ${qb.overall}/100`);
  if (qb.overall > 55) throw new Error('Bad frame should score low');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});