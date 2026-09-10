import { appState } from './state';
import { clear, el, panel, button, emptyState } from './dom';
import { generatePdf } from '../report/pdfReport';
import { getAllCases, computePriorStats } from '../db/caseDB';
import { switchTab } from './troubleshoot';

export function renderReportTab(host: HTMLElement): void {
  clear(host);
  const layout = el('div', 'layout');
  host.appendChild(layout);

  const d = appState.lastDiagnosis;
  if (!d) {
    layout.appendChild(panel('Report Generator', 'no diagnosis yet', emptyState('No diagnosis available', 'Run a troubleshooting session or an image analysis first.')));
    return;
  }

  const p = panel('8D Dispensing Defect Report', 'generated entirely on-device');
  const body = p.querySelector('.panel-body')! as HTMLElement;

  // ── Report ID (read-only) ──────────────────────────────────────────────────
  body.appendChild(el('div', 'question-label', 'Report ID'));
  const idNote = el('div', 'nlu-note');
  idNote.style.fontVariantNumeric = 'tabular-nums';
  idNote.textContent = appState.reportId;
  body.appendChild(idNote);

  // ── D1 Individual ──────────────────────────────────────────────────────────
  body.appendChild(el('div', 'question-label', 'D1 - Individual'));

  const nameInput = el('input', 'freetext-input') as HTMLInputElement;
  nameInput.placeholder = 'Employee name';
  nameInput.setAttribute('aria-label', 'Employee name');
  nameInput.setAttribute('autocomplete', 'name');
  nameInput.value = appState.employeeName ?? '';
  nameInput.addEventListener('input', () => { appState.employeeName = nameInput.value.trim() || undefined; });
  body.appendChild(nameInput);

  const idInput = el('input', 'freetext-input') as HTMLInputElement;
  idInput.placeholder = 'Employee ID';
  idInput.setAttribute('aria-label', 'Employee ID');
  idInput.setAttribute('autocomplete', 'off');
  idInput.style.marginTop = '6px';
  idInput.value = appState.employeeId ?? '';
  idInput.addEventListener('input', () => { appState.employeeId = idInput.value.trim() || undefined; });
  body.appendChild(idInput);

  // ── D2: Machine / Line + Affected Count ──────────────────────────────────
  body.appendChild(el('div', 'question-label', 'D2 - Problem Description'));

  const machineInput = el('input', 'freetext-input') as HTMLInputElement;
  machineInput.placeholder = 'Machine / Line ID (e.g. Dispenser A3)';
  machineInput.setAttribute('aria-label', 'Machine or line identifier');
  machineInput.setAttribute('autocomplete', 'off');
  machineInput.value = appState.machineId ?? '';
  machineInput.addEventListener('input', () => { appState.machineId = machineInput.value.trim() || undefined; });
  body.appendChild(machineInput);

  const countInput = el('input', 'freetext-input') as HTMLInputElement;
  countInput.placeholder = 'Affected unit count (e.g. 12 of 100 boards)';
  countInput.setAttribute('aria-label', 'Number of affected units');
  countInput.setAttribute('autocomplete', 'off');
  countInput.style.marginTop = '6px';
  countInput.value = appState.affectedCount ?? '';
  countInput.addEventListener('input', () => { appState.affectedCount = countInput.value.trim() || undefined; });
  body.appendChild(countInput);

  // Inspection image note
  if (appState.lastImage) {
    const imgNote = el('div', 'nlu-note');
    imgNote.style.marginTop = '6px';
    imgNote.innerHTML = `<b style="color:var(--accent)">+ Inspection image attached</b> - will appear in D2 Problem Description section of the PDF.`;
    body.appendChild(imgNote);
  }

  // ── Verification toggle chips ─────────────────────────────────────────────
  body.appendChild(el('div', 'question-label', 'Digital Verification'));

  const makeVerifyRow = (
    label: string,
    getter: () => boolean,
    setter: (v: boolean) => void,
  ): HTMLElement => {
    const row = el('div', 'freetext-row');
    row.style.alignItems = 'center';
    row.style.gap = '8px';
    const lbl = el('div', 'name');
    lbl.style.flex = '1';
    lbl.style.fontSize = '14px';
    lbl.textContent = label;
    row.appendChild(lbl);

    const yesBtn = button('YES', getter() ? 'btn sm' : 'btn sm ghost', () => {
      setter(true);
      yesBtn.className = 'btn sm';
      noBtn.className = 'btn sm ghost';
    });
    const noBtn = button('NO', getter() ? 'btn sm ghost' : 'btn sm', () => {
      setter(false);
      yesBtn.className = 'btn sm ghost';
      noBtn.className = 'btn sm';
    });
    row.appendChild(yesBtn);
    row.appendChild(noBtn);
    return row;
  };

  body.appendChild(makeVerifyRow(
    'D3 - Containment action taken?',
    () => appState.containmentVerified,
    (v) => { appState.containmentVerified = v; },
  ));
  body.appendChild(makeVerifyRow(
    'D4 - Root cause confirmed?',
    () => appState.rootCauseVerified,
    (v) => { appState.rootCauseVerified = v; },
  ));
  body.appendChild(makeVerifyRow(
    'D5/D6 - Corrective action applied?',
    () => appState.correctiveActionVerified,
    (v) => { appState.correctiveActionVerified = v; },
  ));

  // ── D7: Process note ──────────────────────────────────────────────────────
  body.appendChild(el('div', 'question-label', 'D7 - Process Note / Lessons Learned'));
  const notes = el('textarea', 'notes-area') as HTMLTextAreaElement;
  notes.placeholder = 'Describe any SOP changes, parameter adjustments, or preventive actions taken…';
  notes.setAttribute('aria-label', 'Process note and lessons learned');
  body.appendChild(notes);

  // ── D8 Sign-off ────────────────────────────────────────────────────────────
  body.appendChild(el('div', 'question-label', 'D8 - Close Report'));

  const signoffRow = el('div', 'freetext-row');
  signoffRow.style.gap = '8px';

  const operatorInput = el('input', 'freetext-input') as HTMLInputElement;
  operatorInput.placeholder = 'Operator name for sign-off';
  operatorInput.setAttribute('aria-label', 'Sign-off operator name');
  operatorInput.setAttribute('autocomplete', 'name');
  operatorInput.value = appState.closedBy ?? '';
  operatorInput.addEventListener('input', () => { appState.closedBy = operatorInput.value.trim() || undefined; });

  const signBtn = button('SIGN OFF', 'btn sm ghost', () => {
    const name = operatorInput.value.trim();
    if (!name) { operatorInput.focus(); return; }
    appState.closedBy = name;
    appState.closedDate = new Date().toISOString();
    signBtn.textContent = 'SIGNED ✓';
    signBtn.disabled = true;
    signBtn.className = 'btn sm';
  });

  signoffRow.appendChild(operatorInput);
  signoffRow.appendChild(signBtn);
  body.appendChild(signoffRow);

  // ── Report summary preview ────────────────────────────────────────────────
  body.appendChild(el('div', 'question-label', 'Report summary'));
  const fmt = (label: string, value: string) => {
    const row = el('div', 'bar-row');
    row.style.gridTemplateColumns = '200px 1fr';
    row.appendChild(el('div', 'name', label));
    row.appendChild(el('div', 'pct', value));
    body.appendChild(row);
  };
  fmt('Defect',       `${d.defect.defectName} (${(d.defect.defectConfidence * 100).toFixed(0)}%)`);
  fmt('Top cause',    d.defect.causes[0]?.name ?? '-');
  fmt('Cause score',  `${((d.defect.causes[0]?.score ?? 0) * 100).toFixed(0)}%`);
  if (d.qualityScore !== undefined) fmt('Quality score', `${d.qualityScore}/100`);
  fmt('Action steps', `${appState.lastActions?.length ?? 0} sequential steps`);

  // ── Action buttons ─────────────────────────────────────────────────────────
  const row = el('div', 'freetext-row');
  const genBtn = button('GENERATE PDF', 'btn primary', () => {
    generatePdf({
      diagnosis:                d,
      actions:                  appState.lastActions ?? [],
      quality:                  appState.lastImage?.quality,
      imageLabel:               appState.lastImage?.label,
      imageUrl:                 appState.lastImage?.imageUrl,
      engineLabel:              appState.lastEngineLabel,
      reportId:                 appState.reportId,
      employeeName:             appState.employeeName,
      employeeId:               appState.employeeId,
      machineId:                appState.machineId,
      affectedCount:            appState.affectedCount,
      containmentVerified:      appState.containmentVerified,
      rootCauseVerified:        appState.rootCauseVerified,
      correctiveActionVerified: appState.correctiveActionVerified,
      engineerNotes:            notes.value.trim() || undefined,
      closedBy:                 appState.closedBy,
      closedDate:               appState.closedDate,
    });
  });
  const backBtn = button('BACK TO DIAGNOSIS', 'btn ghost', () => {
    switchTab('troubleshoot');
  });
  row.appendChild(genBtn);
  row.appendChild(backBtn);
  body.appendChild(row);

  layout.appendChild(p);

  // ── Learning DB stats (unchanged) ─────────────────────────────────────────
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
  stat('Cases',       `${cases.length}`);
  stat('Resolved',    `${stats.reduce((a, b) => a + b.resolved, 0)}`, 'good');
  const top = stats[0];
  stat('Top cause',   top ? top.causeId.replace(/-/g, ' ') : '-', 'warn');
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
