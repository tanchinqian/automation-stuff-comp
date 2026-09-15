import { appState } from './state';
import { clear, el, panel, button } from './dom';
import { buildReportPdf, type ReportData } from '../report/pdfReport';
import { closeReportDrawer } from './reportDrawer';
import { loadAllCases, caseToReportData } from './database';
import { getSimilarCases } from '../api/pipeline';
import type { ScoredCause } from '../engine/scorer';

// ---------------------------------------------------------------------------
// Local state (kept out of appState so it never pollutes the live session)
// ---------------------------------------------------------------------------
interface ReportFormData {
  employeeName: string;
  employeeId: string;
  machineId: string;
  affectedCount: string;
  d3Status: string;
  d3Action: string;
  d3CompletedBy: string;
  d3CompletedAt: string;
  d4Status: string;
  d4Method: string;
  d5Status: string;
  d5TargetDate: string;
  d5Responsible: string;
  d6Action: string;
  d6Status: string;
  d6Verified: string;
  d7Notes: string;
  confirmedCause: string;
  closedBy: string;
  closedDate: string;
}

type CaseRow = Awaited<ReturnType<typeof loadAllCases>>[number];

const REQUIRED_FIELDS: (keyof ReportFormData)[] = [
  'employeeName', 'machineId', 'd3Status', 'd4Status', 'd7Notes', 'closedBy',
];

const LS_KEYS: Partial<Record<keyof ReportFormData, string>> = {
  employeeName: 'report_employee_name',
  employeeId: 'report_employee_id',
  machineId: 'report_machine_id',
};

const D3_OPTIONS = ['Completed', 'In Progress', 'Not Required'];
const D4_OPTIONS = ['Confirmed', 'Under Investigation', 'Disputed'];
const D5_OPTIONS = ['Scheduled', 'In Progress', 'Completed'];
const D6_STATUS_OPTIONS = ['Implemented', 'Pending', 'Not Required'];
const D6_VERIFIED_OPTIONS = ['Yes', 'No', 'Pending'];

const humanize = (s: string): string => s.replace(/-/g, ' ');
const fmtDate = (ms: number): string =>
  new Date(ms).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
