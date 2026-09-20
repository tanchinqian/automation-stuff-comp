import { analyzeBoard, analyzeBoardFromDetections, BOARD_CLASS_LABELS, detectionCounts, imageDataFromCanvas, type BoardAnalysis, type BoardDefectClass, type PadResult } from '../vision/analyzeImage';
import { yoloAvailable, detectBoard } from '../vision/yoloDetector';
import { boardQualityScore, isUnscoredBoard, type QualityBreakdown } from '../vision/qualityScore';
import { createRegistry } from '../data';
import type { BoardImage, DatasetProvider } from '../data/types';
import { el, clear, button, stars } from './dom';
import {
  analyzeBoard as apiAnalyzeBoard,
  analyzeBoardUpload,
  getBoards,
  type AnalysisResult,
  type LegResult,
} from '../api/pipeline';

export interface VisionResult {
  label: string;
  imageUrl: string;
  board?: BoardAnalysis;
  quality?: QualityBreakdown;
  /** Full pipeline API result (present when analyzed via the local server). */
  analysis?: AnalysisResult;
}

export interface InspectionPanelHandle {
  panel: HTMLElement;
  getResult: () => VisionResult | null;
  /** set the feed handler after creation; flushes a queued result if present */
  setOnFeed: (fn: (r: VisionResult) => void) => void;
  /**
   * Select the first board matching `match` (default: a less-paste board), load
   * it onto the canvas and run the analysis. Does NOT auto-feed to the chat.
   */
  analyzeFirst: (match?: (b: BoardImage) => boolean) => Promise<VisionResult | null>;
}

// Good = phosphor green (accent). Defects = semantic red. Misalignment = amber.
// Blue is reserved for the user chat, so it is not used on the overlay.
const CLASS_COLORS: Record<string, string> = {
  good: '#5a9e6f',
  'less-paste': '#ff5f6d',
  missing: '#ff5f6d',
  bridging: '#ff5f6d',
  misalignment: '#ffb64d',
};

// ---------------------------------------------------------------------------
// Star-rating calibration (presentation only).
//
// These bands control how raw defect ratios map to the 1-5 star sub-scores in
// the Image Inspection panel. They are read fresh on every analysis and do NOT
// touch the rule engine, cause ranking, the X/100 score, saved cases, or the
// learning database.
// ---------------------------------------------------------------------------
export interface StarBands {
  /** ratio at or below this scores 4 stars */
  t4: number;
  /** ratio at or below this scores 3 stars */
  t3: number;
  /** ratio at or below this scores 2 stars */
  t2: number;
}

export interface RiskWeights {
  bridging: number;
  flagged: number;
  lessPaste: number;
}

export interface StarThresholds {
  shape: StarBands;
  volume: StarBands;
  position: StarBands;
  risk: { bands: StarBands; weights: RiskWeights };
}

export const DEFAULT_STAR_THRESHOLDS: StarThresholds = {
  shape: { t4: 0.05, t3: 0.15, t2: 0.3 },
  volume: { t4: 0.05, t3: 0.15, t2: 0.3 },
  position: { t4: 0.05, t3: 0.15, t2: 0.3 },
  risk: {
    bands: { t4: 0.05, t3: 0.15, t2: 0.3 },
    weights: { bridging: 0.4, flagged: 0.4, lessPaste: 0.2 },
  },
};

export const STAR_THRESHOLDS_KEY = 'calibration_star_thresholds';

const cloneThresholds = (t: StarThresholds): StarThresholds => ({
  shape: { ...t.shape },
  volume: { ...t.volume },
  position: { ...t.position },
  risk: { bands: { ...t.risk.bands }, weights: { ...t.risk.weights } },
});

const clampRatio = (value: unknown, fallback: number): number =>
  (typeof value === 'number' && Number.isFinite(value))
    ? Math.min(1, Math.max(0, value))
    : fallback;

/** Validate a stored payload; returns null when it is unusable. */
function parseThresholds(raw: string | null): StarThresholds | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Partial<StarThresholds>;
    if (!o || typeof o !== 'object') return null;
    const d = DEFAULT_STAR_THRESHOLDS;
    const bands = (b: Partial<StarBands> | undefined, fallback: StarBands): StarBands => ({
      t4: clampRatio(b?.t4, fallback.t4),
      t3: clampRatio(b?.t3, fallback.t3),
      t2: clampRatio(b?.t2, fallback.t2),
    });
    return {
      shape: bands(o.shape, d.shape),
      volume: bands(o.volume, d.volume),
      position: bands(o.position, d.position),
      risk: {
        bands: bands(o.risk?.bands, d.risk.bands),
        weights: {
          bridging: clampRatio(o.risk?.weights?.bridging, d.risk.weights.bridging),
          flagged: clampRatio(o.risk?.weights?.flagged, d.risk.weights.flagged),
          lessPaste: clampRatio(o.risk?.weights?.lessPaste, d.risk.weights.lessPaste),
        },
      },
    };
  } catch {
    return null;
  }
}

/** Live thresholds; read fresh by every analysis. */
export let starThresholds: StarThresholds = cloneThresholds(DEFAULT_STAR_THRESHOLDS);

/** Read persisted calibration at startup (falls back to defaults). */
export function loadStarThresholds(): void {
  try {
    const parsed = parseThresholds(localStorage.getItem(STAR_THRESHOLDS_KEY));
    if (parsed) starThresholds = parsed;
  } catch {
    // storage unavailable - keep defaults
  }
}

