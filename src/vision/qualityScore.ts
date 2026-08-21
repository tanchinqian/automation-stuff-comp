import type { BoardAnalysis, DetectedClass, ImageAnalysis } from './analyzeImage';

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
 * Bonus Challenge 2: derive a Dispensing Quality Score from CV metrics.
 * Higher score = better quality.
 */
export function qualityScore(a: ImageAnalysis): QualityBreakdown {
  const { metrics } = a;

  // Shape consistency: perfect circularity = 1
  const shape = Math.max(0, Math.min(1, metrics.meanCircularity));

  // Size consistency: low coefficient of variation = good
  const size = Math.max(0, 1 - metrics.areaCv * 1.6);

  // Position consistency: perfect grid alignment, penalise spread & eccentricity
  const position = Math.max(0, 1 - Math.min(1, metrics.spreadRatio - 1) * 0.8 - metrics.meanEccentricity * 0.3);

  // Defect risk: fraction of good dots
  const total = Math.max(1, metrics.count + metrics.missingCount);
  const goodRatio = a.dots.filter((d) => d.class === 'perfect').length / total;
  const defectRisk = Math.max(0, Math.min(1, goodRatio));

  const weights = { shape: 0.25, size: 0.3, position: 0.2, defectRisk: 0.25 };
  const overall = Math.round(
    (shape * weights.shape + size * weights.size + position * weights.position + defectRisk * weights.defectRisk) * 100,
  );

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