import { runDiagnosis, identifyDefect } from './src/engine/scorer.ts';
import { buildActionPlan } from './src/engine/actions.ts';
import { seedCases, priorOverrides } from './src/db/caseDB.ts';
import { HeuristicNlu } from './src/nlu/llmRouter.ts';
import { qualityScore, boardQualityScore, boardClassToSymptoms } from './src/vision/qualityScore.ts';
import { analyzeBoard, boardClassFromName, type BoardAnalysis } from './src/vision/analyzeImage.ts';
import type { ImageAnalysis } from './src/vision/analyzeImage.ts';

/** Build a minimal ImageData-like object for the classical board CV in Node. */
function makeImage(w: number, h: number, draw: (x: number, y: number) => number): { width: number; height: number; data: Uint8ClampedArray } {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const g = draw(x, y);
      const o = (y * w + x) * 4;
      data[o] = g;
      data[o + 1] = g;
      data[o + 2] = g;
      data[o + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

/** Build a synthetic board: WxH px, with `cols`x`rows` pads of padW x padH at a gap. */
function buildBoard(opts: {
  cols: number;
  rows: number;
  padW: number;
  padH: number;
  gapX: number;
  gapY: number;
  margin: number;
  paste: (r: number, c: number) => number; // fill ratio 0..1 of paste on this pad
  bridgeCol?: number; // pad column that bridges to its right neighbour
}): { img: { width: number; height: number; data: Uint8ClampedArray }; padRois: { x: number; y: number; w: number; h: number }[] } {
  const { cols, rows, padW, padH, gapX, gapY, margin, paste, bridgeCol } = opts;
  const W = margin * 2 + cols * padW + (cols - 1) * gapX;
  const H = margin * 2 + rows * padH + (rows - 1) * gapY;
  const img = makeImage(W, H, (x, y) => 200); // light board
  const padRois = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = margin + c * (padW + gapX);
      const y = margin + r * (padH + gapY);
      const fill = paste(r, c);
      // draw paste as grey (value 90) within the pad area scaled by fill
      for (let py = y; py < y + padH; py++) {
        for (let px = x; px < x + padW; px++) {
          if (bridgeCol !== undefined && c === bridgeCol && px > x + padW * 0.6) {
            // extend paste beyond pad toward neighbour
            img.data[(py * W + (px + gapX + 4)) * 4] = 90;
            img.data[(py * W + (px + gapX + 4)) * 4 + 1] = 90;
            img.data[(py * W + (px + gapX + 4)) * 4 + 2] = 90;
          }
          if (px < x + padW * fill) {
            img.data[(py * W + px) * 4] = 90;
            img.data[(py * W + px) * 4 + 1] = 90;
            img.data[(py * W + px) * 4 + 2] = 90;
          }
        }
      }
      padRois.push({ x: x / W, y: y / H, w: padW / W, h: padH / H });
    }
  }
  return { img, padRois };
}

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

  // ---- Board (SPI) classical CV tests ----
  console.log('\n=== SPI BOARD ANALYSIS ===');

  // Good board: full paste on all pads
  const goodBoard = buildBoard({
    cols: 4, rows: 3, padW: 60, padH: 22, gapX: 14, gapY: 14, margin: 12,
    paste: () => 0.9,
  });
  const goodAnalysis = analyzeBoard(goodBoard.img as any, goodBoard.padRois);
  console.log(`Good board: pads=${goodAnalysis.pads.length}, good=${goodAnalysis.defectCounts.good}, quality=${goodAnalysis.boardQuality}`);
  if (goodAnalysis.boardQuality < 90) throw new Error('Good board should score high');

  // Less-paste board: half the pads at low fill
  const lessBoard = buildBoard({
    cols: 4, rows: 3, padW: 60, padH: 22, gapX: 14, gapY: 14, margin: 12,
    paste: (r, c) => (c === 0 ? 0.2 : 0.9),
  });
  const lessAnalysis = analyzeBoard(lessBoard.img as any, lessBoard.padRois);
  console.log(`Less-paste board: less=${lessAnalysis.defectCounts['less-paste']}, quality=${lessAnalysis.boardQuality}`);
  if (lessAnalysis.defectCounts['less-paste'] === 0) throw new Error('Should detect less-paste pads');

  // Missing board: one pad with no paste
  const missingBoard = buildBoard({
    cols: 4, rows: 3, padW: 60, padH: 22, gapX: 14, gapY: 14, margin: 12,
    paste: (r, c) => (c === 1 ? 0 : 0.9),
  });
  const missingAnalysis = analyzeBoard(missingBoard.img as any, missingBoard.padRois);
  console.log(`Missing board: missing=${missingAnalysis.defectCounts.missing}, quality=${missingAnalysis.boardQuality}`);
  if (missingAnalysis.defectCounts.missing === 0) throw new Error('Should detect missing pads');

  // Bridging board
  const bridgeBoard = buildBoard({
    cols: 4, rows: 3, padW: 60, padH: 22, gapX: 14, gapY: 14, margin: 12,
    paste: () => 0.9,
    bridgeCol: 0,
  });
  const bridgeAnalysis = analyzeBoard(bridgeBoard.img as any, bridgeBoard.padRois);
  console.log(`Bridging board: bridging=${bridgeAnalysis.defectCounts.bridging}, quality=${bridgeAnalysis.boardQuality}`);

  // Board quality score + symptom mapping
  const bq = boardQualityScore(goodAnalysis);
  console.log(`Board quality breakdown: ${bq.overall}/100`);
  const syms = boardClassToSymptoms('less-paste');
  console.log(`boardClassToSymptoms(less-paste) -> ${syms.join(', ')}`);
  console.log(`boardClassFromName('bad_bridge') -> ${boardClassFromName('bad_bridge')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});