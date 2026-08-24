import type { ChatContext } from '../nlu/llmRouter';

/**
 * Offline fallback phrasings for chat events. Used when no on-device LLM is
 * available (heuristic mode). Small variety pools rotate deterministically so
 * the chat does not repeat the same sentence every time.
 */

const POOLS: Record<ChatContext['intent'], string[]> = {
  welcome: [
    'Welcome to DISPENSE.AI - the AI Dispensing Defect Detective. I will ask a few smart questions to pinpoint the problem, and an inspection image on the left sharpens the diagnosis.',
    'Welcome to DISPENSE.AI. Describe the dispensing problem and I will guide the troubleshooting. An image from the left panel adds strong evidence.',
  ],
  acknowledge: [
    'Got it - noted.',
    'Understood - I have recorded that.',
    'Noted - adding that to the evidence profile.',
  ],
  'image-cross-ref': [
    'Image findings accepted and matched against what you described.',
    'Image evidence accepted and folded into the symptom profile.',
  ],
  'diagnosis-announce': [
    'Diagnosis complete. Review the ranked causes and the recommended sequence on the right.',
    'Analysis done - the ranked causes and action plan are ready on the right.',
  ],
  'gate-prompt': [
    'An inspection image would sharpen this. Run one on the left, or continue with text only.',
    'No image yet - the diagnosis is stronger with one. Analyze a board on the left, or skip.',
  ],
  'skip-ack': [
    'No problem - running the diagnosis with the text evidence provided.',
    'Understood - proceeding with the text evidence you gave.',
  ],
};

let cursor = 0;

/** Pick the next phrasing for an intent (deterministic rotation). */
export function template(intent: ChatContext['intent']): string {
  const pool = POOLS[intent];
  const pick = pool[cursor % pool.length];
  cursor++;
  return pick;
}

/** Build a richer acknowledge line from the symptom labels when available. */
export function acknowledgeTemplate(ctx: ChatContext): string {
  const base = template('acknowledge');
  if (ctx.symptoms?.length) {
    return `${base} Recognized: ${ctx.symptoms.slice(0, 4).join(', ')}.`;
  }
  if (ctx.emphasized?.length) {
    return `${base} I will weigh ${ctx.emphasized.join(', ')} more heavily.`;
  }
  return base;
}

/** Build an image cross-reference line that links user words to the image. */
export function imageCrossTemplate(ctx: ChatContext): string {
  const base = template('image-cross-ref');
  const img = ctx.image?.className ? ctx.image.className.replace(/-/g, ' ') : null;
  if (img) {
    return `${base} Image shows <b>${img}</b>${ctx.symptoms?.length ? `, which aligns with the described ${ctx.symptoms.slice(0, 2).join(', ')}` : ''}.`;
  }
  return base;
}