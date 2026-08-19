import { appState } from './state';
import { clear, el, panel, button, emptyState } from './dom';
import { generatePdf } from '../report/pdfReport';
import { getAllCases, computePriorStats } from '../db/caseDB';

export function renderReportTab(host: HTMLElement): void {
  clear(host);
  const layout = el('div', 'layout');
  host.appendChild(layout);

  const d = appState.lastDiagnosis;
  if (!d) {
    layout.appendChild(panel('Report Generator', 'no diagnosis yet', emptyState('No diagnosis available', 'Run a troubleshooting session or an image analysis first.')));
    return;
  }

const p = panel('Troubleshooting Report', 'generated entirely on-device');
  const body = p.querySelector('.panel-body')! as HTMLElement;

  const notes = el('textarea', 'notes-area') as HTMLTextAreaElement;
  notes.placeholder = 'Engineer notes (optional) - recorded into the report…';

  const fmt = (label: string, value: string) => {
    const row = el('div', 'bar-row');
    row.style.gridTemplateColumns = '200px 1fr';
    row.appendChild(el('div', 'name', label));
    row.appendChild(el('div', 'pct', value));
    body.appendChild(row);
  };

  body.appendChild(el('div', 'question-label', 'Report contents'));
  fmt('Problem', d.material ? `Dispensing defect reported with ${d.material}` : 'Dispensing defect reported');
  fmt('Identified defect', `${d.defect.defectName} (${(d.defect.defectConfidence * 100).toFixed(0)}%)`);
  fmt('Top possible cause', d.defect.causes[0]?.name ?? '-');
  fmt('Confidence', `${(d.defect.causes[0]?.score ?? 0) * 100}%`);
  if (d.qualityScore !== undefined) fmt('Quality score', `${d.qualityScore}/100`);
  fmt('Recommended checks', `${appState.lastActions?.length ?? 0} sequential steps`);

  body.appendChild(el('div', 'question-label', 'Engineer notes'));
  body.appendChild(notes);

  const row = el('div', 'freetext-row');
  const genBtn = button('GENERATE PDF', 'btn primary', () => {
    generatePdf({
      diagnosis: d,
      actions: appState.lastActions ?? [],
      quality: appState.lastImage?.quality,
      imageLabel: appState.lastImage?.label,
      engineerNotes: notes.value.trim() || undefined,
      engineLabel: appState.lastEngineLabel,
    });
  });
  const backBtn = button('BACK TO DIAGNOSIS', 'btn ghost', () => {
    document.getElementById('tab-troubleshoot')?.scrollIntoView();
  });
  row.appendChild(genBtn);
  row.appendChild(backBtn);
  body.appendChild(row);

  layout.appendChild(p);

  // Learning DB evidence shown alongside
  const statsPanel = panel('Learning Database Evidence', 'case-based reasoning');
  const sBody = statsPanel.querySelector('.panel-body')! as HTMLElement;
  renderLearningStats(sBody);
  layout.appendChild(statsPanel);
}

export async function renderLearningStats(body: HTMLElement): Promise<void> {
  clear(body);
  const cases = await getAllCases();
  if (!cases.length) {
    body.appendChild(emptyState('No stored cases yet', 'Cases accumulate as you use the tool.'));
    return;
  }
  const stats = computePriorStats(cases);
  const strip = el('div', 'stat-strip');
  const stat = (k: string, v: string, cls = '') => {
    const s = el('div', 'stat');
    s.appendChild(el('div', 'k', k));
    const val = el('div', 'v', v);
    if (cls) val.classList.add(cls);
    s.appendChild(val);
    strip.appendChild(s);
  };
  stat('Cases', `${cases.length}`);
  stat('Resolved', `${stats.reduce((a, b) => a + b.resolved, 0)}`, 'good');
  const top = stats[0];
  stat('Top cause', top ? top.causeId.replace(/-/g, ' ') : '-', 'warn');
  stat('Top success', top ? `${(top.successRate * 100).toFixed(0)}%` : '-', 'good');
  body.appendChild(strip);

  const label = el('div', 'question-label');
  label.textContent = 'Cause frequency across stored cases';
  body.appendChild(label);

  const max = Math.max(1, ...stats.map((s) => s.count));
  for (const s of stats.slice(0, 8)) {
    const row = el('div', 'bar-row');
    row.appendChild(el('div', 'name', s.causeId.replace(/-/g, ' ')));
    const track = el('div', 'bar-track');
    const fill = el('div', 'bar-fill');
    fill.style.width = `${(s.count / max) * 100}%`;
    track.appendChild(fill);
    row.appendChild(track);
    row.appendChild(el('div', 'pct', `${s.count}`));
    body.appendChild(row);
  }
}