/** Apply and persist calibration values (used by the Calibration panel). */
export function applyStarThresholds(next: StarThresholds): void {
  starThresholds = cloneThresholds(next);
  try {
    localStorage.setItem(STAR_THRESHOLDS_KEY, JSON.stringify(starThresholds));
  } catch {
    // storage unavailable - the in-memory value still applies
  }
}

/** Revert to the original defaults and drop the stored override. */
export function resetStarThresholds(): void {
  starThresholds = cloneThresholds(DEFAULT_STAR_THRESHOLDS);
  try {
    localStorage.removeItem(STAR_THRESHOLDS_KEY);
  } catch {
    // ignore
  }
}

/** Bands must ascend (t4 <= t3 <= t2) or the star mapping inverts. */
export function starThresholdsAscend(t: StarThresholds): boolean {
  const ok = (b: StarBands): boolean => b.t4 <= b.t3 && b.t3 <= b.t2;
  return ok(t.shape) && ok(t.volume) && ok(t.position) && ok(t.risk.bands);
}

loadStarThresholds();

/**
 * Map a defect proportion (0-1, higher = worse) to a whole-star 0-5 score so
 * severity matters: 1 bad leg out of 40 must not score the same as 10 out of 40.
 * Exported so the calibration mapping can be verified outside the DOM.
 */
export function severityStars(ratio: number, bands: StarBands): number {
  if (ratio <= 0) return 5;
  if (ratio <= bands.t4) return 4;
  if (ratio <= bands.t3) return 3;
  if (ratio <= bands.t2) return 2;
  return 1;
}

/**
 * Workbench inspection panel, fed by the dataset registry. Swapping the
 * active dataset (see src/data/datasetConfig.ts) changes which boards the
 * gallery shows without touching this component or the CV pipeline.
 */
