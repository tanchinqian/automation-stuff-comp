import type { MaterialType, SymptomId } from '../engine/types';

export type NluEngine = 'gemini-nano' | 'transformers' | 'heuristic';

export interface ParsedAnswer {
  engine: NluEngine;
  /** symptom ids this free-text answer adds */
  symptoms: SymptomId[];
  material?: MaterialType;
  /** a short confirmation text the chat can display */
  summary: string;
}

export interface NluProvider {
  readonly id: NluEngine;
  readonly label: string;
  available: () => Promise<boolean>;
  parse: (text: string) => Promise<ParsedAnswer>;
}

/** Normalise free text for keyword matching. */
export function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

const MATERIAL_KEYWORDS: Array<[MaterialType, string[]]> = [
  ['adhesive', ['adhesive', 'glue']],
  ['solder-paste', ['solder', 'soldering', 'paste']],
  ['epoxy', ['epoxy', 'resin']],
  ['sealant', ['sealant', 'seal']],
  ['conformal-coating', ['conformal', 'coating', 'parylene']],
  ['thermal-paste', ['thermal', 'heat sink', 'thermal grease']],
];

const SYMPTOM_KEYWORDS: Array<[SymptomId, string[]]> = [
  ['amount-too-small', ['too small', 'smaller', 'under', 'not enough', 'thin', 'shrink', 'less material', 'tiny']],
  ['amount-too-large', ['too large', 'too big', 'bigger', 'over', 'too much', 'large', 'excess', 'thick', 'blob']],
  ['inconsistent-size', ['inconsistent', 'varies', 'varying', 'not repeatable', 'different sizes', 'uneven']],
  ['missing-occasionally', ['missing', 'absent', 'no dot', 'nothing', 'gap', 'skipped', 'empty spot']],
  ['missing-location', ['at a location', 'specific spot', 'one spot', 'one point', 'same place']],
  ['spread-beyond', ['spread', 'bleed', 'flood', 'spills', 'run', 'smear', 'wets', 'beyond the area', 'leak']],
  ['shape-irregular', ['shape', 'irregular', 'misshapen', 'not round', 'odd shape', 'distorted']],
  ['occurrence-continuous', ['always', 'every time', 'continuously', 'constant', 'all shots', 'consistently']],
  ['occurrence-occasional', ['sometimes', 'occasionally', 'intermittent', 'once in a while', 'random', 'sporadically']],
  ['time-based-drift', ['over time', 'after a while', 'longer it runs', 'running for a while', 'gradually']],
  ['volume-decreases-over-time', ['decreases', 'drops', 'less and less', 'fades', 'reduces']],
  ['material-voids', ['bubble', 'bubbles', 'void', 'voids', 'air in', 'foamy']],
  ['starts-after-pause', ['after pause', 'after stop', 'after restart', 'after downtime', 'after break']],
  ['dot-elongated', ['tail', 'tails', 'elongated', 'streak', 'drawn out', 'stringy', 'thread']],
  ['recent-change-material', ['changed material', 'new material', 'switched material', 'different material']],
  ['recent-change-nozzle', ['changed nozzle', 'new nozzle', 'cleaned nozzle', 'changed needle', 'new needle']],
  ['recent-change-parameter', ['changed settings', 'changed parameter', 'new settings', 'changed pressure', 'changed speed']],
  ['temperature-varied', ['temperature', 'hot', 'cold', 'warmer', 'cooler', 'humidity']],
  ['needle-tip-buildup', ['buildup', 'built up', 'dried', 'caked', 'crust', 'hardened on tip', 'tip']],
  ['pressure-visible-fluctuation', ['pressure fluctuates', 'pressure unstable', 'gauge', 'psi']],
  ['purge-not-done', ['not purged', 'no purge', 'purge']],
  ['surface-wetting', ['wets', 'wet', 'spreads out', 'puddle', 'soaks']],
  ['single-location', ['one location', 'single location', 'only one', 'same spot', 'one place']],
  ['multi-location', ['multiple locations', 'several locations', 'everywhere', 'across']],
  ['speed-slow-fast', ['speed', 'faster', 'slower', 'motion']],
  ['height-distance', ['height', 'gap', 'distance from', 'lower', 'higher', 'clearance']],
];

/** Rule-based free-text parser. This is the reliable floor of the NLU layer. */
export class HeuristicNlu implements NluProvider {
  readonly id = 'heuristic' as const;
  readonly label = 'Embedded rules engine';

  async available() {
    return true;
  }

  async parse(text: string): Promise<ParsedAnswer> {
    const n = normalize(text);
    const symptoms = new Set<SymptomId>();
    let material: MaterialType | undefined;

    for (const [mat, keys] of MATERIAL_KEYWORDS) {
      if (keys.some((k) => n.includes(k))) {
        material = mat;
        break;
      }
    }
    for (const [sym, keys] of SYMPTOM_KEYWORDS) {
      if (keys.some((k) => n.includes(k))) symptoms.add(sym);
    }

    return {
      engine: 'heuristic',
      symptoms: [...symptoms],
      material,
      summary:
        symptoms.size > 0
          ? `Detected: ${[...symptoms].join(', ')}${material ? ` | material: ${material}` : ''}`
          : 'I could not confidently parse that answer - please use the quick-answer buttons, or rephrase.',
    };
  }
}

/**
 * Gemini Nano via Chrome's built-in Prompt API (optional top layer).
 * Falls through if the browser does not expose it.
 */
