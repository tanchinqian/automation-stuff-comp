export type DetectedClass = 'perfect' | 'undersized' | 'oversized' | 'missing' | 'irregular' | 'spread';

export interface Blob {
  cx: number;
  cy: number;
  area: number;
  bbox: { x: number; y: number; w: number; h: number };
  perimeter: number;
  circularity: number;
  eccentricity: number;
}

export interface DotResult {
  class: DetectedClass;
  area: number;
  circularity: number;
  eccentricity: number;
  cx: number;
  cy: number;
  expectedArea: number;
  deviation: number; // (area - expectedArea)/expectedArea
}

export interface ImageAnalysis {
  blobs: Blob[];
  dots: DotResult[];
  metrics: {
    count: number;
    expectedCount: number;
    missingCount: number;
    meanArea: number;
    areaCv: number; // coefficient of variation (std/mean)
    meanCircularity: number;
    meanEccentricity: number;
    spreadRatio: number;
    maxDeviation: number;
  };
  dominantClass: DetectedClass;
  defectDetected: boolean;
}

export const CLASS_LABELS: Record<DetectedClass, string> = {
  perfect: 'Good Dot',
  undersized: 'Undersized Dot',
  oversized: 'Oversized Dot',
  missing: 'Missing Dot',
  irregular: 'Irregular Shape',
  spread: 'Excessive Spread',
};

function toGray(img: ImageData): Uint8ClampedArray {
  const { data } = img;
  const g = new Uint8ClampedArray(img.width * img.height);
  for (let i = 0; i < data.length; i += 4) {
    g[i / 4] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return g;
}

/** Connected-component labelling (4-connectivity) on a binary mask. */
function labelComponents(binary: Uint8Array, w: number, h: number): number[] {
  const labels = new Int32Array(binary.length).fill(0);
  const parent: number[] = [0];
  let nextLabel = 1;
  const idx = (x: number, y: number) => y * w + x;

  const find = (a: number): number => {
    let r = a;
    while (parent[r] !== r) r = parent[r];
    while (parent[a] !== a) {
      const n = parent[a];
      parent[a] = r;
      a = n;
    }
    return r;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = idx(x, y);
      if (binary[i] === 0) continue;
      const left = x > 0 ? labels[idx(x - 1, y)] : 0;
      const up = y > 0 ? labels[idx(x, y - 1)] : 0;
      if (left === 0 && up === 0) {
        parent[nextLabel] = nextLabel;
        labels[i] = nextLabel;
        nextLabel++;
      } else if (left !== 0 && up !== 0) {
        labels[i] = left;
        union(left, up);
      } else {
        labels[i] = left !== 0 ? left : up;
      }
    }
  }
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] !== 0) labels[i] = find(labels[i]);
  }
  return Array.from(labels);
}

function measureBlobs(labels: number[], w: number, h: number, minArea: number): Blob[] {
  const map = new Map<number, { area: number; minX: number; minY: number; maxX: number; maxY: number; cxSum: number; cySum: number }>();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const l = labels[y * w + x];
      if (l === 0) continue;
      const e = map.get(l) ?? { area: 0, minX: x, minY: y, maxX: x, maxY: y, cxSum: 0, cySum: 0 };
      e.area += 1;
      e.cxSum += x;
      e.cySum += y;
      if (x < e.minX) e.minX = x;
      if (x > e.maxX) e.maxX = x;
      if (y < e.minY) e.minY = y;
      if (y > e.maxY) e.maxY = y;
      map.set(l, e);
    }
  }
  const blobs: Blob[] = [];
  for (const e of map.values()) {
    if (e.area < minArea) continue;
    const bw = e.maxX - e.minX + 1;
    const bh = e.maxY - e.minY + 1;
    const perimeter = 2 * (bw + bh);
    const circularity = (4 * Math.PI * e.area) / Math.max(1, perimeter * perimeter);
    const eccentricity = bw >= bh ? Math.sqrt(Math.max(0, 1 - (bh * bh) / (bw * bw || 1))) : Math.sqrt(Math.max(0, 1 - (bw * bw) / (bh * bh || 1)));
    blobs.push({
      cx: e.cxSum / e.area,
      cy: e.cySum / e.area,
      area: e.area,
      bbox: { x: e.minX, y: e.minY, w: bw, h: bh },
      perimeter,
      circularity,
      eccentricity,
    });
  }
  return blobs;
}