export function createInspectionPanel(opts: {
  onAnalyze?: (r: VisionResult) => void;
  onFeed?: (r: VisionResult) => void;
} = {}): InspectionPanelHandle {
  const { onAnalyze = () => {} } = opts;
  // feeding is now automatic after analysis; keep the handler optional and
  // queue the result if it is not set up yet
  let onFeedHandler: ((r: VisionResult) => void) | null = opts.onFeed ?? null;
  let pendingFeed: VisionResult | null = null;
  const deliverFeed = (r: VisionResult) => {
    if (onFeedHandler) onFeedHandler(r);
    else pendingFeed = r;
  };
  const body = el('div', 'panel-body');
  let lastResult: VisionResult | null = null;
  let lastCanvas: HTMLCanvasElement | null = null;
  let lastImageData: ImageData | null = null;
  let lastPadRois: { x: number; y: number; w: number; h: number }[] | undefined;
  let lastLabel = '';
  let lastBoard: BoardAnalysis | null = null;
  let lastGroundTruth: string | null = null;
  let lastEngine: 'yolo' | 'classical' | 'api' = 'classical';
  let currentSource: 'board' | 'upload' = 'board';
  let baseImage: HTMLImageElement | null = null;
  type FilterId = 'all' | 'defects' | 'less-paste' | 'bridging' | 'good';
  let activeFilter: FilterId = 'all';
  let selectedLegId: number | null = null;
  let selectedPadIndex: number | null = null;

  // pipeline-API state
  let lastAnalysis: AnalysisResult | null = null;
  let lastLegs: LegResult[] = [];
  let lastUploadFile: File | null = null;
  let lastServerPath: string | null = null;
  let lastScale = 1; // canvas pixels / original image pixels
  let serverPaths = new Map<string, string>(); // original filename -> server path

  // Fetch the server board list once so gallery boards can be analyzed by path.
  getBoards()
    .then((list) => {
      serverPaths = new Map(list.map((b) => [b.filename, b.path]));
    })
    .catch(() => {
      /* server offline - uploads still work, boards fall back to on-device */
    });

  const registry = createRegistry();

  // ---- Board gallery ----
  const galleryLabel = el('div', 'question-label', 'Select a real inspection board');
  body.appendChild(galleryLabel);
  const gallery = el('div', 'scene-picker');
  body.appendChild(gallery);

  // ---- Filter bar ----
  const filterBar = el('div', 'vision-filter-bar');
  const filterLabel = el('span', 'vision-filter-label', 'Filter:');
  filterBar.appendChild(filterLabel);

  const filterDefs: { id: FilterId; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'defects', label: 'Defects (⚠)' },
    { id: 'less-paste', label: 'Less Paste' },
    { id: 'bridging', label: 'Bridging' },
    { id: 'good', label: 'Good' },
  ];

  const filterChips = new Map<FilterId, HTMLButtonElement>();
  for (const def of filterDefs) {
    const chip = el('button', 'vision-filter-chip', def.label) as HTMLButtonElement;
    chip.type = 'button';
    if (def.id === 'all') chip.classList.add('selected');
    chip.onclick = () => {
      activeFilter = def.id;
      filterChips.forEach((c) => c.classList.remove('selected'));
      chip.classList.add('selected');
      redrawCurrentOverlay();
    };
    filterChips.set(def.id, chip);
    filterBar.appendChild(chip);
  }
  body.appendChild(filterBar);

  // ---- Canvas frame ----
  const frame = el('div', 'canvas-frame');
  const canvas = document.createElement('canvas');
  canvas.width = 300;
  canvas.height = 240;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Inspection image with computer-vision detection overlay');
  frame.appendChild(canvas);
  body.appendChild(frame);

  // hover tooltip showing a leg's label + confidence
  const tooltip = el('div', 'overlay-tooltip');
  tooltip.style.cssText =
    'position:absolute;pointer-events:none;padding:5px 8px;font:12px/1.4 var(--sans);font-variant-numeric:tabular-nums;' +
    'background:var(--bg-2);border:1px solid var(--line);border-radius:var(--r-3);' +
    'color:var(--ink);display:none;white-space:nowrap;z-index:5;';
  frame.style.position = 'relative';
  frame.appendChild(tooltip);

  const redrawCurrentOverlay = () => {
    if (!baseImage) return;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(baseImage, 0, 0, canvas.width, canvas.height);
    if (lastAnalysis && lastLegs.length) {
      drawLegOverlay(canvas, lastLegs, lastScale, activeFilter, selectedLegId);
    } else if (lastBoard) {
      drawBoardOverlay(canvas, lastBoard, activeFilter, selectedPadIndex);
    }
  };

  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    if (lastLegs.length) {
      const ix = (e.clientX - rect.left) / lastScale;
      const iy = (e.clientY - rect.top) / lastScale;
      const hit = lastLegs.find((l) => {
        const [x1, y1, x2, y2] = l.bbox;
        return ix >= x1 && ix <= x2 && iy >= y1 && iy <= y2;
      });
      if (hit) {
        canvas.style.cursor = 'crosshair';
        tooltip.textContent = `#${hit.leg_id} ${hit.label} ${hit.confidence.toFixed(0)}%${hit.flag ? ' ⚠' : ''} (click to inspect)`;
        tooltip.style.display = 'block';
        tooltip.style.left = `${e.clientX - rect.left + 10}px`;
        tooltip.style.top = `${e.clientY - rect.top + 10}px`;
      } else {
        canvas.style.cursor = 'default';
        tooltip.style.display = 'none';
      }
    } else if (lastBoard?.pads.length) {
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const hit = lastBoard.pads.find((p) => {
        const { x, y, w, h } = p.rect;
        return cx >= x && cx <= x + w && cy >= y && cy <= y + h;
      });
      if (hit) {
        canvas.style.cursor = 'crosshair';
        tooltip.textContent = `Pad #${hit.index + 1} ${hit.class} (click to inspect)`;
        tooltip.style.display = 'block';
        tooltip.style.left = `${e.clientX - rect.left + 10}px`;
        tooltip.style.top = `${e.clientY - rect.top + 10}px`;
      } else {
        canvas.style.cursor = 'default';
        tooltip.style.display = 'none';
      }
    } else {
      canvas.style.cursor = 'default';
      tooltip.style.display = 'none';
    }
  });

  canvas.addEventListener('mouseleave', () => {
    tooltip.style.display = 'none';
    canvas.style.cursor = 'default';
  });

  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    if (lastLegs.length) {
      const ix = (e.clientX - rect.left) / lastScale;
      const iy = (e.clientY - rect.top) / lastScale;
      const hit = lastLegs.find((l) => {
        const [x1, y1, x2, y2] = l.bbox;
        return ix >= x1 && ix <= x2 && iy >= y1 && iy <= y2;
      });
      if (hit) {
        selectedLegId = selectedLegId === hit.leg_id ? null : hit.leg_id;
        selectedPadIndex = null;
        updatePadInspector(selectedLegId === null ? null : hit, null);
        redrawCurrentOverlay();
      } else {
        selectedLegId = null;
        updatePadInspector(null, null);
        redrawCurrentOverlay();
      }
    } else if (lastBoard?.pads.length) {
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const hit = lastBoard.pads.find((p) => {
        const { x, y, w, h } = p.rect;
        return cx >= x && cx <= x + w && cy >= y && cy <= y + h;
      });
      if (hit) {
        selectedPadIndex = selectedPadIndex === hit.index ? null : hit.index;
        selectedLegId = null;
        updatePadInspector(null, selectedPadIndex === null ? null : hit);
        redrawCurrentOverlay();
      } else {
        selectedPadIndex = null;
        updatePadInspector(null, null);
        redrawCurrentOverlay();
      }
    }
  });

  // ---- Pad Inspector Card ----
  const padInspector = el('div', 'pad-inspector-card');
  const inspectorHead = el('div', 'pad-inspector-head');
  const headTag = el('div', 'title-tag');
  const headTitle = el('span', '', 'PAD RETICLE: STANDBY');
  headTag.appendChild(headTitle);
  inspectorHead.appendChild(headTag);

  const clearInspectBtn = el('button', 'btn sm ghost', '× CLEAR') as HTMLButtonElement;
  clearInspectBtn.type = 'button';
  clearInspectBtn.style.display = 'none';
  inspectorHead.appendChild(clearInspectBtn);
  padInspector.appendChild(inspectorHead);

  const inspectorBody = el('div', 'pad-inspector-body');
  const cropFrame = el('div', 'pad-crop-frame');
  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = 96;
  cropCanvas.height = 96;
  cropFrame.appendChild(cropCanvas);
  inspectorBody.appendChild(cropFrame);

  const telemetryGrid = el('div', 'pad-telemetry-grid');
  inspectorBody.appendChild(telemetryGrid);
  padInspector.appendChild(inspectorBody);

  const standbyMsg = el('div', 'pad-inspector-standby', 'Click any pad bounding box on the canvas to inspect micro-crop and measurements.');
  padInspector.appendChild(standbyMsg);
  inspectorBody.style.display = 'none';

  body.appendChild(padInspector);

  const renderMicroCrop = (leg: LegResult | null, pad: PadResult | null) => {
    const cropCtx = cropCanvas.getContext('2d');
    if (!cropCtx) return;
    cropCtx.clearRect(0, 0, cropCanvas.width, cropCanvas.height);
    if (!baseImage || (!leg && !pad)) {
      cropCtx.strokeStyle = 'rgba(255,255,255,0.08)';
      cropCtx.lineWidth = 1;
      for (let p = 10; p < 96; p += 12) {
        cropCtx.beginPath();
        cropCtx.moveTo(p, 0); cropCtx.lineTo(p, 96);
        cropCtx.moveTo(0, p); cropCtx.lineTo(96, p);
        cropCtx.stroke();
      }
      return;
    }
    let x1 = 0;
    let y1 = 0;
    let w = 0;
    let h = 0;
    if (leg) {
      [x1, y1] = [leg.bbox[0], leg.bbox[1]];
      w = leg.bbox[2] - leg.bbox[0];
      h = leg.bbox[3] - leg.bbox[1];
    } else if (pad) {
      x1 = pad.rect.x / lastScale;
      y1 = pad.rect.y / lastScale;
      w = pad.rect.w / lastScale;
      h = pad.rect.h / lastScale;
    }
    const margin = 6;
    const sx = Math.max(0, x1 - margin);
    const sy = Math.max(0, y1 - margin);
    const sw = Math.min(baseImage.naturalWidth - sx, w + margin * 2);
    const sh = Math.min(baseImage.naturalHeight - sy, h + margin * 2);
    cropCtx.imageSmoothingEnabled = false;
    cropCtx.drawImage(baseImage, sx, sy, sw, sh, 0, 0, cropCanvas.width, cropCanvas.height);

    // Reticle & crosshair in brand color
    const cx = cropCanvas.width / 2;
    const cy = cropCanvas.height / 2;
    cropCtx.strokeStyle = '#2ee6a8aa';
    cropCtx.lineWidth = 1;
    cropCtx.beginPath();
    cropCtx.moveTo(cx - 8, cy); cropCtx.lineTo(cx + 8, cy);
    cropCtx.moveTo(cx, cy - 8); cropCtx.lineTo(cx, cy + 8);
    cropCtx.stroke();

    const b = 6;
    cropCtx.strokeStyle = '#2ee6a8cc';
    cropCtx.strokeRect(b, b, cropCanvas.width - b * 2, cropCanvas.height - b * 2);
  };

  const updatePadInspector = (leg: LegResult | null, pad: PadResult | null) => {
    if (!leg && !pad) {
      standbyMsg.style.display = 'flex';
      inspectorBody.style.display = 'none';
      headTitle.textContent = 'PAD RETICLE: STANDBY';
      clearInspectBtn.style.display = 'none';
      renderMicroCrop(null, null);
      return;
    }

    standbyMsg.style.display = 'none';
    inspectorBody.style.display = 'flex';
    clearInspectBtn.style.display = 'inline-block';

    const idStr = leg ? `LEG #${leg.leg_id}` : `PAD #${pad!.index + 1}`;
    const labelStr = leg ? leg.label : (pad!.class === 'good' ? 'Good' : pad!.class === 'bridging' ? 'Bridging' : 'Less Paste');
    const confVal = leg ? leg.confidence : (pad!.fillRatio * 100);
    const isGood = labelStr.toLowerCase() === 'good';
    const statusColor = isGood ? 'var(--status-good)' : 'var(--status-fail)';

    headTitle.innerHTML = `${idStr} · <span style="color:${statusColor}">${labelStr.toUpperCase()}</span>`;

    clear(telemetryGrid);
    const addStat = (lbl: string, val: string, valColor = '') => {
      const it = el('div', 'pad-stat-item');
      it.appendChild(el('div', 'pad-stat-label', lbl));
      const v = el('div', 'pad-stat-value', val);
      if (valColor) v.style.color = valColor;
      it.appendChild(v);
      telemetryGrid.appendChild(it);
    };

    addStat('Class', labelStr, statusColor);
    addStat('Confidence', `${confVal.toFixed(1)}%`);

    if (leg) {
      const [x1, y1, x2, y2] = leg.bbox;
      addStat('Coords', `[${Math.round(x1)}, ${Math.round(y1)}]`);
      addStat('Dimensions', `${Math.round(x2 - x1)} × ${Math.round(y2 - y1)} px`);
      addStat('Review Flag', leg.flag ? '⚠ Flagged' : '✓ Nominal', leg.flag ? 'var(--status-warn)' : 'var(--status-good)');
      addStat('Model', 'YOLOv8n + MobileNetV2');
    } else if (pad) {
      addStat('Fill Ratio', `${(pad.fillRatio * 100).toFixed(1)}%`);
      addStat('Dimensions', `${Math.round(pad.rect.w)} × ${Math.round(pad.rect.h)} px`);
      addStat('Verdict', isGood ? 'Pass' : 'Defect Detected', statusColor);
      addStat('Engine', 'On-device CV');
    }

    renderMicroCrop(leg, pad);
  };

  clearInspectBtn.onclick = () => {
    selectedLegId = null;
    selectedPadIndex = null;
    updatePadInspector(null, null);
    redrawCurrentOverlay();
  };

  const updateFilterCounts = () => {
    if (lastLegs.length) {
      const total = lastLegs.length;
      const defects = lastLegs.filter((l) => l.label !== 'Good').length;
      const less = lastLegs.filter((l) => l.label === 'Less Paste').length;
      const bridge = lastLegs.filter((l) => l.label === 'Bridging').length;
      const good = lastLegs.filter((l) => l.label === 'Good').length;

      filterChips.get('all')!.textContent = `All (${total})`;
      filterChips.get('defects')!.textContent = `Defects (${defects})`;
      filterChips.get('less-paste')!.textContent = `Less Paste (${less})`;
      filterChips.get('bridging')!.textContent = `Bridging (${bridge})`;
      filterChips.get('good')!.textContent = `Good (${good})`;
    } else if (lastBoard?.pads.length) {
      const total = lastBoard.pads.length;
      const defects = lastBoard.pads.filter((p) => p.class !== 'good').length;
      const less = lastBoard.pads.filter((p) => p.class === 'less-paste').length;
      const bridge = lastBoard.pads.filter((p) => p.class === 'bridging').length;
      const good = lastBoard.pads.filter((p) => p.class === 'good').length;

      filterChips.get('all')!.textContent = `All (${total})`;
      filterChips.get('defects')!.textContent = `Defects (${defects})`;
      filterChips.get('less-paste')!.textContent = `Less Paste (${less})`;
      filterChips.get('bridging')!.textContent = `Bridging (${bridge})`;
      filterChips.get('good')!.textContent = `Good (${good})`;
    } else {
      filterChips.get('all')!.textContent = 'All';
      filterChips.get('defects')!.textContent = 'Defects (⚠)';
      filterChips.get('less-paste')!.textContent = 'Less Paste';
      filterChips.get('bridging')!.textContent = 'Bridging';
      filterChips.get('good')!.textContent = 'Good';
    }
  };

  const legend = el('div', 'overlay-legend', '');
  legend.setAttribute('aria-live', 'polite');
  body.appendChild(legend);

  // ---- Buttons ----
  const row = el('div', 'freetext-row');
  const uploadLabel = el('label', 'btn', 'UPLOAD PHOTO') as HTMLLabelElement;
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.style.display = 'none';
  uploadLabel.style.cursor = 'pointer';
  uploadLabel.appendChild(fileInput);
  const analyzeBtn = button('ANALYZE BOARD', 'btn primary');
  row.appendChild(uploadLabel);
  row.appendChild(analyzeBtn);
  body.appendChild(row);

  const qualityBox = el('div', '');
  body.appendChild(qualityBox);

  const clearBoard = () => {
    lastBoard = null;
    lastPadRois = undefined;
    selectedLegId = null;
    selectedPadIndex = null;
    updatePadInspector(null, null);
    updateFilterCounts();
    clear(qualityBox);
  };

  const loadBoard = (board: BoardImage) => new Promise<void>((resolve) => {
    const img = new Image();
    img.onload = () => {
      baseImage = img;
      selectedLegId = null;
      selectedPadIndex = null;
      updatePadInspector(null, null);
      updateFilterCounts();
      const scale = Math.min(1, 900 / img.naturalWidth);
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      lastCanvas = canvas;
      lastImageData = imageDataFromCanvas(canvas);
      // board.json padRois are stored normalised (0..1); analyzeBoard scales to pixels
      lastPadRois = board.padRois?.length ? board.padRois : undefined;
      lastLabel = board.label;
      lastGroundTruth = board.class === 'unknown' ? null : board.class;
      currentSource = 'board';
      // remember the scale + a server path so the API can analyze the original
      lastScale = canvas.width / img.naturalWidth;
      const original = (board.src.split('/').pop() ?? '').replace(/^pcb-aoi-/, '');
      lastServerPath = serverPaths.get(original) ?? null;
      lastUploadFile = null;
      lastAnalysis = null;
      lastLegs = [];
      clearBoard();
      const gtLabel = board.class === 'unknown' ? 'unknown' : BOARD_CLASS_LABELS[board.class];
      legend.textContent = `${board.label} - ground truth: ${gtLabel} - run ANALYZE BOARD`;
      resolve();
    };
    img.onerror = () => resolve();
    img.src = board.src;
  });

  // Populate gallery from the active dataset provider
  let boardList: BoardImage[] = [];
  const provider = registry.get('pcb-aoi') as DatasetProvider;
  provider.list().then((boards) => {
    boardList = boards;
    for (const b of boards) {
      const chip = el('button', 'scene-chip', b.class === 'good' ? '✓ ' + b.class.replace(/-/g, ' ') : '⚠ ' + b.class.replace(/-/g, ' ')) as HTMLButtonElement;
      chip.type = 'button';
      chip.title = b.label;
      chip.onclick = () => {
        gallery.querySelectorAll('.scene-chip').forEach((c) => c.classList.remove('selected'));
        chip.classList.add('selected');
        void loadBoard(b);
      };
      gallery.appendChild(chip);
    }
  });

  // Upload handling
  const loadFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        baseImage = img;
        selectedLegId = null;
        selectedPadIndex = null;
        updatePadInspector(null, null);
        updateFilterCounts();
        const maxW = 900;
        const scale = Math.min(1, maxW / img.width);
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        lastCanvas = canvas;
        lastImageData = imageDataFromCanvas(canvas);
        lastPadRois = undefined;
        lastLabel = `Uploaded: ${file.name}`;
        lastGroundTruth = null;
        currentSource = 'upload';
        lastScale = canvas.width / img.width;
        lastServerPath = null;
        lastUploadFile = file;
        lastAnalysis = null;
        lastLegs = [];
        clearBoard();
        legend.textContent = `Uploaded ${file.name} - run ANALYZE BOARD`;
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };
  fileInput.onchange = () => {
    const f = fileInput.files?.[0];
    if (f) loadFile(f);
  };

  const run = async (deliver = true): Promise<VisionResult | null> => {
    if (!lastImageData) {
      legend.textContent = 'No frame to analyze - pick a board or upload a photo first.';
      return null;
    }

    analyzeBtn.disabled = true;
    analyzeBtn.textContent = 'PROCESSING…';
    let board: BoardAnalysis;
    try {
      // real boards + uploads go through the local pipeline API
      try {
        legend.textContent = 'Running pipeline API (YOLO + classifier)…';
        let analysis: AnalysisResult;
        if (currentSource === 'upload' && lastUploadFile) {
          analysis = await analyzeBoardUpload(lastUploadFile);
        } else if (lastServerPath) {
          analysis = await apiAnalyzeBoard(lastServerPath);
        } else {
          // board not on the server - send the rendered frame as an upload
          const blob = await canvasToBlob(canvas);
          analysis = await analyzeBoardUpload(new File([blob], 'board.jpg', { type: 'image/jpeg' }));
        }
        lastAnalysis = analysis;
        lastLegs = analysis.legs;
        lastEngine = 'api';
        board = analysisToBoard(analysis);
      } catch (apiErr) {
        // server unreachable - fall back to the existing on-device pipeline
        console.warn('pipeline API unavailable, using on-device pipeline', apiErr);
        const useYolo = await yoloAvailable();
        lastEngine = useYolo ? 'yolo' : 'classical';
        lastAnalysis = null;
        lastLegs = [];
        if (useYolo) {
          legend.textContent = 'Server offline - running on-device YOLO detection…';
          const detections = await detectBoard(lastImageData);
          board = analyzeBoardFromDetections(detections, lastImageData.width, lastImageData.height);
        } else {
          board = analyzeBoard(lastImageData, lastPadRois);
        }
      }
    } finally {
      analyzeBtn.disabled = false;
      analyzeBtn.textContent = 'ANALYZE BOARD';
    }

    lastBoard = board;
    updateFilterCounts();
    if (lastAnalysis) {
      drawLegOverlay(canvas, lastLegs, lastScale, activeFilter, selectedLegId);
    } else {
      drawBoardOverlay(canvas, board, activeFilter, selectedPadIndex);
    }

    const quality = boardQualityScore(board);
    if (lastAnalysis && lastAnalysis.total_legs_detected > 0) {
      quality.overall = Math.round(
        (lastAnalysis.defect_summary.Good / lastAnalysis.total_legs_detected) * 100,
      );
    }
    const dominant = BOARD_CLASS_LABELS[board.dominantDefect];
    const counts = detectionCounts(board);

    // engine chip + tag
    const engineText =
      lastEngine === 'api' ? 'YOLOv8n + classifier' : lastEngine === 'yolo' ? 'YOLOv8n' : 'classical';
    engineChip.textContent = `engine: ${engineText}`;
    engineChip.classList.toggle('stub', lastEngine === 'classical');
    const engineTag =
      lastEngine === 'api'
        ? '<b style="color:var(--brand)">YOLOv8n + MobileNetV2</b>'
        : lastEngine === 'yolo'
          ? '<b style="color:var(--brand)">YOLOv8n</b>'
          : '<b style="color:var(--warn)">classical</b>';

    // ground-truth comparison tag (real boards only)
    let gtTag = '';
    if (lastGroundTruth && currentSource === 'board') {
      const gt = BOARD_CLASS_LABELS[lastGroundTruth as BoardDefectClass] ?? lastGroundTruth;
      const match = lastGroundTruth === board.dominantDefect;
      gtTag = ` - GT: <b>${gt}</b> <span style="color:var(--${match ? 'accent' : 'warn'})">${match ? '✓' : '✗'}</span>`;
    }

    // No legs at all: there is nothing to measure, so render an explicit
    // "not measured" state instead of the empty-pad-derived numbers.
    const unscored = isUnscoredBoard(board);

    clear(qualityBox);
    const qh = el('div', unscored ? 'q-hero unscored' : 'q-hero');
    qh.appendChild(el('div', 'score', unscored ? '--' : `${quality.overall}`));
    qh.appendChild(el('div', 'score-label', unscored
      ? 'No board detected - 0 legs found'
      : `board quality / 100 - ${dominant}`));
    qualityBox.appendChild(qh);

    // Component scores: the server pipeline derives them from the per-leg
    // proportions; the classical detector uses boardQualityScore() directly.
    let qShape = quality.shape;
    let qSize = quality.size;
    let qPosition = quality.position;
    let qRisk = quality.defectRisk;
    if (lastAnalysis && lastAnalysis.total_legs_detected > 0) {
      const ds = lastAnalysis.defect_summary;
      const total = lastAnalysis.total_legs_detected;
      const bridgingRatio = ds.Bridging / total;
      const lessPasteRatio = ds['Less Paste'] / total;
      const flaggedRatio = lastAnalysis.flagged_legs / total;
      qShape = severityStars(bridgingRatio, starThresholds.shape);
      qSize = severityStars(lessPasteRatio, starThresholds.volume);
      qPosition = severityStars(flaggedRatio, starThresholds.position);
      // defect risk blends the other three; bridging and flagged legs weigh
      // higher by default because they are more urgent than a paste shortfall
      const w = starThresholds.risk.weights;
      qRisk = severityStars(
        bridgingRatio * w.bridging + flaggedRatio * w.flagged + lessPasteRatio * w.lessPaste,
        starThresholds.risk.bands,
      );
    }

    if (lastAnalysis) {
      const a = lastAnalysis;
      const ds = a.defect_summary;
      legend.innerHTML =
        `${engineTag} - ${a.total_legs_detected} leg(s) - less-paste ${ds['Less Paste']} / bridging ${ds.Bridging} / good ${ds.Good} - ` +
        `flagged ${a.flagged_legs}${a.flagged_legs ? ' ⚠' : ''}${gtTag}`;
    } else {
      legend.innerHTML = `${engineTag} - ${board.pads.length} detection(s) - ${dominant} - less-paste ${counts.lessPaste} / bridging ${counts.bridging}${gtTag}`;
    }

    // Always show the four component cards, whichever engine produced the result
    const grid = el('div', 'q-grid');
    const card = (label: string, val: number) => {
      const c = el('div', 'q-card');
      c.appendChild(el('div', 'qlabel', label));
      if (unscored) {
        // nothing was detected, so no star count is meaningful here
        c.appendChild(el('div', 'stars empty', 'N/A'));
        c.appendChild(el('div', 'qval', 'not measured'));
      } else {
        c.appendChild(el('div', 'stars', stars(val)));
        c.appendChild(el('div', 'qval', `${val} / 5`));
      }
      grid.appendChild(c);
    };
    card('Shape / fill', qShape);
    card('Volume', qSize);
    card('Position', qPosition);
    card('Defect risk', qRisk);
    qualityBox.appendChild(grid);

    lastResult = {
      label: lastLabel,
      imageUrl: canvas.toDataURL(),
      board,
      quality,
      analysis: lastAnalysis ?? undefined,
    };
    onAnalyze?.(lastResult);
    // automatically hand the result to the diagnosis chat
    if (deliver) deliverFeed(lastResult);
    return lastResult;
  };
  analyzeBtn.onclick = () => { void run(); };

  const panelEl = el('section', 'panel');
  const head = el('div', 'panel-head');
  head.appendChild(el('span', 'panel-mark'));
  head.appendChild(el('span', 'title', 'Image Inspection'));
  const engineChip = el('span', 'live-badge', 'engine: -');
  head.appendChild(engineChip);
  panelEl.appendChild(head);
  panelEl.appendChild(body);

  return {
    panel: panelEl,
    getResult: () => lastResult,
    setOnFeed: (fn: (r: VisionResult) => void) => {
      onFeedHandler = fn;
      if (pendingFeed) {
        const queued = pendingFeed;
        pendingFeed = null;
        fn(queued);
      }
    },
    analyzeFirst: async (match) => {
      if (!boardList.length) {
        try { boardList = await provider.list(); } catch { /* ignore */ }
      }
      const predicate = match ?? ((b: BoardImage) => b.class === 'less-paste');
      const board = boardList.find(predicate) ?? boardList[0];
      if (!board) return null;
      gallery.querySelectorAll('.scene-chip').forEach((c) => c.classList.remove('selected'));
      const chip = Array.from(gallery.querySelectorAll('.scene-chip'))
        .find((c) => (c as HTMLButtonElement).title === board.label);
      chip?.classList.add('selected');
      await loadBoard(board);
      return run(false); // analyze without auto-feeding to the chat
    },
  };
}

