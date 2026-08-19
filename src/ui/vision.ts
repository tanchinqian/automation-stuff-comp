import { analyzeImage, imageDataFromCanvas, CLASS_LABELS, type ImageAnalysis, type DotResult } from '../vision/analyzeImage';
import { generateSyntheticImage, type SyntheticScene } from '../vision/syntheticGenerator';
import { qualityScore } from '../vision/qualityScore';
import { appState, addSymptoms } from './state';
import { el, elHTML, clear, panel, button, emptyState, stars } from './dom';
import { classToSymptoms } from '../vision/qualityScore';
import type { SymptomId } from '../engine/types';
import { runDiagnosis } from '../engine/scorer';
import { buildActionPlan } from '../engine/actions';
import { getAllCases, priorOverrides } from '../db/caseDB';
import { renderDiagnosis, switchTab } from './troubleshoot';

const SCENES: SyntheticScene[] = ['perfect', 'undersized', 'oversized', 'missing', 'irregular', 'spread', 'mixed'];

const CLASS_COLORS: Record<string, string> = {
  perfect: '#2ee6a8',
  undersized: '#ffb64d',
  oversized: '#5aa9ff',
  missing: '#ff5f6d',
  irregular: '#a78bfa',
  spread: '#ffb64d',
};

let lastCanvas: HTMLCanvasElement | null = null;
let lastImageData: ImageData | null = null;
let currentScene: SyntheticScene = 'mixed';
let lastAnalysis: ImageAnalysis | null = null;

export function renderVision(host: HTMLElement): void {
  clear(host);
  const layout = el('div', 'layout cols');
  host.appendChild(layout);

  const left = panel('Inspection', 'synthetic generator + photo upload');
  const right = panel('CV Analysis', 'classical computer vision pipeline');

  const lBody = left.querySelector('.panel-body')! as HTMLElement;
  const rBody = right.querySelector('.panel-body')! as HTMLElement;

  // Scene picker
  const sceneLabel = el('div', 'question-label', 'Synthetic demo scene');
  lBody.appendChild(sceneLabel);
  const picker = el('div', 'scene-picker');
  for (const s of SCENES) {
    const chip = el('button', 'scene-chip', s.toUpperCase()) as HTMLButtonElement;
    chip.type = 'button';
    if (s === currentScene) chip.classList.add('selected');
    chip.onclick = () => {
      currentScene = s;
      picker.querySelectorAll('.scene-chip').forEach((c) => c.classList.remove('selected'));
      chip.classList.add('selected');
      gen();
    };
    picker.appendChild(chip);
  }
  lBody.appendChild(picker);

  // Canvas frame
  const frame = el('div', 'canvas-frame');
  const canvas = document.createElement('canvas');
  canvas.width = 300;
  canvas.height = 240;
  frame.appendChild(canvas);
  lBody.appendChild(frame);

  const legend = el('div', 'overlay-legend', '');
  lBody.appendChild(legend);

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
  lBody.appendChild(row);

  layout.appendChild(left);
  layout.appendChild(right);

  const gen = () => {
    const g = generateSyntheticImage(currentScene);
    canvas.width = g.canvas.width;
    canvas.height = g.canvas.height;
    canvas.getContext('2d')!.drawImage(g.canvas, 0, 0);
    lastCanvas = canvas;
    lastImageData = g.canvasToImageData();
    lastAnalysis = null;
    legend.textContent = `Scene: ${currentScene.toUpperCase()} · generated on-device · analyze to run the CV pipeline`;
    renderAnalysisPlaceholder(rBody);
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
        lastAnalysis = null;
        legend.textContent = `Uploaded: ${file.name} (${canvas.width}×${canvas.height})`;
        renderAnalysisPlaceholder(rBody);
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };
  fileInput.onchange = () => {
    const f = fileInput.files?.[0];
    if (f) loadFile(f);
  };

  const runAnalysis = () => {
    if (!lastImageData) {
      legend.textContent = '⚠ No frame to analyze — generate or upload one first.';
      return;
    }
    const analysis = analyzeImage(lastImageData);
    lastAnalysis = analysis;
    drawOverlay(canvas, analysis, lastImageData);
    legend.innerHTML = `Detected <b>${analysis.metrics.count}</b> dot(s) · dominant: <b style="color:var(--${analysis.dominantClass === 'spread' || analysis.dominantClass === 'undersized' ? 'amber' : analysis.dominantClass === 'missing' ? 'red' : 'accent'})">${CLASS_LABELS[analysis.dominantClass].toUpperCase()}</b> · missing inferred: ${analysis.metrics.missingCount}`;
    renderAnalysis(rBody, analysis);
    feedBtn.disabled = false;
  };
  analyzeBtn.onclick = runAnalysis;

  feedBtn.onclick = async () => {
    if (!lastAnalysis) return;
    const syms = classToSymptoms(lastAnalysis.dominantClass) as SymptomId[];
    const q = qualityScore(lastAnalysis);
    addSymptoms(syms);
    appState.lastImage = {
      label: `${CLASS_LABELS[lastAnalysis.dominantClass]} (${currentScene.toUpperCase()})`,
      analysis: lastAnalysis,
      quality: q,
      imageUrl: lastCanvas?.toDataURL() ?? '',
    };
    const cases = await getAllCases();
    const priors = priorOverrides(cases);
    const report = runDiagnosis([...appState.symptoms], appState.material ?? '', priors);
    appState.lastDiagnosis = report;
    appState.lastActions = buildActionPlan(report.defect.causes.map((c) => c.causeId));
    const target = document.getElementById('tab-troubleshoot');
    renderDiagnosis(target?.querySelector('.panel-body') as HTMLElement, report, appState.lastActions);
    switchTab('troubleshoot');
  };

  gen();
}

