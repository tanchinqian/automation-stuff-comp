import type { BoardAnalysis, DetectedClass, ImageAnalysis } from './analyzeImage';
export { calculateDeterministicQualityScore, type DispenseQualityInput, type DeterministicQualityResult } from '../engine/qualityScore';

export interface QualityBreakdown {
  shape: number; // 0-5
  size: number; // 0-5
  position: number; // 0-5
  defectRisk: number; // 0-5 (higher is better -> fewer defects)
  overall: number; // 0-100
  stars: { shape: number; size: number; position: number; defectRisk: number };
}

const FIVE = 5;

function star(v: number): number {
  return Math.max(0, Math.min(FIVE, Math.round(v * FIVE * 10) / 10));
}

/**
 * Bonus Challenge 2: derive a Deterministic Dispensing Quality Score from CV metrics.
 * 3-axis industrial breakdown: Size Consistency (35%), Shape Circularity (35%), Position/Standoff (30%).
 */
export function qualityScore(a: ImageAnalysis): QualityBreakdown {
  const { metrics } = a;

  // 1. Shape Circularity (35% weight): 4*pi*area / perimeter^2 (1.0 = perfect circle)
  const shape = Math.max(0, Math.min(1, metrics.meanCircularity));

  // 2. Size / Volume Consistency (35% weight): deviation vs nominal target (<10% nominal, >20% penalized)
  const maxDev = Math.abs(metrics.maxDeviation);
  let size = 1.0;
  if (maxDev <= 0.10) {
    size = 1.0 - (maxDev / 0.10) * 0.10;
  } else if (maxDev <= 0.20) {
    size = 0.90 - ((maxDev - 0.10) / 0.10) * 0.30;
  } else {
    size = Math.max(0, 0.60 - ((maxDev - 0.20) / 0.30) * 0.60);
  }

  // 3. Position / Standoff Offset (30% weight): center offset and spread ratio
  const position = Math.max(0, 1 - Math.min(1, Math.max(0, metrics.spreadRatio - 1.0) * 0.8 + metrics.meanEccentricity * 0.3));

  // Defect risk index (fraction of perfect non-defective deposits)
  const total = Math.max(1, metrics.count + metrics.missingCount);
  const goodRatio = a.dots.filter((d) => d.class === 'perfect').length / total;
  const defectRisk = Math.max(0, Math.min(1, goodRatio));

  const overall = Math.round((size * 0.35 + shape * 0.35 + position * 0.30) * 100);

  return {
    shape: star(shape),
    size: star(size),
    position: star(position),
    defectRisk: star(defectRisk),
    overall,
    stars: {
      shape: star(shape),
      size: star(size),
      position: star(position),
      defectRisk: star(defectRisk),
    },
  };
}

export function detectDefectClass(a: ImageAnalysis): DetectedClass {
  return a.dominantClass;
}

/** Map a CV-detected class to the diagnosis engine's defect type. */
export function classToSymptoms(cls: DetectedClass): string[] {
  switch (cls) {
    case 'missing':
      return ['missing-occasionally', 'missing-location'];
    case 'undersized':
      return ['amount-too-small'];
    case 'oversized':
      return ['amount-too-large'];
    case 'irregular':
      return ['shape-irregular', 'dot-elongated'];
    case 'spread':
      return ['spread-beyond', 'surface-wetting'];
    default:
      return [];
  }
}

/** Map an SPI board defect class to the diagnosis engine's symptom IDs. */
export function boardClassToSymptoms(cls: BoardAnalysis['dominantDefect']): string[] {
  switch (cls) {
    case 'less-paste':
      return ['amount-too-small', 'inconsistent-size'];
    case 'missing':
      return ['missing-occasionally', 'missing-location'];
    case 'bridging':
      return ['spread-beyond', 'shape-irregular'];
    case 'misalignment':
      return ['height-distance', 'inconsistent-size'];
    default:
      return [];
  }
}

/**
 * Board quality score (Bonus Challenge 2, board variant). Derives the same
 * /100 + star model from per-pad metrics instead of dot metrics.
 */
export function boardQualityScore(b: BoardAnalysis): QualityBreakdown {
  const total = Math.max(1, b.pads.length);
  const goodRatio = b.defectCounts.good / total;

  // Shape: average fill ratio tells paste coverage health.
  const meanFill = b.pads.length ? b.pads.reduce((a, p) => a + p.fillRatio, 0) / b.pads.length : 0;
  const shape = Math.max(0, Math.min(1, meanFill * 1.4));

  // Size/volume consistency: penalise missing + less-paste pads.
  const volumeDefects = (b.defectCounts.missing + b.defectCounts['less-paste']) / total;
  const size = Math.max(0, 1 - volumeDefects * 1.5);

  // Position: penalise misalignment.
  const alignDefects = b.defectCounts.misalignment / total;
  const position = Math.max(0, 1 - alignDefects * 1.6);

  // Defect risk: good pads ratio.
  const defectRisk = goodRatio;

  const weights = { shape: 0.2, size: 0.3, position: 0.2, defectRisk: 0.3 };
  const overall = Math.round(
    (shape * weights.shape + size * weights.size + position * weights.position + defectRisk * weights.defectRisk) * 100,
  );

  return {
    shape: star(shape),
    size: star(size),
    position: star(position),
    defectRisk: star(defectRisk),
    overall,
    stars: { shape: star(shape), size: star(size), position: star(position), defectRisk: star(defectRisk) },
  };
}