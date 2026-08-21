import { analyzeBoard, BOARD_CLASS_LABELS, imageDataFromCanvas, type BoardAnalysis, type PadResult } from '../vision/analyzeImage';
import { generateSyntheticImage, type SyntheticScene } from '../vision/syntheticGenerator';
import { boardQualityScore, type QualityBreakdown } from '../vision/qualityScore';
import { createRegistry } from '../data';
import type { BoardImage, DatasetProvider } from '../data/types';
import { el, clear, button, stars } from './dom';

export interface VisionResult {
  label: string;
  imageUrl: string;
  board?: BoardAnalysis;
  quality?: QualityBreakdown;
}

export interface InspectionPanelHandle {
  panel: HTMLElement;
  getResult: () => VisionResult | null;
}

const SYNTHETIC_SCENES: SyntheticScene[] = ['perfect', 'undersized', 'oversized', 'missing', 'irregular', 'spread'];

const CLASS_COLORS: Record<string, string> = {
  good: '#2ee6a8',
  'less-paste': '#ffb64d',
  missing: '#ff5f6d',
  bridging: '#a78bfa',
  misalignment: '#5aa9ff',
};

/**
 * Workbench inspection panel, fed by the dataset registry. Swapping the
 * active dataset (see src/data/datasetConfig.ts) changes which boards the
 * gallery shows without touching this component or the CV pipeline.
 */
