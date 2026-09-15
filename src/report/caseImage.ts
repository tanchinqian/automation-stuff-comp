import { BASE_URL } from '../api/pipeline';
import type { LegResult } from '../api/pipeline';

export interface CaseImage {
  url: string;
  format: 'JPEG' | 'PNG';
  label: string;
}

/** Mirrors the on-screen leg overlay colours (CLASS_COLORS in vision.ts). */
const OVERLAY_GOOD = '#5a9e6f';
const OVERLAY_DEFECT = '#ff5f6d';

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Pull the per-leg detections out of a stored `analysis_result` so a saved case
 * can be redrawn with the same YOLO boxes the live panel shows.
 */
export function legsFromAnalysis(raw: unknown): LegResult[] | undefined {
  const legs = (raw as { legs?: unknown } | undefined)?.legs;
  return Array.isArray(legs) && legs.length ? (legs as LegResult[]) : undefined;
}

/** Draw the leg boxes + labels onto a canvas copy of the board image. */
async function withLegOverlay(blob: Blob, legs: LegResult[]): Promise<CaseImage | null> {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('image decode failed'));
      i.src = objectUrl;
    });
    // same 900px cap the inspection panel uses, so boxes line up with the screen
    const scale = Math.min(1, 900 / img.naturalWidth);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 2;
    ctx.font = 'bold 10px "JetBrains Mono", "Cascadia Mono", Consolas, monospace';
    for (const leg of legs) {
      const [x1, y1, x2, y2] = leg.bbox;
      const x = x1 * scale;
      const y = y1 * scale;
      const color = leg.label === 'Good' ? OVERLAY_GOOD : OVERLAY_DEFECT;
      ctx.strokeStyle = `${color}cc`;
      ctx.strokeRect(x, y, (x2 - x1) * scale, (y2 - y1) * scale);
      ctx.fillStyle = color;
      ctx.fillText(`${leg.label} ${leg.confidence.toFixed(0)}%`, x + 2, y - 4);
    }
    return { url: canvas.toDataURL('image/jpeg', 0.9), format: 'JPEG', label: '' };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Fetch a case's board image from the pipeline server as a data URL so it can
 * be embedded in a PDF. When `legs` is supplied the image is redrawn with the
 * YOLO detection overlay. Returns null (never throws) when the path is missing
 * or the fetch fails, so report generation can continue without the image.
 *
 * case_log records may hold either a repo-relative posix path
 * ("train_data/JPEGImages/x.jpeg") or an absolute Windows path
 * ("C:\\...\\train_data\\JPEGImages\\x.jpeg"), so split on both separators.
 */
export async function fetchCaseImage(imagePath?: string | null, legs?: LegResult[]): Promise<CaseImage | null> {
  if (!imagePath || imagePath === 'manual-entry') return null;
  const base = imagePath.split(/[\\/]/).pop();
  if (!base) return null;
  try {
    const res = await fetch(`${BASE_URL}/boards/${encodeURIComponent(base)}/thumbnail`);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (legs && legs.length) {
      const overlaid = await withLegOverlay(blob, legs);
      if (overlaid) return { ...overlaid, label: base };
    }
    const url = await blobToDataUrl(blob);
    const format = blob.type.includes('png') ? 'PNG' : 'JPEG';
    return { url, format, label: base };
  } catch {
    return null;
  }
}