const nowLocalDatetime = (): string => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function lsGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function lsSet(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Tab renderer
// ---------------------------------------------------------------------------
export function renderReportTab(host: HTMLElement): void {
  clear(host);
  const layout = el('div', 'layout');
  host.appendChild(layout);

  const p = panel('8D Dispensing Defect Report');
  const body = p.querySelector('.panel-body')! as HTMLElement;
  layout.appendChild(p);

  // Local state --------------------------------------------------------
  let allCases: CaseRow[] = [];
  let selectedCase: CaseRow | null = null;
  let useCurrent = !!appState.lastDiagnosis;
  let form: ReportFormData = blankForm();

  // Source header
  const sourceBox = el('div', 'report-source');
  body.appendChild(sourceBox);

  // Similar-cases one-line summary (Change 3)
  const similarLine = el('div', 'case-count');
  body.appendChild(similarLine);
  similarLine.textContent = 'Loading historical summary...';

  // Completeness indicator (Change 5)
  const progressWrap = el('div', 'report-progress');
  const progressLabel = el('span', 'report-progress-label', 'Report completeness: 0%');
  const progressTrack = el('div', 'report-progress-track');
  const progressFill = el('div', 'report-progress-fill');
  progressTrack.appendChild(progressFill);
  progressWrap.appendChild(progressLabel);
  progressWrap.appendChild(progressTrack);
  body.appendChild(progressWrap);

  // Form fields container (rebuilt when the source changes)
  const formHost = el('div', 'report-form');
  body.appendChild(formHost);

  // Actions
  const row = el('div', 'freetext-row');
  const fillBtn = button('Fill sample', 'btn ghost', fillSampleReport);
  const downloadBtn = button('Download Report', 'btn primary');
  const backBtn = button('Close', 'btn ghost', () => closeReportDrawer());
  row.appendChild(downloadBtn);
  row.appendChild(backBtn);
  body.appendChild(row);

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------
  function blankForm(): ReportFormData {
    return {
      employeeName: appState.employeeName ?? lsGet(LS_KEYS.employeeName!) ?? '',
      employeeId: appState.employeeId ?? lsGet(LS_KEYS.employeeId!) ?? '',
      machineId: appState.machineId ?? lsGet(LS_KEYS.machineId!) ?? '',
      affectedCount: appState.affectedCount ?? '',
      d3Status: '', d3Action: '', d3CompletedBy: '', d3CompletedAt: '',
      d4Status: '', d4Method: '',
      d5Status: '', d5TargetDate: '', d5Responsible: '',
      d6Action: '', d6Status: '', d6Verified: '',
      d7Notes: '',
      confirmedCause: '',
      closedBy: appState.closedBy ?? '',
      closedDate: appState.closedDate ?? '',
    };
  }

  const sourceBase = (): ReportData | null => {
    if (useCurrent) {
      if (!appState.lastDiagnosis) return null;
      return {
        diagnosis: appState.lastDiagnosis,
        actions: appState.lastActions ?? [],
        quality: appState.lastImage?.quality,
        imageLabel: appState.lastImage?.label,
        imageUrl: appState.lastImage?.imageUrl,
        engineLabel: 'Gemini API (chat) + YOLOv8n + MobileNetV2 (vision)',
        reportId: appState.reportId,
        containmentVerified: false,
        rootCauseVerified: false,
        correctiveActionVerified: false,
        visionAnalysis: appState.lastImage?.analysis ?? undefined,
        similarCases: appState.lastSimilarCases ?? undefined,
        confirmedCause: appState.lastConfirmedCause ?? undefined,
      };
    }
    return selectedCase ? caseToReportData(selectedCase) : null;
  };

  const defectType = (): string | null => {
    if (useCurrent) {
      const ds = appState.lastImage?.analysis?.defect_summary;
      if (!ds) return null;
      if (ds['Less Paste'] > 0) return 'Less Paste';
      if (ds.Bridging > 0) return 'Bridging';
      return 'Good';
    }
    return selectedCase?.defectLabel ?? null;
  };

  const collect = (): ReportData | null => {
    const base = sourceBase();
    if (!base) return null;
    return {
      ...base,
      employeeName: form.employeeName || undefined,
      employeeId: form.employeeId || undefined,
      machineId: form.machineId || undefined,
      affectedCount: form.affectedCount || undefined,
      engineerNotes: form.d7Notes || undefined,
      confirmedCause: form.confirmedCause || base.confirmedCause,
      closedBy: form.closedBy || undefined,
      closedDate: form.closedDate || undefined,
      d3Status: form.d3Status || undefined,
      d3Action: form.d3Action || undefined,
      d3CompletedBy: form.d3CompletedBy || undefined,
      d3CompletedAt: form.d3CompletedAt || undefined,
      d4Status: form.d4Status || undefined,
      d4Method: form.d4Method || undefined,
      d5Status: form.d5Status || undefined,
      d5TargetDate: form.d5TargetDate || undefined,
      d5Responsible: form.d5Responsible || undefined,
      d6Action: form.d6Action || undefined,
      d6Status: form.d6Status || undefined,
      d6Verified: form.d6Verified || undefined,
      containmentVerified: form.d3Status === 'Completed',
      rootCauseVerified: form.d4Status === 'Confirmed',
      correctiveActionVerified: form.d6Status === 'Implemented',
    };
  };

  const updateProgress = () => {
    const filled = REQUIRED_FIELDS.filter((k) => String(form[k]).trim() !== '').length;
    const pct = Math.round((filled / REQUIRED_FIELDS.length) * 100);
    progressLabel.textContent = `Report completeness: ${pct}%`;
    progressFill.style.width = `${pct}%`;
  };

  const refreshActionsEnabled = () => {
    const ok = !!(sourceBase());
    downloadBtn.disabled = !ok;
  };

  // Pre-fill editable fields from a selected past case (Change 1)
  const applyCaseDefaults = () => {
    if (!useCurrent && selectedCase) {
      form.d7Notes = selectedCase.notes ?? '';
      form.confirmedCause = selectedCase.resolvedCause ? humanize(selectedCase.resolvedCause) : '';
    }
  };

  // ------------------------------------------------------------------
  // Field builders
  // ------------------------------------------------------------------
  const field = (
    label: string, key: keyof ReportFormData,
    opts: { placeholder?: string; type?: string; label2?: string } = {},
  ): HTMLElement => {
    const wrap = el('div', 'report-field');
    wrap.appendChild(el('div', 'question-label', label));
    const input = el('input', 'freetext-input') as HTMLInputElement;
    input.type = opts.type ?? 'text';
    if (opts.placeholder) input.placeholder = opts.placeholder;
    input.value = form[key];
    input.addEventListener('input', () => {
      form[key] = input.value;
      updateProgress();
    });
    const lsKey = LS_KEYS[key];
    if (lsKey) input.addEventListener('blur', () => lsSet(lsKey, input.value.trim()));
    wrap.appendChild(input);
    return wrap;
  };

  const textareaField = (label: string, key: keyof ReportFormData, placeholder: string): HTMLElement => {
    const wrap = el('div', 'report-field');
    wrap.appendChild(el('div', 'question-label', label));
    const area = el('textarea', 'notes-area') as HTMLTextAreaElement;
    area.placeholder = placeholder;
    area.value = form[key];
    area.addEventListener('input', () => {
      form[key] = area.value;
      updateProgress();
    });
    wrap.appendChild(area);
    return wrap;
  };

  const segmented = (label: string, key: keyof ReportFormData, options: string[]): HTMLElement => {
    const wrap = el('div', 'report-field');
    wrap.appendChild(el('div', 'question-label', label));
    const grp = el('div', 'seg');
    const btns: HTMLButtonElement[] = [];
    const select = (val: string) => {
      form[key] = val;
      btns.forEach((b) => b.classList.toggle('active', b.textContent === val));
      if (key === 'd3Status' && val === 'Completed' && !form.d3CompletedAt) {
        form.d3CompletedAt = nowLocalDatetime();
        const at = formHost.querySelector<HTMLInputElement>('input[data-key="d3CompletedAt"]');
        if (at) at.value = form.d3CompletedAt;
      }
      updateProgress();
    };
    for (const opt of options) {
      const b = button(opt, 'seg-btn', () => select(opt));
      if (form[key] === opt) b.classList.add('active');
      btns.push(b);
      grp.appendChild(b);
    }
    // allow external code to highlight the initial value
    wrap.appendChild(grp);
    return wrap;
  };

  const readOnly = (label: string, values: string[]): HTMLElement => {
    const wrap = el('div', 'report-field');
    wrap.appendChild(el('div', 'question-label', label));
    const list = el('div', 'ro-list');
    if (!values.length) list.appendChild(el('div', 'ro-empty', 'Not recorded'));
    values.forEach((v, i) => list.appendChild(el('div', 'ro-item', `${i + 1}. ${v}`)));
    wrap.appendChild(list);
    return wrap;
  };

  // ------------------------------------------------------------------
  // Form rendering (rebuilt on source change)
  // ------------------------------------------------------------------
  const buildForm = () => {
    clear(formHost);
    const base = sourceBase();

    if (!base) {
      formHost.appendChild(el('div', 'case-empty', 'No diagnosis available. Analyze a board first, or select a past case.'));
      refreshActionsEnabled();
      updateProgress();
      return;
    }

    const causes = base.diagnosis.defect.causes as ScoredCause[];
    const actions = base.actions;

    // D1
    formHost.appendChild(el('div', 'question-label', 'D1 - Individual'));
    formHost.appendChild(field('Employee name', 'employeeName', { placeholder: 'Employee name' }));
    formHost.appendChild(field('Employee ID', 'employeeId', { placeholder: 'Employee ID' }));

    // D2
    formHost.appendChild(el('div', 'question-label', 'D2 - Problem description'));
    formHost.appendChild(field('Machine / line', 'machineId', { placeholder: 'Machine / Line ID (e.g. Dispenser A3)' }));
    formHost.appendChild(field('Affected units', 'affectedCount', { placeholder: 'Affected unit count (e.g. 12 of 100 boards)' }));
    const summary = el('div', 'ro-list');
    summary.appendChild(el('div', 'ro-item', `Defect type: ${base.diagnosis.defect.defectName}`));
    if (base.visionAnalysis) {
      summary.appendChild(el('div', 'ro-item',
        `Board result: ${base.visionAnalysis.board_verdict} - ${base.visionAnalysis.defect_summary['Less Paste']} Less Paste - ${base.visionAnalysis.defect_summary.Bridging} Bridging - ${base.visionAnalysis.defect_summary.Good} Good`));
    }
    formHost.appendChild(summary);

    // D3
    formHost.appendChild(el('div', 'question-label', 'D3 - Immediate containment action'));
    formHost.appendChild(readOnly('Containment steps', actions.slice(0, 2).map((a) => a.title)));
    formHost.appendChild(segmented('Status', 'd3Status', D3_OPTIONS));
    formHost.appendChild(textareaField('Action taken', 'd3Action', 'Describe the immediate action taken to contain the issue...'));
    formHost.appendChild(field('Completed by', 'd3CompletedBy', { placeholder: 'Name' }));
    const atField = field('Completed at', 'd3CompletedAt', { type: 'datetime-local' });
    atField.querySelector('input')!.setAttribute('data-key', 'd3CompletedAt');
    formHost.appendChild(atField);

    // D4
    formHost.appendChild(el('div', 'question-label', 'D4 - Root cause verification'));
    formHost.appendChild(readOnly('Ranked causes', causes.slice(0, 5).map((c) => `${c.name} - ${Math.round(c.score * 100)}%`)));
    formHost.appendChild(segmented('Status', 'd4Status', D4_OPTIONS));
    formHost.appendChild(field('Verification method', 'd4Method', { placeholder: 'How was the root cause verified? e.g. test shots confirmed...' }));

    // D5
    formHost.appendChild(el('div', 'question-label', 'D5 - Planned corrective action'));
    formHost.appendChild(readOnly('Action plan', actions.slice(2).map((a) => a.title)));
    formHost.appendChild(segmented('Implementation status', 'd5Status', D5_OPTIONS));
    formHost.appendChild(field('Target date', 'd5TargetDate', { type: 'date' }));
    formHost.appendChild(field('Responsible person', 'd5Responsible', { placeholder: 'Name' }));

    // D6
    formHost.appendChild(el('div', 'question-label', 'D6 - Permanent corrective action'));
    formHost.appendChild(textareaField('Action description', 'd6Action', 'Describe the permanent fix implemented...'));
    formHost.appendChild(segmented('Status', 'd6Status', D6_STATUS_OPTIONS));
    formHost.appendChild(segmented('Verified effective', 'd6Verified', D6_VERIFIED_OPTIONS));

    // D7
    formHost.appendChild(el('div', 'question-label', 'D7 - Process note / lessons learned'));
    formHost.appendChild(textareaField('Notes', 'd7Notes', 'Describe any SOP changes, parameter adjustments, or preventive actions taken...'));

    // D8
    formHost.appendChild(el('div', 'question-label', 'D8 - Close report'));
    formHost.appendChild(field('Confirmed cause', 'confirmedCause', { placeholder: 'What actually fixed it?' }));
    formHost.appendChild(field('Operator name', 'closedBy', { placeholder: 'Operator name for sign-off' }));

    updateProgress();
    refreshActionsEnabled();
  };

  // ------------------------------------------------------------------
  // Source selector (Change 1)
  // ------------------------------------------------------------------
  const renderSourceBox = () => {
    clear(sourceBox);
    sourceBox.appendChild(el('div', 'question-label', 'Generate report for'));

    const mkRadio = (name: string, value: string, label: string, checked: boolean, disabled = false) => {
      const lab = el('label', 'report-radio');
      const input = el('input', '') as HTMLInputElement;
      input.type = 'radio';
      input.name = name;
      input.value = value;
      input.checked = checked;
      input.disabled = disabled;
      input.addEventListener('change', () => {
        useCurrent = value === 'current';
        if (!useCurrent && allCases.length) selectedCase = allCases[0];
        form = blankForm();
        applyCaseDefaults();
        renderSourceBox();
        buildForm();
        updateSimilar();
      });
      lab.appendChild(input);
      lab.appendChild(el('span', '', label));
      return lab;
    };

    sourceBox.appendChild(mkRadio('report-src', 'current', 'Current session', useCurrent, !appState.lastDiagnosis));

    const pastRow = el('div', 'report-radio-row');
    pastRow.appendChild(mkRadio('report-src', 'past', 'Select past case', !useCurrent));

    const select = el('select', 'case-filter') as HTMLSelectElement;
    select.disabled = useCurrent || !allCases.length;
    if (!allCases.length) {
      select.innerHTML = '<option value="">No past cases available</option>';
    } else {
      select.innerHTML = allCases.map((c, i) => {
        const cause = c.resolvedCause ? `✓ ${humanize(c.resolvedCause)}` : 'open';
        return `<option value="${i}">${fmtDate(c.timestamp)} - ${c.defectLabel ?? 'Unknown'} - ${cause}</option>`;
      }).join('');
      const idx = selectedCase ? allCases.indexOf(selectedCase) : 0;
      select.value = String(idx >= 0 ? idx : 0);
    }
    select.addEventListener('change', () => {
      const idx = Number(select.value);
      if (!Number.isNaN(idx) && allCases[idx]) {
        selectedCase = allCases[idx];
        form = blankForm();
        applyCaseDefaults();
        buildForm();
        updateSimilar();
      }
    });
    pastRow.appendChild(select);
    sourceBox.appendChild(pastRow);
  };

  // ------------------------------------------------------------------
  // Similar-cases summary line (Change 3)
  // ------------------------------------------------------------------
  const updateSimilar = async () => {
    const type = defectType();
    if (!type) {
      similarLine.textContent = 'No defect type available for a historical summary.';
      return;
    }
    similarLine.textContent = 'Loading historical summary...';
    try {
      const sc = await getSimilarCases(type);
      similarLine.textContent = sc.total_cases > 0
        ? `Based on ${sc.total_cases} historical cases. Most common confirmed cause: ${sc.most_common_cause ?? 'n/a'}.`
        : `No historical cases for ${type} yet.`;
    } catch {
      similarLine.textContent = 'Historical summary unavailable (server offline).';
    }
  };

  // ------------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------------
  downloadBtn.onclick = () => {
    const data = collect();
    if (!data) return;
    buildReportPdf(data).save(`${data.reportId}.pdf`);
  };

  // Dev/test aid: fill every report field with a realistic sample (Change: demo)
  function fillSampleReport() {
    const inAWeek = new Date(Date.now() + 7 * 86400000);
    Object.assign(form, {
      employeeName: form.employeeName || lsGet(LS_KEYS.employeeName!) || 'A. Engineer',
      employeeId: form.employeeId || lsGet(LS_KEYS.employeeId!) || 'E-2048',
      machineId: 'Dispenser A3',
      affectedCount: '12 of 100 boards',
      d3Status: 'Completed',
      d3Action: 'Stopped the line and purged the syringe until the flow was continuous.',
      d3CompletedBy: 'A. Engineer',
      d3CompletedAt: nowLocalDatetime(),
      d4Status: 'Confirmed',
      d4Method: 'Three test shots confirmed the air bubble was cleared.',
      d5Status: 'In Progress',
      d5TargetDate: inAWeek.toISOString().slice(0, 10),
      d5Responsible: 'B. Technician',
      d6Action: 'Replaced the nozzle and recalibrated the dispense height.',
      d6Status: 'Implemented',
      d6Verified: 'Yes',
      d7Notes: 'Purged the syringe and replaced the nozzle; dispense volume is repeatable again.',
      confirmedCause: form.confirmedCause || 'Air trapped in syringe / supply',
      closedBy: form.closedBy || 'A. Engineer',
    });
    lsSet(LS_KEYS.employeeName!, form.employeeName);
    lsSet(LS_KEYS.employeeId!, form.employeeId);
    lsSet(LS_KEYS.machineId!, form.machineId);
    buildForm();
    updateProgress();
  }

  // Initial render -----------------------------------------------------
  renderSourceBox();
  buildForm();
  updateSimilar();

  loadAllCases().then((cases) => {
    allCases = cases;
    if (useCurrent) {
      // keep whatever is already in the current-session form; just fill the dropdown
      renderSourceBox();
      return;
    }
    if (!selectedCase && allCases.length) selectedCase = allCases[0];
    form = blankForm();
    applyCaseDefaults();
    renderSourceBox();
    buildForm();
    updateSimilar();
  }).catch(() => { /* keep current-session mode */ });
}
