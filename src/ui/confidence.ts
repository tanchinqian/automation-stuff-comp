/**
 * Presentation-only thresholds for the low-confidence caveat.
 *
 * These do NOT feed scoring, ranking, or any engine math - they only decide
 * when to show an additional "limited evidence" indicator next to a result
 * that already exists.
 */
export const LOW_DEFECT_CONFIDENCE = 0.35;
export const LOW_TOP_CAUSE_SCORE = 0.2;

/** True when a diagnosis should carry a visible "limited evidence" caveat. */
export function isLowConfidence(confidence: number, activeSymptomCount: number): boolean {
  return confidence < LOW_DEFECT_CONFIDENCE || activeSymptomCount === 0;
}