function renderAnalysisPlaceholder(body: HTMLElement): void {
  clear(body);
  const e = emptyState('Frame ready', 'Run ANALYZE FRAME to execute the computer-vision pipeline (Otsu threshold → connected components → defect classification).');
  body.appendChild(e);
}

function drawOverlay(canvas: HTMLCanvasElement, analysis: ImageAnalysis, imageData: ImageData): void {
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(imageData, 0, 0);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 2;
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

function renderAnalysis(body: HTMLElement, a: ImageAnalysis): void {
  clear(body);
  const q = qualityScore(a);

  const hero = el('div', 'diag-hero');
  hero.appendChild(el('div', 'kicker', 'Dominant detection'));
  hero.appendChild(el('h2', '', CLASS_LABELS[a.dominantClass]));
  hero.appendChild(
    el('p', '', a.defectDetected ? 'Defects detected in this frame — feeding these findings into the diagnosis will flag the relevant symptoms.' : 'No significant defects detected in this frame.'),
  );
  body.appendChild(hero);

  const qh = el('div', 'q-hero');
  qh.appendChild(el('div', 'score', `${q.overall}`));
  qh.appendChild(el('div', 'score-label', 'quality / 100'));
  body.appendChild(qh);

  const grid = el('div', 'q-grid');
  const card = (label: string, val: number) => {
    const c = el('div', 'q-card');
    c.appendChild(el('div', 'qlabel', label));
    c.appendChild(el('div', 'stars', stars(val)));
    c.appendChild(el('div', 'qval', `${val} / 5`));
    grid.appendChild(c);
  };
  card('Shape', q.shape);
  card('Size', q.size);
  card('Position', q.position);
  card('Defect risk', q.defectRisk);
  body.appendChild(grid);

  const m = el('div', 'metric-grid');
  const metric = (k: string, v: string) => {
    const x = el('div', 'metric');
    x.appendChild(el('div', 'k', k));
    x.appendChild(el('div', 'v', v));
    m.appendChild(x);
  };
  metric('Dots detected', `${a.metrics.count}`);
  metric('Missing (inferred)', `${a.metrics.missingCount}`);
  metric('Mean area (px²)', `${a.metrics.meanArea.toFixed(0)}`);
  metric('Size variance (CV)', `${(a.metrics.areaCv * 100).toFixed(1)}%`);
  metric('Circularity', a.metrics.meanCircularity.toFixed(3));
  metric('Eccentricity', a.metrics.meanEccentricity.toFixed(3));
  body.appendChild(m);

  const perDot = el('div', 'question-label');
  perDot.style.marginTop = '14px';
  perDot.textContent = 'Per-dot classification';
  body.appendChild(perDot);

  for (const d of a.dots) {
    const row = el('div', 'bar-row');
    row.style.gridTemplateColumns = '120px 1fr 1fr';
    row.appendChild(el('div', 'name', `${CLASS_LABELS[d.class]}`));
    row.appendChild(el('div', 'pct', `Δ${(d.deviation * 100).toFixed(0)}%`));
    row.appendChild(el('div', 'pct', `circ ${d.circularity.toFixed(2)}`));
    body.appendChild(row);
  }
}