function drawBoardOverlay(
  canvas: HTMLCanvasElement,
  board: BoardAnalysis,
  filter: string = 'all',
  selectedIdx: number | null = null,
): void {
  const ctx = canvas.getContext('2d')!;
  ctx.lineWidth = 2;
  for (const pad of board.pads) {
    const isGood = pad.class === 'good';
    const isLess = pad.class === 'less-paste';
    const isBridge = pad.class === 'bridging';
    const isSelected = selectedIdx === pad.index;

    if (filter === 'defects' && isGood && !isSelected) continue;
    if (filter === 'less-paste' && !isLess && !isSelected) continue;
    if (filter === 'bridging' && !isBridge && !isSelected) continue;
    if (filter === 'good' && !isGood && !isSelected) continue;

    const { x, y, w, h } = pad.rect;
    ctx.strokeStyle = isSelected ? '#2ee6a8' : CLASS_COLORS[pad.class] + 'cc';
    ctx.lineWidth = isSelected ? 3 : 2;
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = isSelected ? '#2ee6a8' : CLASS_COLORS[pad.class];
    ctx.font = 'bold 10px "JetBrains Mono", "Cascadia Mono", Consolas, monospace';
    const conf = pad.fillRatio > 0 && pad.fillRatio <= 1 ? ` ${(pad.fillRatio * 100).toFixed(0)}%` : '';
    ctx.fillText(pad.class.replace(/-/g, ' ').toUpperCase() + conf, x + 2, y - 4);

    if (isSelected) {
      ctx.strokeStyle = '#2ee6a8';
      ctx.lineWidth = 1.5;
      const bLen = Math.min(6, Math.max(3, w / 3), Math.max(3, h / 3));
      ctx.beginPath();
      ctx.moveTo(x - 4, y - 4 + bLen); ctx.lineTo(x - 4, y - 4); ctx.lineTo(x - 4 + bLen, y - 4);
      ctx.moveTo(x + w + 4 - bLen, y - 4); ctx.lineTo(x + w + 4, y - 4); ctx.lineTo(x + w + 4, y - 4 + bLen);
      ctx.moveTo(x - 4, y + h + 4 - bLen); ctx.lineTo(x - 4, y + h + 4); ctx.lineTo(x - 4 + bLen, y + h + 4);
      ctx.moveTo(x + w + 4 - bLen, y + h + 4); ctx.lineTo(x + w + 4, y + h + 4); ctx.lineTo(x + w + 4, y + h + 4 - bLen);
      ctx.stroke();
    }
  }
}

