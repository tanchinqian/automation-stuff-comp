import type { MaterialType, SymptomId } from '../engine/types';

export type NluEngine = 'gemini-nano' | 'transformers' | 'heuristic';

export type Sentiment = 'neutral' | 'concerned' | 'urgent' | 'frustrated';

export interface ParsedAnswer {
  engine: NluEngine;
  /** symptom ids this free-text answer adds */
  symptoms: SymptomId[];
  material?: MaterialType;
  /** symptoms the operator stressed emphatically (carries extra weight) */
  emphasis?: SymptomId[];
  /** operator sentiment inferred from wording */
  sentiment?: Sentiment;
  /** a short confirmation text the chat can display */
  summary: string;
}

/** The evidence the chat hands the LLM so it writes grounded prose. */
export interface ChatContext {
  intent:
    | 'welcome'
    | 'acknowledge'
    | 'image-cross-ref'
    | 'diagnosis-announce'
    | 'gate-prompt'
    | 'skip-ack';
  userText?: string;
  symptoms?: string[];
  emphasized?: string[];
  image?: { className: string; quality?: number };
  diagnosis?: { defectName: string; confidence: number; topCause: string };
  material?: string;
}

export interface NluProvider {
  readonly id: NluEngine;
  readonly label: string;
  available: () => Promise<boolean>;
  parse: (text: string) => Promise<ParsedAnswer>;
  /** Natural-language chat reply grounded in the provided evidence. Null = caller falls back to a template. */
  respond: (ctx: ChatContext) => Promise<string | null>;
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
  ['missing-occasionally', ['missing', 'absent', 'no dot', 'nothing', 'gap', 'skipped', 'empty spot', 'disappear', 'vanishing', 'gone']],
  ['missing-location', ['at a location', 'specific spot', 'one spot', 'one point', 'same place']],
  ['spread-beyond', ['spread', 'bleed', 'flood', 'spills', 'run', 'smear', 'wets', 'beyond the area', 'leak']],
  ['shape-irregular', ['shape', 'irregular', 'misshapen', 'not round', 'odd shape', 'distorted']],
  ['occurrence-continuous', ['always', 'every time', 'continuously', 'constant', 'all shots', 'consistently']],
  ['occurrence-occasional', ['sometimes', 'occasionally', 'intermittent', 'once in a while', 'random', 'sporadically']],
  ['time-based-drift', ['over time', 'after a while', 'longer it runs', 'running for a while', 'gradually']],
  ['volume-decreases-over-time', ['decreases', 'drops', 'less and less', 'fades', 'reduces']],
  ['material-voids', ['bubble', 'bubbles', 'void', 'voids', 'air in', 'foamy', 'frothy']],
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

const URGENCY_WORDS = ['urgent', 'asap', 'emergency', 'right away', 'immediately', 'now'];
const FRUSTRATION_WORDS = ['driving me', 'so annoying', 'frustrating', 'fed up', 'hate', 'cannot believe', 'ridiculous', 'mad', 'really bad'];
const CONCERN_WORDS = ['worried', 'concerned', 'not sure', 'nervous', 'hoping'];
const EMPHASIS_WORDS = ['really', 'very', 'keep', 'constantly', 'always', 'every single', 'driving me', 'so much', 'extremely', 'totally'];

/** Rule-based free-text parser. This is the reliable floor of the NLU layer. */
export class HeuristicNlu implements NluProvider {
  readonly id = 'heuristic' as const;
  readonly label = 'Embedded rules engine';

  async available() {
    return true;
  }

  async parse(text: string): Promise<ParsedAnswer> {
    const n = normalize(text);
    const raw = text.toLowerCase();
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

    // Sentiment + emphasis from wording.
    let sentiment: Sentiment = 'neutral';
    if (FRUSTRATION_WORDS.some((k) => raw.includes(k))) sentiment = 'frustrated';
    else if (URGENCY_WORDS.some((k) => raw.includes(k)) || /!\s*$/.test(text)) sentiment = 'urgent';
    else if (CONCERN_WORDS.some((k) => raw.includes(k))) sentiment = 'concerned';

    const emphasis = EMPHASIS_WORDS.some((k) => raw.includes(k)) ? [...symptoms] : undefined;

    return {
      engine: 'heuristic',
      symptoms: [...symptoms],
      material,
      emphasis,
      sentiment,
      summary:
        symptoms.size > 0
          ? `Detected: ${[...symptoms].join(', ')}${material ? ` | material: ${material}` : ''}`
          : 'I could not confidently parse that answer - please use the quick-answer buttons, or rephrase.',
    };
  }

