import * as ort from 'onnxruntime-web';

export type YoloClass = 'less-paste' | 'bridging';

export interface YoloDetection {
  class: YoloClass;
  confidence: number;
  /** normalized 0..1 rect */
  rect: { x: number; y: number; w: number; h: number };
}

const MODEL_URL = 'models/solder-defect.onnx';
const INPUT_SIZE = 640;
const CONF_THRESHOLD = 0.25;
const NMS_THRESHOLD = 0.45;

let session: ort.InferenceSession | null = null;
let loadPromise: Promise<boolean> | null = null;
let lastError: string | null = null;

/** Load the ONNX session once (WebGPU first, WASM fallback). */
export async function yoloAvailable(): Promise<boolean> {
  if (session) return true;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      session = await ort.InferenceSession.create(MODEL_URL, {
        executionProviders: ['webgpu', 'wasm'],
      });
      return true;
    } catch (e) {
      lastError = (e as Error).message;
      session = null;
      return false;
    }
  })();
  return loadPromise;
}

export function yoloError(): string | null {
  return lastError;
}

/** Letterbox an ImageData into the model's 640x640 input. */
function letterbox(image: ImageData, size: number): { data: Float32Array; scale: number; padX: number; padY: number } {
  const sw = image.width;
  const sh = image.height;
  const scale = Math.min(size / sw, size / sh);
  const rw = Math.round(sw * scale);
  const rh = Math.round(sh * scale);
  const padX = Math.floor((size - rw) / 2);
  const padY = Math.floor((size - rh) / 2);

  const out = new Float32Array(size * size * 3);
  const src = image.data;
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const sx = Math.floor(x / scale);
      const sy = Math.floor(y / scale);
      const si = (sy * sw + sx) * 4;
      const oi = ((y + padY) * size + (x + padX)) * 3;
      // RGB order (BGR->RGB handled by model training on BGR; we feed RGB here;
      // YOLO exported accepts RGB since ultralytics normalizes channels on export)
      out[oi] = src[si] / 255;
      out[oi + 1] = src[si + 1] / 255;
      out[oi + 2] = src[si + 2] / 255;
    }
  }
  return { data: out, scale, padX, padY };
}

function iou(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

/** Non-max suppression per class. */
function nms(boxes: YoloDetection[]): YoloDetection[] {
  const keep: YoloDetection[] = [];
  const order = boxes
    .map((b, i) => ({ b, i }))
    .sort((p, q) => q.b.confidence - p.b.confidence);
  const active = order.slice();
  while (active.length) {
    const top = active.shift()!;
    keep.push(top.b);
    for (let i = active.length - 1; i >= 0; i--) {
      if (top.b.class === active[i].b.class && iou(top.b.rect, active[i].b.rect) > NMS_THRESHOLD) {
        active.splice(i, 1);
      }
    }
  }
  return keep;
}

/**
 * Run the on-device YOLO detector on an inspection image.
 * Returns normalized detections; empty array if the model is unavailable.
 */
export async function detectBoard(image: ImageData): Promise<YoloDetection[]> {
  if (!(await yoloAvailable()) || !session) return [];

  const { data, scale, padX, padY } = letterbox(image, INPUT_SIZE);
  const input = new ort.Tensor('float32', data, [1, 3, INPUT_SIZE, INPUT_SIZE]);
  const feeds: Record<string, ort.Tensor> = {};
  feeds[session.inputNames[0]] = input;

  const results = await session.run(feeds);
  const output = results[session.outputNames[0]];
  const arr = output.data as Float32Array;
  const nAnchors = arr.length / 6;

  const boxes: YoloDetection[] = [];
  for (let i = 0; i < nAnchors; i++) {
    const cx = arr[i];
    const cy = arr[nAnchors + i];
    const bw = arr[nAnchors * 2 + i];
    const bh = arr[nAnchors * 3 + i];
    const cls0 = arr[nAnchors * 4 + i];
    const cls1 = arr[nAnchors * 5 + i];
    const cls = cls0 > cls1 ? 0 : 1;
    const conf = Math.max(cls0, cls1);
    if (conf < CONF_THRESHOLD) continue;

    // un-letterbox to normalized image coords (0..1)
    const x = (cx - padX) / scale / image.width;
    const y = (cy - padY) / scale / image.height;
    const w = bw / scale / image.width;
    const h = bh / scale / image.height;
    if (w <= 0 || h <= 0 || x < 0 || y < 0 || x + w > 1.05 || y + h > 1.05) continue;

    boxes.push({
      class: (cls === 0 ? 'less-paste' : 'bridging') as YoloClass,
      confidence: conf,
      rect: { x, y, w, h },
    });
  }

  return nms(boxes);
}