/** Promise wrapper around canvas.toBlob for the upload fallback path. */
function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('canvas.toBlob returned null'))),
      'image/jpeg',
      0.92,
    );
  });
}

/**
 * Adapt a pipeline-API AnalysisResult into the shared BoardAnalysis shape so
 * the existing quality scoring, overlay legend and chat layer keep working.
 */
function analysisToBoard(a: AnalysisResult): BoardAnalysis {
  const pads: PadResult[] = a.legs.map((leg, i) => {
    const cls: PadResult['class'] =
      leg.label === 'Good' ? 'good' : leg.label === 'Bridging' ? 'bridging' : 'less-paste';
    const [x1, y1, x2, y2] = leg.bbox;
    return {
      index: i,
      rect: { x: x1, y: y1, w: Math.max(1, x2 - x1), h: Math.max(1, y2 - y1) },
      fillRatio: leg.confidence / 100,
      centroidDx: 0,
      centroidDy: 0,
      bridged: cls === 'bridging',
      class: cls,
    };
  });

  const defectCounts: Record<BoardDefectClass, number> = {
    good: a.defect_summary.Good,
    'less-paste': a.defect_summary['Less Paste'],
    missing: 0,
    bridging: a.defect_summary.Bridging,
    misalignment: 0,
  };

  let dominant: BoardDefectClass = 'good';
  let domN = 0;
  for (const k of ['less-paste', 'bridging'] as BoardDefectClass[]) {
    if (defectCounts[k] > domN) {
      domN = defectCounts[k];
      dominant = k;
    }
  }

  const goodRatio = a.total_legs_detected ? a.defect_summary.Good / a.total_legs_detected : 1;
  return {
    pads,
    defectCounts,
    dominantDefect: dominant,
    // no verdict from the model - derive "defects present" from the counts
    defectDetected: a.defect_summary['Less Paste'] + a.defect_summary.Bridging > 0,
    boardQuality: Math.round(goodRatio * 100),
  };
}