  async respond(_ctx: ChatContext): Promise<string | null> {
    return null; // heuristic mode uses template variety
  }
}

/** Shared grounding instruction for LLM chat replies. */
const RESPOND_GUARDRAIL = `You are a concise, calm troubleshooting assistant inside an industrial dispensing console. Tone: precise, professional, with light warmth. Hard rules:
- Use ONLY the facts provided. Never invent numbers, causes, defects, or claims.
- 1-3 short sentences.
- No em-dashes, no markdown headers, no bullet lists. Minimal <b> emphasis allowed.
- Never fabricate a symptom the user or the image did not show.`;

/** Gemini Nano via Chrome's built-in Prompt API (optional top layer). */
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
{"symptoms":["..."],"material":"...","summary":"one short sentence","sentiment":"neutral|concerned|urgent|frustrated","emphasis":["symptom ids the operator stressed"]}
Valid symptoms: amount-too-small, amount-too-large, inconsistent-size, missing-occasionally, missing-location, spread-beyond, shape-irregular, occurrence-continuous, occurrence-occasional, time-based-drift, volume-decreases-over-time, material-voids, starts-after-pause, dot-elongated, temperature-varied, surface-wetting, pressure-visible-fluctuation, purge-not-done, needle-tip-buildup, recent-change-material, recent-change-nozzle, recent-change-parameter, single-location, multi-location.
Valid material: adhesive, solder-paste, epoxy, sealant, conformal-coating, thermal-paste. Use "" if not mentioned.
"emphasis" is a subset of symptoms the operator stressed with words like 'really', 'keep', 'always', 'driving me crazy'. Use [] if none.
"sentiment" reflects the operator's tone in the text.
Operator statement: "${text}"`;
      const raw = await session.prompt(prompt);
      const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
      return {
        engine: 'gemini-nano',
        symptoms: Array.isArray(parsed.symptoms) ? parsed.symptoms : [],
        material: parsed.material || undefined,
        emphasis: Array.isArray(parsed.emphasis) ? parsed.emphasis : undefined,
        sentiment: parsed.sentiment || 'neutral',
        summary: parsed.summary || 'Understood.',
      };
    } finally {
      session.destroy?.();
    }
  }

  async respond(ctx: ChatContext): Promise<string | null> {
    const ai = await GeminiNanoNlu.detectAI();
    if (!ai) return null;
    const session = await ai.create();
    try {
      const prompt = `${RESPOND_GUARDRAIL}
Context for this reply:
- intent: ${ctx.intent}
${ctx.userText ? `- operator said: "${ctx.userText}"` : ''}
${ctx.material ? `- material: ${ctx.material}` : ''}
${ctx.symptoms?.length ? `- known symptoms: ${ctx.symptoms.join(', ')}` : ''}
${ctx.emphasized?.length ? `- operator emphasized: ${ctx.emphasized.join(', ')}` : ''}
${ctx.image ? `- image analysis: ${ctx.image.className}${ctx.image.quality !== undefined ? `, quality ${ctx.image.quality}/100` : ''}` : ''}
${ctx.diagnosis ? `- diagnosis: ${ctx.diagnosis.defectName} (${(ctx.diagnosis.confidence * 100).toFixed(0)}% confidence), top cause ${ctx.diagnosis.topCause}` : ''}

Write the assistant's reply.`;
      return (await session.prompt(prompt)) || null;
    } catch {
      return null;
    } finally {
      session.destroy?.();
    }
  }
}

/** transformers.js on-device model fallback. */
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
    const prompt = `Parse this operator statement into JSON {"symptoms":[],"material":"","summary":"","sentiment":"neutral","emphasis":[]}.\nStatement: ${text}`;
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
        emphasis: Array.isArray(parsed.emphasis) ? parsed.emphasis : undefined,
        sentiment: parsed.sentiment || 'neutral',
        summary: parsed.summary || 'Understood.',
      };
    } catch {
      return new HeuristicNlu().parse(text);
    }
  }

  async respond(ctx: ChatContext): Promise<string | null> {
    try {
      const pipe = await this.getPipe();
      const facts = [
        `intent: ${ctx.intent}`,
        ctx.userText ? `operator said: ${ctx.userText}` : '',
        ctx.material ? `material: ${ctx.material}` : '',
        ctx.symptoms?.length ? `known symptoms: ${ctx.symptoms.join(', ')}` : '',
        ctx.emphasized?.length ? `operator emphasized: ${ctx.emphasized.join(', ')}` : '',
        ctx.image ? `image analysis: ${ctx.image.className}` : '',
        ctx.diagnosis ? `diagnosis: ${ctx.diagnosis.defectName}, top cause ${ctx.diagnosis.topCause}` : '',
      ].filter(Boolean).join(' | ');
      const out = await pipe(
        `${RESPOND_GUARDRAIL}\nFacts: ${facts}\nWrite the assistant's reply.`,
        { max_new_tokens: 60, do_sample: false },
      );
      const raw = out?.[0]?.generated_text ?? '';
      const reply = raw.split('\n').pop()?.trim();
      return reply && reply.length > 3 ? reply : null;
    } catch {
      return null;
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

  get engineId(): NluEngine {
    return this.active.id;
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

  /** Natural chat reply; returns null when no LLM is available. */
  async respond(ctx: ChatContext): Promise<string | null> {
    if (!this.detectionDone) await this.detect();
    try {
      return await this.active.respond(ctx);
    } catch {
      return null;
    }
  }
}