export function analyzeImage(image: ImageData): ImageAnalysis {
  const w = image.width;
  const h = image.height;
  const gray = toGray(image);

  // Adaptive-ish threshold: use Otsu on a downsampled histogram for robustness.
  const hist = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  let total = gray.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let maxVar = 0;
  let threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar) {
      maxVar = between;
      threshold = t;
    }
  }

  const binary = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) binary[i] = gray[i] < threshold ? 1 : 0;

  // Small cleanup: remove specular noise via a 2x2 erosion pass.
  const cleaned = new Uint8Array(binary.length);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      cleaned[i] =
        binary[i] && binary[i - 1] && binary[i + 1] && binary[i - w] && binary[i + w] ? 1 : 0;
    }
  }

  const labels = labelComponents(cleaned, w, h);
  const minArea = Math.max(6, (w * h) / 4000);
  const blobs = measureBlobs(labels, w, h, minArea).sort((a, b) => a.cx - b.cx);

  // Expected dot area: use the median blob area as reference (the "golden" size).
  const areas = blobs.map((b) => b.area).sort((a, b) => a - b);
  const expectedArea = areas.length ? areas[Math.floor(areas.length / 2)] : 0;

  const dots: DotResult[] = blobs.map((b) => {
    const deviation = expectedArea ? (b.area - expectedArea) / expectedArea : 0;
    let cls: DetectedClass = 'perfect';
    if (b.circularity < 0.55 || b.eccentricity > 0.6) cls = 'irregular';
    else if (deviation < -0.4) cls = 'undersized';
    else if (deviation > 0.4) cls = 'oversized';
    else if (b.eccentricity > 0.72) cls = 'spread';
    return {
      class: cls,
      area: b.area,
      circularity: b.circularity,
      eccentricity: b.eccentricity,
      cx: b.cx,
      cy: b.cy,
      expectedArea,
      deviation,
    };
  });

  const mean = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  const std = (arr: number[]) => {
    if (!arr.length) return 0;
    const m = mean(arr);
    return Math.sqrt(arr.reduce((a, b) => a + (b - m) * (b - m), 0) / arr.length);
  };
  const meanArea = mean(areas);
  const areaCv = meanArea ? std(areas) / meanArea : 0;
  const meanCircularity = mean(dots.map((d) => d.circularity));
  const meanEccentricity = mean(dots.map((d) => d.eccentricity));
  const spreadRatio = blobs.length ? mean(blobs.map((b) => b.bbox.w / Math.max(1, b.bbox.h))) : 0;

  const counts: Record<DetectedClass, number> = { perfect: 0, undersized: 0, oversized: 0, missing: 0, irregular: 0, spread: 0 };
  for (const d of dots) counts[d.class]++;

  // Missing dots are inferred where the expected count (grid layout) exceeds detected blobs.
  const expectedCount = detectExpectedCount(blobs, w);
  const missingCount = Math.max(0, expectedCount - blobs.length);

  let dominant: DetectedClass = 'perfect';
  let dominantN = counts.perfect;
  for (const k of ['undersized', 'oversized', 'irregular', 'spread'] as DetectedClass[]) {
    if (counts[k] > dominantN) {
      dominant = k;
      dominantN = counts[k];
    }
  }

  const metrics = {
    count: blobs.length,
    expectedCount,
    missingCount,
    meanArea,
    areaCv,
    meanCircularity,
    meanEccentricity,
    spreadRatio,
    maxDeviation: Math.max(...dots.map((d) => Math.abs(d.deviation)), 0),
  };

  const defectDetected =
    counts.missing > 0 || counts.undersized > 0 || counts.oversized > 0 || counts.irregular > 0 || counts.spread > 0 || missingCount > 0;

  return { blobs, dots, metrics, dominantClass: dominant, defectDetected };
}

/** Heuristic expected-count estimate from dot grid layout (x-distribution clustering). */
function detectExpectedCount(blobs: Blob[], width: number): number {
  if (blobs.length === 0) return 0;
  const xs = blobs.map((b) => b.cx).sort((a, b) => a - b);
  const clusters: number[][] = [];
  let current: number[] = [xs[0]];
  const gap = width / Math.max(3, xs.length);
  for (let i = 1; i < xs.length; i++) {
    if (xs[i] - current[current.length - 1] <= gap * 1.6) {
      current.push(xs[i]);
    } else {
      clusters.push(current);
      current = [xs[i]];
    }
  }
  clusters.push(current);
  return clusters.length * Math.max(...clusters.map((c) => c.length));
}

/** Convert a drawn ImageData into an analysis for the quality-score module. */
export function imageDataFromCanvas(canvas: HTMLCanvasElement): ImageData {
  const ctx = canvas.getContext('2d')!;
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}