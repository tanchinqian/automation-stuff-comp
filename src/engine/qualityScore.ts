/**
 * Deterministic Dispensing Quality Score (Challenge Bonus 2)
 *
 * Implements an auditable, deterministic 0-100 quality scoring algorithm
 * grounded in physical semiconductor packaging tolerances:
 *  1. Size / Volume Consistency (35%): Diameter / volume deviation vs nominal (<=10% nominal, >20% heavily penalized)
 *  2. Shape Circularity / Aspect Ratio (35%): 4*pi*Area/Perimeter^2 and axis ratio (penalizes tailing/ovaling)
 *  3. Position / Standoff Offset (30%): Center-point distance deviation from target pad
 */

export interface DispenseQualityInput {
  /** Deviation percentage of deposit diameter/volume vs nominal target (e.g. 0.05 for +5%, 0.25 for +25%) */
  diameterDeviationPct: number;
  /** Shape circularity 4*pi*area / perimeter^2 (1.0 = perfect circle) */
  circularity: number;
  /** Optional major/minor axis aspect ratio (1.0 = circular, >1.3 = tailing/stretched) */
  aspectRatio?: number;
  /** Center-point offset percentage relative to pad pitch / diameter (0.0 = centered) */
  centerOffsetPct: number;
}

export interface DeterministicQualityResult {
  overall: number; // 0-100
  sizeScore: number; // 0-100
  shapeScore: number; // 0-100
  positionScore: number; // 0-100
  stars: {
    overall: number; // 1-5
    size: number; // 1-5
    shape: number; // 1-5
    position: number; // 1-5
  };
  metrics: {
    sizeConsistency: string;
    shapeCircularity: string;
    positionOffset: string;
  };
  toleranceStatus: 'PASS_GOLDEN' | 'PASS_ACCEPTABLE' | 'WARNING_OUT_OF_SPEC' | 'REJECT_DEFECTIVE';
}

function toStarRating(score: number): number {
  if (score >= 90) return 5;
  if (score >= 75) return 4;
  if (score >= 60) return 3;
  if (score >= 40) return 2;
  return 1;
}

/**
 * Calculates deterministic dispensing quality score based on 3-axis industrial metrics.
 */
export function calculateDeterministicQualityScore(input: DispenseQualityInput): DeterministicQualityResult {
  const absDev = Math.abs(input.diameterDeviationPct);

  // 1. Size / Volume Consistency (35% Weight)
  // <= 10% deviation: nominal (90-100)
  // 10% - 20% deviation: acceptable to marginal (60-90)
  // > 20% deviation: heavily penalized (< 60)
  let sizeScore = 100;
  if (absDev <= 0.10) {
    sizeScore = 100 - (absDev / 0.10) * 10;
  } else if (absDev <= 0.20) {
    sizeScore = 90 - ((absDev - 0.10) / 0.10) * 30;
  } else {
    sizeScore = Math.max(0, 60 - ((absDev - 0.20) / 0.30) * 60);
  }

  // 2. Shape Circularity / Aspect Ratio (35% Weight)
  // Circularity: 4*pi*Area/Perimeter^2 (1.0 = perfect circle)
  // Aspect ratio penalty if elongated
  const baseCircularity = Math.max(0, Math.min(1.0, input.circularity));
  let shapeScore = baseCircularity * 100;
  if (input.aspectRatio && input.aspectRatio > 1.15) {
    const aspectPenalty = Math.min(40, (input.aspectRatio - 1.15) * 60);
    shapeScore = Math.max(0, shapeScore - aspectPenalty);
  }

  // 3. Position / Standoff Offset (30% Weight)
  // <= 5% offset: nominal (95-100)
  // 5% - 15% offset: acceptable (70-95)
  // > 15% offset: out of spec
  const absOffset = Math.abs(input.centerOffsetPct);
  let positionScore = 100;
  if (absOffset <= 0.05) {
    positionScore = 100 - (absOffset / 0.05) * 5;
  } else if (absOffset <= 0.15) {
    positionScore = 95 - ((absOffset - 0.05) / 0.10) * 25;
  } else {
    positionScore = Math.max(0, 70 - ((absOffset - 0.15) / 0.25) * 70);
  }

  // Weighted Composite
  const overall = Math.round(sizeScore * 0.35 + shapeScore * 0.35 + positionScore * 0.30);

  let toleranceStatus: DeterministicQualityResult['toleranceStatus'] = 'PASS_GOLDEN';
  if (overall < 50) {
    toleranceStatus = 'REJECT_DEFECTIVE';
  } else if (overall < 70) {
    toleranceStatus = 'WARNING_OUT_OF_SPEC';
  } else if (overall < 85) {
    toleranceStatus = 'PASS_ACCEPTABLE';
  }

  const sign = input.diameterDeviationPct >= 0 ? '+' : '';
  return {
    overall,
    sizeScore: Math.round(sizeScore),
    shapeScore: Math.round(shapeScore),
    positionScore: Math.round(positionScore),
    stars: {
      overall: toStarRating(overall),
      size: toStarRating(sizeScore),
      shape: toStarRating(shapeScore),
      position: toStarRating(positionScore),
    },
    metrics: {
      sizeConsistency: `${sign}${(input.diameterDeviationPct * 100).toFixed(1)}% vs nominal`,
      shapeCircularity: `${input.circularity.toFixed(2)} circularity`,
      positionOffset: `${(input.centerOffsetPct * 100).toFixed(1)}% standoff offset`,
    },
    toleranceStatus,
  };
}