export function createInspectionPanel(opts: {
  onAnalyze?: (r: VisionResult) => void;
  onFeed?: (r: VisionResult) => void;
} = {}): InspectionPanelHandle {
  const { onAnalyze = () => {}, onFeed = () => {} } = opts;
  const body = el('div', 'panel-body');
  let lastResult: VisionResult | null = null;
  let lastCanvas: HTMLCanvasElement | null = null;
  let lastImageData: ImageData | null = null;
  let lastPadRois: { x: number; y: number; w: number; h: number }[] | undefined;
  let lastLabel = '';
  let lastBoard: BoardAnalysis | null = null;

  const registry = createRegistry();

  // ---- Source tabs: dataset gallery + schematic demo ----
  const sourceTabs = el('div', 'nav-tabs');
  sourceTabs.style.marginBottom = '12px';
  const boardTab = el('button', 'nav-tab active', 'REAL BOARDS') as HTMLButtonElement;
  const synthTab = el('button', 'nav-tab', 'SCHEMATIC') as HTMLButtonElement;
  boardTab.type = 'button';
  synthTab.type = 'button';
  boardTab.setAttribute('aria-selected', 'true');
  synthTab.setAttribute('aria-selected', 'false');
  sourceTabs.appendChild(boardTab);
  sourceTabs.appendChild(synthTab);
  body.appendChild(sourceTabs);

  const galleryWrap = el('div', '');
  const synthWrap = el('div', 'hidden', '');
  body.appendChild(galleryWrap);
  body.appendChild(synthWrap);

  // ---- Board gallery ----
  const galleryLabel = el('div', 'question-label', 'Select a real inspection board');
  galleryWrap.appendChild(galleryLabel);
  const gallery = el('div', 'scene-picker');
  galleryWrap.appendChild(gallery);

  // ---- Schematic scene picker ----
  const synthLabel = el('div', 'question-label', 'Schematic dispensing demo (fallback)');
  synthWrap.appendChild(synthLabel);
  const synthPicker = el('div', 'scene-picker');
  synthWrap.appendChild(synthPicker);

  // ---- Canvas frame ----
  const frame = el('div', 'canvas-frame');
  const canvas = document.createElement('canvas');
  canvas.width = 300;
  canvas.height = 240;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Inspection image with computer-vision detection overlay');
  frame.appendChild(canvas);
  body.appendChild(frame);
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
  const feedBtn = button('FEED TO DIAGNOSIS', 'btn');
  feedBtn.disabled = true;
  row.appendChild(uploadLabel);
  row.appendChild(analyzeBtn);
  row.appendChild(feedBtn);
  body.appendChild(row);

  const qualityBox = el('div', '');
  body.appendChild(qualityBox);

  const clearBoard = () => {
    lastBoard = null;
    lastPadRois = undefined;
    clear(qualityBox);
    feedBtn.disabled = true;
  };

  const loadBoard = async (board: BoardImage) => {
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
      clearBoard();
      const gtLabel = board.class === 'unknown' ? 'unknown' : BOARD_CLASS_LABELS[board.class];
      legend.textContent = `${board.label} · ground truth: ${gtLabel} · run ANALYZE BOARD`;
    };
    img.src = board.src;
  };

  // Populate gallery from the active dataset provider
  const provider = registry.get('pcb-aoi') as DatasetProvider;
  provider.list().then((boards) => {
    for (const b of boards) {
      const chip = el('button', 'scene-chip', b.class === 'good' ? '✓ ' + b.class.replace(/-/g, ' ') : '⚠ ' + b.class.replace(/-/g, ' ')) as HTMLButtonElement;
      chip.type = 'button';
      chip.title = b.label;
      chip.onclick = () => {
        gallery.querySelectorAll('.scene-chip').forEach((c) => c.classList.remove('selected'));
        chip.classList.add('selected');
        loadBoard(b);
      };
      gallery.appendChild(chip);
    }
  });

  // Schematic picker (kept for Live fallback + manual demo)
  const genSchematic = (scene: SyntheticScene) => {
    const g = generateSyntheticImage(scene);
    canvas.width = g.canvas.width;
    canvas.height = g.canvas.height;
    canvas.getContext('2d')!.drawImage(g.canvas, 0, 0);
    lastCanvas = canvas;
    lastImageData = g.canvasToImageData();
    lastPadRois = undefined;
    lastLabel = `Schematic: ${scene.toUpperCase()}`;
    clearBoard();
    legend.textContent = `Schematic scene: ${scene.toUpperCase()} · generated on-device · run ANALYZE BOARD`;
  };
  for (const s of SYNTHETIC_SCENES) {
    const chip = el('button', 'scene-chip', s.toUpperCase()) as HTMLButtonElement;
    chip.type = 'button';
    chip.onclick = () => {
      synthPicker.querySelectorAll('.scene-chip').forEach((c) => c.classList.remove('selected'));
      chip.classList.add('selected');
      genSchematic(s);
    };
    synthPicker.appendChild(chip);
  }

  // Source tab switching
  boardTab.onclick = () => {
    boardTab.classList.add('active');
    synthTab.classList.remove('active');
    boardTab.setAttribute('aria-selected', 'true');
    synthTab.setAttribute('aria-selected', 'false');
    galleryWrap.classList.remove('hidden');
    synthWrap.classList.add('hidden');
  };
  synthTab.onclick = () => {
    synthTab.classList.add('active');
    boardTab.classList.remove('active');
    synthTab.setAttribute('aria-selected', 'true');
    boardTab.setAttribute('aria-selected', 'false');
    synthWrap.classList.remove('hidden');
    galleryWrap.classList.add('hidden');
  };

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
        clearBoard();
        legend.textContent = `Uploaded ${file.name} · run ANALYZE BOARD`;
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };
  fileInput.onchange = () => {
    const f = fileInput.files?.[0];
    if (f) loadFile(f);
  };

  const run = () => {
    if (!lastImageData) {
      legend.textContent = 'No frame to analyze - pick a board, generate a schematic, or upload a photo first.';
      return;
    }
    const board = analyzeBoard(lastImageData, lastPadRois);
    lastBoard = board;
    drawBoardOverlay(canvas, board);
    const quality = boardQualityScore(board);
    const dominant = BOARD_CLASS_LABELS[board.dominantDefect];
    legend.innerHTML = `Pads: <b>${board.pads.length}</b> · dominant: <b style="color:var(--${board.dominantDefect === 'missing' ? 'danger' : board.dominantDefect === 'good' ? 'accent' : 'warn'})">${dominant.toUpperCase()}</b> · defects: ${board.defectCounts['less-paste']} less / ${board.defectCounts.missing} missing / ${board.defectCounts.bridging} bridge / ${board.defectCounts.misalignment} align`;

    clear(qualityBox);
    const qh = el('div', 'q-hero');
    qh.appendChild(el('div', 'score', `${quality.overall}`));
    qh.appendChild(el('div', 'score-label', `board quality / 100 · ${dominant}`));
    qualityBox.appendChild(qh);
    const grid = el('div', 'q-grid');
    const card = (label: string, val: number) => {
      const c = el('div', 'q-card');
      c.appendChild(el('div', 'qlabel', label));
      c.appendChild(el('div', 'stars', stars(val)));
      c.appendChild(el('div', 'qval', `${val} / 5`));
      grid.appendChild(c);
    };
    card('Shape / fill', quality.shape);
    card('Volume', quality.size);
    card('Position', quality.position);
    card('Defect risk', quality.defectRisk);
    qualityBox.appendChild(grid);

    lastResult = {
      label: lastLabel,
      imageUrl: canvas.toDataURL(),
      board,
      quality,
    };
    feedBtn.disabled = !board.defectDetected;
    onAnalyze?.(lastResult);
  };
  analyzeBtn.onclick = run;

  feedBtn.onclick = () => {
    if (lastResult) onFeed(lastResult);
  };

  const panelEl = el('section', 'panel');
  const head = el('div', 'panel-head');
  head.appendChild(el('span', 'tick'));
  head.appendChild(el('span', 'title', 'Image Inspection'));
  head.appendChild(el('span', 'hint', 'real board · classical per-pad CV'));
  panelEl.appendChild(head);
  panelEl.appendChild(body);

  return {
    panel: panelEl,
    getResult: () => lastResult,
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
    ctx.fillText(pad.class.replace(/-/g, ' ').toUpperCase(), x + 2, y - 4);
  }
}
