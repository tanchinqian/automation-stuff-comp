import { analyzeImage, imageDataFromCanvas, CLASS_LABELS, type ImageAnalysis } from '../vision/analyzeImage';
import { generateSyntheticImage, type SyntheticScene } from '../vision/syntheticGenerator';
import { qualityScore, type QualityBreakdown } from '../vision/qualityScore';
import { el, clear, button, stars } from './dom';

export interface VisionResult {
  analysis: ImageAnalysis;
  imageData: ImageData;
  canvas: HTMLCanvasElement;
  label: string;
  quality: QualityBreakdown;
  imageUrl: string;
}

const SCENES: SyntheticScene[] = ['perfect', 'undersized', 'oversized', 'missing', 'irregular', 'spread', 'mixed'];

const CLASS_COLORS: Record<string, string> = {
  perfect: '#2ee6a8',
  undersized: '#ffb64d',
  oversized: '#5aa9ff',
  missing: '#ff5f6d',
  irregular: '#a78bfa',
  spread: '#ffb64d',
};

/**
 * Builds the inspection panel (synthetic scene picker + photo upload +
 * CV canvas + quality cards). Fires `onAnalyze` whenever a frame is run
 * through the computer-vision pipeline.
 */
export function createInspectionPanel(opts: {
  onAnalyze?: (r: VisionResult) => void;
  onFeed?: (r: VisionResult) => void;
} = {}): {
  panel: HTMLElement;
  run: () => void;
  getResult: () => VisionResult | null;
} {
  const { onAnalyze = () => {}, onFeed = () => {} } = opts;
  const body = el('div', 'panel-body');
  let lastResult: VisionResult | null = null;
  let currentScene: SyntheticScene = 'mixed';
  let lastCanvas: HTMLCanvasElement | null = null;
  let lastImageData: ImageData | null = null;
  let lastLabel = '';

  // Scene picker
  body.appendChild(el('div', 'question-label', 'Synthetic demo scene'));
  const picker = el('div', 'scene-picker');
  const chips = new Map<SyntheticScene, HTMLButtonElement>();
  for (const s of SCENES) {
    const chip = el('button', 'scene-chip', s.toUpperCase()) as HTMLButtonElement;
    chip.type = 'button';
    if (s === currentScene) chip.classList.add('selected');
    chip.onclick = () => {
      currentScene = s;
      chips.forEach((c) => c.classList.remove('selected'));
      chip.classList.add('selected');
      gen();
    };
    picker.appendChild(chip);
    chips.set(s, chip);
  }
  body.appendChild(picker);

  // Canvas frame
  const frame = el('div', 'canvas-frame');
  const canvas = document.createElement('canvas');
  canvas.width = 300;
  canvas.height = 240;
  frame.appendChild(canvas);
  body.appendChild(frame);
  const legend = el('div', 'overlay-legend', '');
  body.appendChild(legend);

  // Buttons
  const row = el('div', 'freetext-row');
  const uploadLabel = el('label', 'btn', 'UPLOAD PHOTO') as HTMLLabelElement;
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.style.display = 'none';
  uploadLabel.style.cursor = 'pointer';
  uploadLabel.appendChild(fileInput);
  const analyzeBtn = button('ANALYZE FRAME', 'btn primary');
  const feedBtn = button('FEED TO DIAGNOSIS', 'btn');
  feedBtn.disabled = true;
  row.appendChild(uploadLabel);
  row.appendChild(analyzeBtn);
  row.appendChild(feedBtn);
  body.appendChild(row);

  // Quality cards container (filled after analyze)
  const qualityBox = el('div', '');
  body.appendChild(qualityBox);

  const gen = () => {
    const g = generateSyntheticImage(currentScene);
    canvas.width = g.canvas.width;
    canvas.height = g.canvas.height;
    canvas.getContext('2d')!.drawImage(g.canvas, 0, 0);
    lastCanvas = canvas;
    lastImageData = g.canvasToImageData();
    lastLabel = `Synthetic: ${currentScene.toUpperCase()}`;
    legend.textContent = `Scene: ${currentScene.toUpperCase()} · generated on-device · run ANALYZE FRAME`;
    clear(qualityBox);
    feedBtn.disabled = true;
  };

  const loadFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxW = 720;
        const scale = Math.min(1, maxW / img.width);
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        lastCanvas = canvas;
        lastImageData = imageDataFromCanvas(canvas);
        lastLabel = `Uploaded: ${file.name}`;
        legend.textContent = `Uploaded ${file.name} (${canvas.width}x${canvas.height}) · run ANALYZE FRAME`;
        clear(qualityBox);
        feedBtn.disabled = true;
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
      legend.textContent = '⚠ No frame to analyze - generate or upload one first.';
      return;
    }
    const analysis = analyzeImage(lastImageData);
    drawOverlay(canvas, analysis, lastImageData);
    const quality = qualityScore(analysis);
    const defect = analysis.defectDetected ? CLASS_LABELS[analysis.dominantClass] : 'no significant defect';
    legend.innerHTML = `Detected <b>${analysis.metrics.count}</b> dot(s) · <b style="color:var(--${analysis.dominantClass === 'spread' || analysis.dominantClass === 'undersized' ? 'amber' : analysis.dominantClass === 'missing' ? 'red' : 'accent'})">${CLASS_LABELS[analysis.dominantClass].toUpperCase()}</b> · missing: ${analysis.metrics.missingCount}`;

    // Quality cards
    clear(qualityBox);
    const qh = el('div', 'q-hero');
    qh.appendChild(el('div', 'score', `${quality.overall}`));
    qh.appendChild(el('div', 'score-label', `quality / 100 · ${defect}`));
    qualityBox.appendChild(qh);
    const grid = el('div', 'q-grid');
    const card = (label: string, val: number) => {
      const c = el('div', 'q-card');
      c.appendChild(el('div', 'qlabel', label));
      c.appendChild(el('div', 'stars', stars(val)));
      c.appendChild(el('div', 'qval', `${val} / 5`));
      grid.appendChild(c);
    };
    card('Shape', quality.shape);
    card('Size', quality.size);
    card('Position', quality.position);
    card('Defect risk', quality.defectRisk);
    qualityBox.appendChild(grid);

    lastResult = {
      analysis,
      imageData: lastImageData,
      canvas,
      label: `${lastLabel} · ${CLASS_LABELS[analysis.dominantClass]}`,
      quality,
      imageUrl: canvas.toDataURL(),
    };
    feedBtn.disabled = !analysis.defectDetected;
    onAnalyze?.(lastResult);
  };
  analyzeBtn.onclick = run;

  // Feed callback wired by caller
  feedBtn.onclick = () => {
    if (lastResult) onFeed(lastResult);
  };

  gen();

  const panelEl = el('section', 'panel');
  const head = el('div', 'panel-head');
  head.appendChild(el('span', 'tick'));
  head.appendChild(el('span', 'title', 'Image Inspection'));
  head.appendChild(el('span', 'hint', 'CV pipeline · Otsu → connected components'));
  panelEl.appendChild(head);
  panelEl.appendChild(body);

  return {
    panel: panelEl,
    run,
    getResult: () => lastResult,
  };
}

function drawOverlay(canvas: HTMLCanvasElement, analysis: ImageAnalysis, imageData: ImageData): void {
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(imageData, 0, 0);
  for (const d of analysis.dots) {
    ctx.beginPath();
    ctx.arc(d.cx, d.cy, 10, 0, Math.PI * 2);
    ctx.strokeStyle = CLASS_COLORS[d.class] + 'cc';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.fillStyle = CLASS_COLORS[d.class];
    ctx.font = 'bold 11px monospace';
    ctx.fillText(CLASS_LABELS[d.class].split(' ')[0].toUpperCase(), d.cx + 12, d.cy - 8);
  }
}