/**
 * Draw per-leg boxes from the API result: green = Good, red = Less Paste /
 * Bridging, with a label + confidence on each box. Coords are original image
 * pixels, scaled to the (possibly smaller) canvas.
 */
function drawLegOverlay(
  canvas: HTMLCanvasElement,
  legs: LegResult[],
  scale: number,
  filter: string = 'all',
  selectedId: number | null = null,
): void {
  const ctx = canvas.getContext('2d')!;
  ctx.lineWidth = 2;
  ctx.font = 'bold 10px "JetBrains Mono", "Cascadia Mono", Consolas, monospace';
  for (const leg of legs) {
    const isGood = leg.label === 'Good';
    const isLess = leg.label === 'Less Paste';
    const isBridge = leg.label === 'Bridging';
    const isSelected = selectedId === leg.leg_id;

    if (filter === 'defects' && isGood && !isSelected) continue;
    if (filter === 'less-paste' && !isLess && !isSelected) continue;
    if (filter === 'bridging' && !isBridge && !isSelected) continue;
    if (filter === 'good' && !isGood && !isSelected) continue;

    const [x1, y1, x2, y2] = leg.bbox;
    const x = x1 * scale;
    const y = y1 * scale;
    const w = (x2 - x1) * scale;
    const h = (y2 - y1) * scale;
    const color = isGood ? CLASS_COLORS.good : CLASS_COLORS['less-paste'];
    ctx.strokeStyle = isSelected ? '#2ee6a8' : color + 'cc';
    ctx.lineWidth = isSelected ? 3 : 2;
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = isSelected ? '#2ee6a8' : color;
    ctx.fillText(`${leg.label} ${leg.confidence.toFixed(0)}%`, x + 2, y - 4);

    if (isSelected) {
      ctx.strokeStyle = '#2ee6a8';
      ctx.lineWidth = 1.5;
      const bLen = Math.min(6, Math.max(3, w / 3), Math.max(3, h / 3));
      ctx.beginPath();
      ctx.moveTo(x - 4, y - 4 + bLen); ctx.lineTo(x - 4, y - 4); ctx.lineTo(x - 4 + bLen, y - 4);
      ctx.moveTo(x + w + 4 - bLen, y - 4); ctx.lineTo(x + w + 4, y - 4); ctx.lineTo(x + w + 4, y - 4 + bLen);
      ctx.moveTo(x - 4, y + h + 4 - bLen); ctx.lineTo(x - 4, y + h + 4); ctx.lineTo(x - 4 + bLen, y + h + 4);
      ctx.moveTo(x + w + 4 - bLen, y + h + 4); ctx.lineTo(x + w + 4, y + h + 4); ctx.lineTo(x + w + 4, y + h + 4 - bLen);
      ctx.stroke();
    }
  }
}