export class GeminiNanoNlu implements NluProvider {
  readonly id = 'gemini-nano' as const;
  readonly label = 'Chrome built-in Gemini Nano';

  private static async detectAI(): Promise<any> {
    const w = window as any;
    if (w?.ai?.languageModel?.create) return w.ai.languageModel;
    if (w?.model?.create) return w.model;
    return null;
  }

  async available() {
    const ai = await GeminiNanoNlu.detectAI();
    if (!ai) return false;
    try {
      const cap = await ai.capabilities?.();
      return cap?.available === 'readily' || cap?.available === 'after-download';
    } catch {
      return false;
    }
  }

  async parse(text: string): Promise<ParsedAnswer> {
    const ai = await GeminiNanoNlu.detectAI();
    if (!ai) throw new Error('Gemini Nano unavailable');
    const session = await ai.create();
    try {
      const prompt = `You are a fluid-dispensing troubleshooting intake assistant. Parse the operator's statement into structured data.
Return STRICT JSON only, no prose:
{"symptoms":["..."],"material":"...", "summary":"one short sentence"}
Valid symptoms: amount-too-small, amount-too-large, inconsistent-size, missing-occasionally, missing-location, spread-beyond, shape-irregular, occurrence-continuous, occurrence-occasional, time-based-drift, volume-decreases-over-time, material-voids, starts-after-pause, dot-elongated, temperature-varied, surface-wetting, pressure-visible-fluctuation, purge-not-done, needle-tip-buildup, recent-change-material, recent-change-nozzle, recent-change-parameter, single-location, multi-location.
Valid material: adhesive, solder-paste, epoxy, sealant, conformal-coating, thermal-paste. Use "" if not mentioned.
Operator statement: "${text}"`;
      const raw = await session.prompt(prompt);
      const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
      return {
        engine: 'gemini-nano',
        symptoms: Array.isArray(parsed.symptoms) ? parsed.symptoms : [],
        material: parsed.material || undefined,
        summary: parsed.summary || 'Understood.',
      };
    } finally {
      session.destroy?.();
    }
  }
}

/**
 * transformers.js on-device model fallback. Loads a small quantised text
 * generation model once and caches it for the session. If it cannot load
 * (no internet for first download), callers fall back to the heuristic.
 */
export class TransformersNlu implements NluProvider {
  readonly id = 'transformers' as const;
  readonly label = 'On-device model (transformers.js)';
  private pipe: any = null;
  private static readonly MODEL = 'onnx-community/Qwen2.5-0.5B-Instruct-q4f16-ONNX';

  async available() {
    try {
      const mod = await import('@huggingface/transformers');
      const env = mod.env;
      env.allowLocalModels = true;
      env.allowRemoteModels = true;
      return true;
    } catch {
      return false;
    }
  }

  private async getPipe() {
    if (this.pipe) return this.pipe;
    const mod = await import('@huggingface/transformers');
    this.pipe = await mod.pipeline('text-generation', TransformersNlu.MODEL, {
      dtype: 'q4',
      device: 'wasm',
    });
    return this.pipe;
  }

  async parse(text: string): Promise<ParsedAnswer> {
    const pipe = await this.getPipe();
    const prompt = `Parse this operator statement into JSON {"symptoms":[],"material":"","summary":""}.\nStatement: ${text}`;
    const out = await pipe(prompt, { max_new_tokens: 120, do_sample: false });
    const raw = out?.[0]?.generated_text ?? '';
    try {
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      const parsed = JSON.parse(raw.slice(start, end + 1));
      return {
        engine: 'transformers',
        symptoms: Array.isArray(parsed.symptoms) ? parsed.symptoms : [],
        material: parsed.material || undefined,
        summary: parsed.summary || 'Understood.',
      };
    } catch {
      return new HeuristicNlu().parse(text);
    }
  }
}

/** Ordered fallback chain: Gemini Nano -> on-device model -> embedded rules. */
export class LlmRouter {
  private providers: NluProvider[] = [new GeminiNanoNlu(), new TransformersNlu(), new HeuristicNlu()];
  private active: NluProvider = new HeuristicNlu();
  detectionDone = false;
  private transformersTried = false;

  /** Fast boot check: probe Gemini Nano only; never pull heavy model chunks at startup. */
  async detect(): Promise<NluEngine> {
    try {
      if (await this.providers[0].available()) {
        this.active = this.providers[0];
        this.detectionDone = true;
        return this.active.id;
      }
    } catch {
      /* fall through */
    }
    this.active = this.providers[this.providers.length - 1];
    this.detectionDone = true;
    return this.active.id;
  }

  get engineLabel(): string {
    return this.active.label;
  }

  /** Lazy chain: try the on-device model only when the user actually needs free-text parsing and is online for a one-time download. */
  async parse(text: string): Promise<ParsedAnswer> {
    if (!this.detectionDone) await this.detect();
    if (this.active.id === 'heuristic' && !this.transformersTried && navigator.onLine) {
      this.transformersTried = true;
      try {
        if (await this.providers[1].available()) {
          this.active = this.providers[1];
          return await this.active.parse(text);
        }
      } catch {
        /* fall back to heuristic */
      }
      this.active = this.providers[this.providers.length - 1];
    }
    try {
      return await this.active.parse(text);
    } catch {
      return new HeuristicNlu().parse(text);
    }
  }
}