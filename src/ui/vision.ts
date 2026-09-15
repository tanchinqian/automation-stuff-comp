import { analyzeBoard, analyzeBoardFromDetections, BOARD_CLASS_LABELS, detectionCounts, imageDataFromCanvas, type BoardAnalysis, type BoardDefectClass, type PadResult } from '../vision/analyzeImage';
import { yoloAvailable, detectBoard } from '../vision/yoloDetector';
import { boardQualityScore, type QualityBreakdown } from '../vision/qualityScore';
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
  good: '#2ee6a8',
  'less-paste': '#ff5f6d',
  missing: '#ff5f6d',
  bridging: '#ff5f6d',
  misalignment: '#ffb64d',
};

/**
 * Map a defect proportion (0-1, higher = worse) to a whole-star 0-5 score so
 * severity matters: 1 bad leg out of 40 must not score the same as 10 out of 40.
 */
function severityStars(ratio: number): number {
  if (ratio <= 0) return 5;
  if (ratio <= 0.05) return 4;
  if (ratio <= 0.15) return 3;
  if (ratio <= 0.3) return 2;
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
    'position:absolute;pointer-events:none;padding:4px 6px;font:11px/1.4 var(--mono);' +
    'background:var(--bg-2);border:1px solid var(--line);border-radius:var(--r-3);' +
    'color:var(--ink);display:none;white-space:nowrap;z-index:5;';
  frame.style.position = 'relative';
  frame.appendChild(tooltip);
  canvas.addEventListener('mousemove', (e) => {
    if (!lastLegs.length) {
      tooltip.style.display = 'none';
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const ix = (e.clientX - rect.left) / lastScale;
    const iy = (e.clientY - rect.top) / lastScale;
    const hit = lastLegs.find((l) => {
      const [x1, y1, x2, y2] = l.bbox;
      return ix >= x1 && ix <= x2 && iy >= y1 && iy <= y2;
    });
    if (hit) {
      tooltip.textContent = `#${hit.leg_id} ${hit.label} ${hit.confidence.toFixed(0)}%${hit.flag ? ' ⚠' : ''}`;
      tooltip.style.display = 'block';
      tooltip.style.left = `${e.clientX - rect.left + 10}px`;
      tooltip.style.top = `${e.clientY - rect.top + 10}px`;
    } else {
      tooltip.style.display = 'none';
    }
  });
  canvas.addEventListener('mouseleave', () => {
    tooltip.style.display = 'none';
  });

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
    clear(qualityBox);
  };

  const loadBoard = (board: BoardImage) => new Promise<void>((resolve) => {
    const img = new Image();
    img.onload = () => {
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
    if (lastAnalysis) {
      drawLegOverlay(canvas, lastLegs, lastScale);
    } else {
      drawBoardOverlay(canvas, board);
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
      lastEngine === 'api' ? 'YOLOv8s + classifier' : lastEngine === 'yolo' ? 'YOLOv8s' : 'classical';
    engineChip.textContent = `engine: ${engineText}`;
    engineChip.classList.toggle('stub', lastEngine === 'classical');
    const engineTag =
      lastEngine === 'api'
        ? '<b style="color:var(--accent)">YOLOv8s + MobileNetV2</b>'
        : lastEngine === 'yolo'
          ? '<b style="color:var(--accent)">YOLOv8s</b>'
          : '<b style="color:var(--warn)">classical</b>';

    // ground-truth comparison tag (real boards only)
    let gtTag = '';
    if (lastGroundTruth && currentSource === 'board') {
      const gt = BOARD_CLASS_LABELS[lastGroundTruth as BoardDefectClass] ?? lastGroundTruth;
      const match = lastGroundTruth === board.dominantDefect;
      gtTag = ` - GT: <b>${gt}</b> <span style="color:var(--${match ? 'accent' : 'warn'})">${match ? '✓' : '✗'}</span>`;
    }

    clear(qualityBox);
    const qh = el('div', 'q-hero');
    qh.appendChild(el('div', 'score', `${quality.overall}`));
    qh.appendChild(el('div', 'score-label', `board quality / 100 - ${dominant}`));
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
      qShape = severityStars(bridgingRatio);
      qSize = severityStars(lessPasteRatio);
      qPosition = severityStars(flaggedRatio);
      // defect risk blends the other three; bridging and flagged legs weigh
      // higher because they are more urgent than a paste-volume shortfall
      qRisk = severityStars(bridgingRatio * 0.4 + flaggedRatio * 0.4 + lessPasteRatio * 0.2);
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
      c.appendChild(el('div', 'stars', stars(val)));
      c.appendChild(el('div', 'qval', `${val} / 5`));
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
  head.appendChild(el('span', 'tick'));
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

function drawBoardOverlay(canvas: HTMLCanvasElement, board: BoardAnalysis): void {
  const ctx = canvas.getContext('2d')!;
  ctx.lineWidth = 2;
  for (const pad of board.pads) {
    const { x, y, w, h } = pad.rect;
    ctx.strokeStyle = CLASS_COLORS[pad.class] + 'cc';
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = CLASS_COLORS[pad.class];
    ctx.font = 'bold 10px monospace';
    const conf = pad.fillRatio > 0 && pad.fillRatio <= 1 ? ` ${(pad.fillRatio * 100).toFixed(0)}%` : '';
    ctx.fillText(pad.class.replace(/-/g, ' ').toUpperCase() + conf, x + 2, y - 4);
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
function drawLegOverlay(canvas: HTMLCanvasElement, legs: LegResult[], scale: number): void {
  const ctx = canvas.getContext('2d')!;
  ctx.lineWidth = 2;
  ctx.font = 'bold 10px monospace';
  for (const leg of legs) {
    const [x1, y1, x2, y2] = leg.bbox;
    const x = x1 * scale;
    const y = y1 * scale;
    const w = (x2 - x1) * scale;
    const h = (y2 - y1) * scale;
    const color = leg.label === 'Good' ? CLASS_COLORS.good : CLASS_COLORS['less-paste'];
    ctx.strokeStyle = color + 'cc';
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.fillText(`${leg.label} ${leg.confidence.toFixed(0)}%`, x + 2, y - 4);
  }
}
