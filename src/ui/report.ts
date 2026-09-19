import { appState } from './state';
import { clear, el, panel, button } from './dom';
import { buildReportPdf, type ReportData } from '../report/pdfReport';
import { switchWorkbenchView } from './nav';
import { loadAllCases, caseToReportData } from './database';
import { BASE_URL, getSimilarCases, updateCase as apiUpdateCase } from '../api/pipeline';
import { upsertCase, patchCase, type CaseReportData } from '../db/caseDB';
import { fetchCaseImage, legsFromAnalysis } from '../report/caseImage';
import { getPdfFonts } from '../report/pdfFonts';
import type { ScoredCause } from '../engine/scorer';
import type { CauseId, DefectId } from '../engine/types';

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

// Module-level so an incidental re-render of the pane rebuilds the DOM from the
// current values instead of wiping what the user typed. Reset only on an
// explicit source change, a past-case load, or a genuinely new session.
let reportForm: ReportFormData = blankForm();

/** Lightweight counts/source refresh, wired up by renderReportTab(). */
let mountedRefresh: (() => void) | null = null;
/** Full reset + rebuild of the mounted pane, if any. */
let mountedReset: (() => void) | null = null;

/** Reset the report form (called when a new diagnosis session starts). */
export function resetReportForm(): void {
  reportForm = blankForm();
  mountedReset?.();
}

export function refreshReportTab(): void {
  mountedRefresh?.();
}

const newCaseId = (): string => {
  const raw = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return raw.replace(/-/g, '').slice(0, 12);
};

/**
 * The current report form mapped to the case-record shape (`report_data`),
 * with empty fields dropped. Returns null when nothing has been filled in.
 */
export function reportDataSnapshot(): CaseReportData | null {
  const f = reportForm;
  const out: Record<string, string> = {};
  const put = (key: string, value: string | undefined): void => {
    const v = (value ?? '').trim();
    if (v) out[key] = v;
  };
  put('employeeName', f.employeeName);
  put('employeeId', f.employeeId);
  put('machineId', f.machineId);
  put('affectedCount', f.affectedCount);
  put('d3Status', f.d3Status);
  put('d3Action', f.d3Action);
  put('d3CompletedBy', f.d3CompletedBy);
  put('d3CompletedAt', f.d3CompletedAt);
  put('d4Status', f.d4Status);
  put('d4Method', f.d4Method);
  put('d5Status', f.d5Status);
  put('d5TargetDate', f.d5TargetDate);
  put('d5Responsible', f.d5Responsible);
  put('d6Status', f.d6Status);
  put('d6Action', f.d6Action);
  put('d6VerifiedEffective', f.d6Verified);
  put('notes', f.d7Notes);
  put('confirmedCause', f.confirmedCause);
  put('closedBy', f.closedBy);
  put('closedDate', f.closedDate);
  return Object.keys(out).length ? (out as CaseReportData) : null;
}

// ---------------------------------------------------------------------------
// Stages Configuration
// ---------------------------------------------------------------------------
const STAGES = [
  { id: 'd1', code: 'D1', name: 'Individual', title: 'D1 · Individual & Team' },
  { id: 'd2', code: 'D2', name: 'Problem Description', title: 'D2 · Problem Description & Inspection Telemetry' },
  { id: 'd3', code: 'D3', name: 'Containment', title: 'D3 · Immediate Containment Action' },
  { id: 'd4', code: 'D4', name: 'Root Cause', title: 'D4 · Root Cause Verification' },
  { id: 'd5', code: 'D5', name: 'Planned PCA', title: 'D5 · Planned Corrective Action' },
  { id: 'd6', code: 'D6', name: 'Permanent PCA', title: 'D6 · Permanent Corrective Action' },
  { id: 'd7', code: 'D7', name: 'Process Notes', title: 'D7 · Process Note / Lessons Learned' },
  { id: 'd8', code: 'D8', name: 'Sign-off', title: 'D8 · Close Report & Sign-off' },
] as const;

function getStageCompletion(stageId: string, form: ReportFormData): 'completed' | 'progress' | 'pending' {
  switch (stageId) {
    case 'd1':
      if (form.employeeName.trim() && form.employeeId.trim()) return 'completed';
      if (form.employeeName.trim() || form.employeeId.trim()) return 'progress';
      return 'pending';
    case 'd2':
      if (form.machineId.trim() && form.affectedCount.trim()) return 'completed';
      if (form.machineId.trim() || form.affectedCount.trim()) return 'progress';
      return 'pending';
    case 'd3':
      if (form.d3Status === 'Completed' || (form.d3Status && form.d3Action.trim())) return 'completed';
      if (form.d3Status || form.d3Action.trim() || form.d3CompletedBy.trim()) return 'progress';
      return 'pending';
    case 'd4':
      if (form.d4Status === 'Confirmed' || (form.d4Status && form.d4Method.trim())) return 'completed';
      if (form.d4Status || form.d4Method.trim()) return 'progress';
      return 'pending';
    case 'd5':
      if (form.d5Status === 'Completed' || (form.d5Status && form.d5Responsible.trim())) return 'completed';
      if (form.d5Status || form.d5TargetDate || form.d5Responsible.trim()) return 'progress';
      return 'pending';
    case 'd6':
      if (form.d6Status === 'Implemented' && form.d6Verified) return 'completed';
      if (form.d6Status || form.d6Action.trim() || form.d6Verified) return 'progress';
      return 'pending';
    case 'd7':
      if (form.d7Notes.trim().length >= 8) return 'completed';
      if (form.d7Notes.trim()) return 'progress';
      return 'pending';
    case 'd8':
      if (form.confirmedCause.trim() && form.closedBy.trim()) return 'completed';
      if (form.confirmedCause.trim() || form.closedBy.trim()) return 'progress';
      return 'pending';
    default:
      return 'pending';
  }
}

// ---------------------------------------------------------------------------
// Tab renderer
// ---------------------------------------------------------------------------
export function renderReportTab(host: HTMLElement): void {
  clear(host);
  const layout = el('div', 'layout');
  host.appendChild(layout);

  const p = panel('8D Dispensing Quality & NCR Console');
  p.classList.add('report-panel');
  const body = p.querySelector('.panel-body')! as HTMLElement;
  layout.appendChild(p);

  // Local state --------------------------------------------------------
  let allCases: CaseRow[] = [];
  let selectedCase: CaseRow | null = null;
  let useCurrent = !!appState.lastDiagnosis;
  // alias onto the module-level form so typed values survive re-renders
  let form = reportForm;
  const setForm = (next: ReportFormData): void => { reportForm = next; form = next; };

  // Console layout grid
  const consoleLayout = el('div', 'report-console-layout');
  body.appendChild(consoleLayout);

  // Left sticky sidebar
  const sidebar = el('div', 'report-sidebar');
  consoleLayout.appendChild(sidebar);

  // Source selector box
  const sourceBox = el('div', 'report-source');
  sidebar.appendChild(sourceBox);

  // Similar-cases one-line summary
  const similarLine = el('div', 'case-count');
  sourceBox.appendChild(similarLine);
  similarLine.textContent = 'Loading historical summary...';

  // Stepper navigation in sidebar
  const stepperPanel = el('div', 'report-sidebar-panel');
  const stepperHead = el('div', 'report-stepper-head');
  stepperHead.appendChild(el('span', 'report-stepper-title', '8D Stage Stepper'));
  const stepperCount = el('span', 'report-stepper-count', '0/8 Done');
  stepperHead.appendChild(stepperCount);
  stepperPanel.appendChild(stepperHead);

  const navList = el('div', 'report-nav-list');
  for (const stage of STAGES) {
    const navBtn = el('button', 'report-nav-item') as HTMLButtonElement;
    navBtn.type = 'button';
    navBtn.setAttribute('data-nav-stage', stage.id);
    navBtn.appendChild(el('span', 'nav-step-code', stage.code));
    navBtn.appendChild(el('span', 'nav-step-name', stage.name));
    const statusIcon = el('span', 'nav-step-status pending', '·');
    navBtn.appendChild(statusIcon);
    navBtn.onclick = (e) => {
      e.preventDefault();
      const target = document.getElementById(`card-${stage.id}`);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    };
    navList.appendChild(navBtn);
  }
  stepperPanel.appendChild(navList);

  // Sidebar completeness indicator
  const sidebarProgressWrap = el('div', 'report-progress');
  const sidebarProgressLabel = el('span', 'report-progress-label', 'Completeness: 0%');
  const sidebarProgressTrack = el('div', 'report-progress-track');
  const sidebarProgressFill = el('div', 'report-progress-fill');
  sidebarProgressTrack.appendChild(sidebarProgressFill);
  sidebarProgressWrap.appendChild(sidebarProgressLabel);
  sidebarProgressWrap.appendChild(sidebarProgressTrack);
  stepperPanel.appendChild(sidebarProgressWrap);
  sidebar.appendChild(stepperPanel);

  // Main stage container
  const mainHost = el('div', 'report-main');
  consoleLayout.appendChild(mainHost);

  // Fixed sticky bottom status & action bar
  const bottomBar = el('div', 'report-bottom-bar');
  const bottomStatus = el('div', 'bottom-bar-status');
  const bottomProgressLabel = el('span', 'report-progress-label', '8D Completeness: 0% [0/8 Stages Complete]');
  const bottomProgressTrack = el('div', 'report-progress-track');
  const bottomProgressFill = el('div', 'report-progress-fill');
  bottomProgressTrack.appendChild(bottomProgressFill);
  bottomStatus.appendChild(bottomProgressLabel);
  bottomStatus.appendChild(bottomProgressTrack);

  const reportStatus = el('span', 'case-note');
  reportStatus.hidden = true;
  bottomStatus.appendChild(reportStatus);
  bottomBar.appendChild(bottomStatus);

  const bottomActions = el('div', 'bottom-bar-actions');
  const fillBtn = button('Fill sample', 'btn ghost sm', fillSampleReport);
  const saveDetailsBtn = button('Save report details', 'btn ghost sm', () => { void saveReportDetails(); });
  const downloadBtn = button('Download Report', 'btn primary');
  const backBtn = button('Back to diagnosis', 'btn ghost sm', () => switchWorkbenchView('inspect'));
  bottomActions.appendChild(fillBtn);
  bottomActions.appendChild(saveDetailsBtn);
  bottomActions.appendChild(downloadBtn);
  bottomActions.appendChild(backBtn);
  bottomBar.appendChild(bottomActions);

  body.appendChild(bottomBar);

  let statusTimer: number | undefined;
  const setStatus = (text: string, warn = false): void => {
    reportStatus.textContent = text;
    reportStatus.classList.toggle('warn', warn);
    reportStatus.hidden = false;
    window.clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => { reportStatus.hidden = true; }, 6000);
  };

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------
  const sourceBase = (): ReportData | null => {
    if (useCurrent) {
      if (!appState.lastDiagnosis) return null;
      return {
        diagnosis: appState.lastDiagnosis,
        actions: appState.lastActions ?? [],
        quality: appState.lastImage?.quality,
        imageLabel: appState.lastImage?.label ?? 'Figure 1: Automated Solder Paste Inspection (SPI) Anomaly Crop - Pad Cluster B_SMT5C',
        imageUrl: appState.lastImage?.imageUrl,
        imageFormat: appState.lastImage?.imageUrl ? 'PNG' : undefined,
        engineLabel: 'Gemini 1.5 Pro + YOLOv8n + MobileNetV2',
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
      closedDate: form.closedDate || (form.closedBy ? new Date().toISOString().slice(0, 10) : undefined),
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

    let doneCount = 0;
    for (const stage of STAGES) {
      const st = getStageCompletion(stage.id, form);
      if (st === 'completed') doneCount++;

      // update card header status badge
      const badge = mainHost.querySelector<HTMLElement>(`[data-stage-status="${stage.id}"]`);
      if (badge) {
        badge.className = `stage-status-badge ${st}`;
        badge.textContent = st === 'completed' ? 'COMPLETED' : st === 'progress' ? 'IN PROGRESS' : 'PENDING';
      }

      // update sidebar nav item
      const navItem = sidebar.querySelector<HTMLElement>(`[data-nav-stage="${stage.id}"]`);
      if (navItem) {
        const icon = navItem.querySelector<HTMLElement>('.nav-step-status');
        if (icon) {
          icon.className = `nav-step-status ${st === 'completed' ? 'done' : st === 'progress' ? 'wip' : 'pending'}`;
          icon.textContent = st === 'completed' ? '✓' : st === 'progress' ? '•' : '·';
        }
      }
    }

    stepperCount.textContent = `${doneCount}/8 Done (${pct}%)`;
    sidebarProgressLabel.textContent = `Completeness: ${pct}%`;
    sidebarProgressFill.style.width = `${pct}%`;

    bottomProgressLabel.textContent = `8D Completeness: ${pct}% [${doneCount}/8 Stages Complete]`;
    bottomProgressFill.style.width = `${pct}%`;
  };

  const refreshActionsEnabled = () => {
    const ok = !!(sourceBase());
    downloadBtn.disabled = !ok;
  };

  // Pre-fill editable fields from a selected past case (Change 1)
  const applyCaseDefaults = () => {
    if (useCurrent || !selectedCase) return;
    const rd = selectedCase.reportData;
    if (rd) {
      form.employeeName = rd.employeeName ?? '';
      form.employeeId = rd.employeeId ?? '';
      form.machineId = rd.machineId ?? '';
      form.affectedCount = rd.affectedCount ?? '';
      form.d3Status = rd.d3Status ?? '';
      form.d3Action = rd.d3Action ?? '';
      form.d3CompletedBy = rd.d3CompletedBy ?? '';
      form.d3CompletedAt = rd.d3CompletedAt ?? '';
      form.d4Status = rd.d4Status ?? '';
      form.d4Method = rd.d4Method ?? '';
      form.d5Status = rd.d5Status ?? '';
      form.d5TargetDate = rd.d5TargetDate ?? '';
      form.d5Responsible = rd.d5Responsible ?? '';
      form.d6Status = rd.d6Status ?? '';
      form.d6Action = rd.d6Action ?? '';
      form.d6Verified = rd.d6VerifiedEffective ?? '';
      form.d7Notes = rd.notes ?? '';
      form.confirmedCause = rd.confirmedCause
        ?? (selectedCase.resolvedCause ? humanize(selectedCase.resolvedCause) : '');
      form.closedBy = rd.closedBy ?? '';
      form.closedDate = rd.closedDate ?? '';
      return;
    }
    form.d7Notes = selectedCase.notes ?? '';
    form.confirmedCause = selectedCase.resolvedCause ? humanize(selectedCase.resolvedCause) : '';
  };

  // ------------------------------------------------------------------
  // Field builders
  // ------------------------------------------------------------------
  const row2 = (col1: HTMLElement, col2: HTMLElement): HTMLElement => {
    const r = el('div', 'report-grid-2');
    r.appendChild(col1);
    r.appendChild(col2);
    return r;
  };

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
    const updateSelection = () => {
      btns.forEach((b) => {
        const isSelected = b.textContent === form[key];
        b.classList.toggle('active', isSelected);
        const isResolved = ['Completed', 'Confirmed', 'Implemented', 'Yes'].includes(b.textContent || '');
        b.classList.toggle('resolved', isSelected && isResolved);
      });
    };
    const select = (val: string) => {
      form[key] = val;
      updateSelection();
      if (key === 'd3Status' && val === 'Completed' && !form.d3CompletedAt) {
        form.d3CompletedAt = nowLocalDatetime();
        const at = mainHost.querySelector<HTMLInputElement>('input[data-key="d3CompletedAt"]');
        if (at) at.value = form.d3CompletedAt;
      }
      updateProgress();
    };
    for (const opt of options) {
      const b = button(opt, 'seg-btn', () => select(opt));
      btns.push(b);
      grp.appendChild(b);
    }
    updateSelection();
    wrap.appendChild(grp);
    return wrap;
  };

  const readOnly = (label: string, values: string[]): HTMLElement => {
    const wrap = el('div', 'report-field');
    wrap.appendChild(el('div', 'question-label', label));
    const list = el('div', 'ro-list');
    if (!values.length) {
      list.classList.add('empty');
      list.appendChild(el('div', 'ro-empty', 'No recorded diagnostic steps'));
    } else {
      values.forEach((v, i) => list.appendChild(el('div', 'ro-item', `${i + 1}. ${v}`)));
    }
    wrap.appendChild(list);
    return wrap;
  };

  const createStageCard = (
    stage: typeof STAGES[number],
    content: HTMLElement[],
  ): HTMLElement => {
    const card = el('div', 'report-card');
    card.id = `card-${stage.id}`;

    const head = el('div', 'report-card-head');
    const titleGroup = el('div', 'card-title-group');
    titleGroup.appendChild(el('span', 'stage-badge', stage.code));
    titleGroup.appendChild(el('span', 'stage-title', stage.title));
    head.appendChild(titleGroup);

    const statusBadge = el('span', 'stage-status-badge pending', 'PENDING');
    statusBadge.setAttribute('data-stage-status', stage.id);
    head.appendChild(statusBadge);
    card.appendChild(head);

    const cardBody = el('div', 'report-card-body');
    for (const c of content) {
      cardBody.appendChild(c);
    }
    card.appendChild(cardBody);
    return card;
  };

  const renderTelemetryBadge = (base: ReportData): HTMLElement => {
    const card = el('div', 'telemetry-badge-card');
    const head = el('div', 'telemetry-head');
    head.appendChild(el('span', '', 'OPTICAL INSPECTION TELEMETRY · SPI DEFECT MATRIX'));
    card.appendChild(head);

    const isPass = base.visionAnalysis
      ? base.visionAnalysis.board_verdict.toLowerCase() === 'pass'
      : (base.diagnosis.defect.defectName.toLowerCase() === 'good');

    const tBody = el('div', 'telemetry-body');
    const primaryRow = el('div', 'telemetry-primary-row');
    const defectGroup = el('div', 'telemetry-defect-name');
    defectGroup.appendChild(el('span', '', base.diagnosis.defect.defectName));
    const verdictBadge = el(
      'span',
      `telemetry-tag ${isPass ? 'good' : 'fail'}`,
      isPass ? '[ BOARD PASS ]' : '[ DEFECT DETECTED ]',
    );
    defectGroup.appendChild(verdictBadge);
    primaryRow.appendChild(defectGroup);

    tBody.appendChild(primaryRow);

    const grid = el('div', 'telemetry-metrics-grid');
    const addMetric = (label: string, val: string) => {
      const tile = el('div', 'telemetry-metric-tile');
      tile.appendChild(el('span', 'metric-tile-lbl', label));
      tile.appendChild(el('span', 'metric-tile-val', val));
      grid.appendChild(tile);
    };

    const va = base.visionAnalysis;
    const verdictText = va ? va.board_verdict.toUpperCase() : (isPass ? 'PASS' : 'FAIL');
    addMetric('SPI Verdict', verdictText);

    if (va && va.defect_summary) {
      const ds = va.defect_summary;
      addMetric('Defect Matrix', `${ds['Less Paste']} Less · ${ds.Bridging} Bridge · ${ds.Good} Good`);
      const badPads = ds['Less Paste'] + ds.Bridging;
      const totalPads = badPads + ds.Good;
      const rate = totalPads > 0 ? Math.round((badPads / totalPads) * 100) : 0;
      addMetric('Defect Ratio', `${badPads} / ${totalPads} pads (${rate}%)`);
    } else {
      addMetric('Defect Type', base.diagnosis.defect.defectName);
      addMetric('Severity', base.diagnosis.defect.defectConfidence > 0.7 ? 'CRITICAL' : 'MODERATE');
    }

    addMetric('Detection Engine', 'YOLOv8s + MobileNetV2');
    tBody.appendChild(grid);
    card.appendChild(tBody);
    return card;
  };

  // Intersection observer to track which stage is in view
  let navObserver: IntersectionObserver | null = null;
  const setupNavObserver = () => {
    navObserver?.disconnect();
    if (typeof IntersectionObserver === 'undefined') return;
    navObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const stageId = entry.target.id.replace('card-', '');
            sidebar.querySelectorAll('.report-nav-item').forEach((item) => {
              item.classList.toggle('active', item.getAttribute('data-nav-stage') === stageId);
            });
            break;
          }
        }
      },
      { rootMargin: '-20% 0px -60% 0px' },
    );
    mainHost.querySelectorAll('.report-card').forEach((c) => {
      navObserver!.observe(c);
    });
  };

  // ------------------------------------------------------------------
  // Form rendering (rebuilt on source change)
  // ------------------------------------------------------------------
  const buildForm = () => {
    clear(mainHost);
    const base = sourceBase();

    if (!base) {
      mainHost.appendChild(el('div', 'case-empty', 'No diagnosis available. Analyze a board first, or select a past case.'));
      refreshActionsEnabled();
      updateProgress();
      return;
    }

    const causes = base.diagnosis.defect.causes as ScoredCause[];
    const actions = base.actions;

    // D1
    const d1Card = createStageCard(STAGES[0], [
      row2(
        field('Employee name', 'employeeName', { placeholder: 'Lead Engineer / Technician' }),
        field('Employee ID', 'employeeId', { placeholder: 'e.g. E-2048' }),
      ),
    ]);
    mainHost.appendChild(d1Card);

    // D2
    const d2Inputs = row2(
      field('Machine / line', 'machineId', { placeholder: 'Machine / Line ID (e.g. Dispenser A3)' }),
      field('Affected units', 'affectedCount', { placeholder: 'Affected unit count (e.g. 12 of 100 boards)' }),
    );
    const d2Telemetry = renderTelemetryBadge(base);
    const d2Card = createStageCard(STAGES[1], [d2Inputs, d2Telemetry]);
    mainHost.appendChild(d2Card);

    // D3
    const atField = field('Completed at', 'd3CompletedAt', { type: 'datetime-local' });
    atField.querySelector('input')!.setAttribute('data-key', 'd3CompletedAt');
    const d3Card = createStageCard(STAGES[2], [
      readOnly('Containment steps', actions.slice(0, 2).map((a) => a.title)),
      segmented('Status', 'd3Status', D3_OPTIONS),
      textareaField('Action taken', 'd3Action', 'Describe the immediate action taken to contain the issue...'),
      row2(
        field('Completed by', 'd3CompletedBy', { placeholder: 'Name' }),
        atField,
      ),
    ]);
    mainHost.appendChild(d3Card);

    // D4
    const d4Card = createStageCard(STAGES[3], [
      readOnly('Ranked causes', causes.slice(0, 5).map((c) => `${c.name} - ${Math.round(c.score * 100)}%`)),
      segmented('Status', 'd4Status', D4_OPTIONS),
      field('Verification method', 'd4Method', { placeholder: 'How was the root cause verified? e.g. test shots confirmed...' }),
    ]);
    mainHost.appendChild(d4Card);

    // D5
    const d5Card = createStageCard(STAGES[4], [
      readOnly('Action plan', actions.slice(2).map((a) => a.title)),
      segmented('Implementation status', 'd5Status', D5_OPTIONS),
      row2(
        field('Target date', 'd5TargetDate', { type: 'date' }),
        field('Responsible person', 'd5Responsible', { placeholder: 'Name' }),
      ),
    ]);
    mainHost.appendChild(d5Card);

    // D6
    const d6Card = createStageCard(STAGES[5], [
      textareaField('Action description', 'd6Action', 'Describe the permanent fix implemented...'),
      row2(
        segmented('Status', 'd6Status', D6_STATUS_OPTIONS),
        segmented('Verified effective', 'd6Verified', D6_VERIFIED_OPTIONS),
      ),
    ]);
    mainHost.appendChild(d6Card);

    // D7
    const d7Card = createStageCard(STAGES[6], [
      textareaField('Notes', 'd7Notes', 'Describe any SOP changes, parameter adjustments, or preventive actions taken...'),
    ]);
    mainHost.appendChild(d7Card);

    // D8
    const d8Card = createStageCard(STAGES[7], [
      row2(
        field('Confirmed cause', 'confirmedCause', { placeholder: 'What actually fixed it?' }),
        field('Operator name', 'closedBy', { placeholder: 'Operator name for sign-off' }),
      ),
    ]);
    mainHost.appendChild(d8Card);

    updateProgress();
    refreshActionsEnabled();
    setupNavObserver();
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
        setForm(blankForm());
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
        return `<option value="${i}">${c.idLabel} · ${fmtDate(c.timestamp)} · ${c.defectLabel ?? 'Unknown'} · ${cause}</option>`;
      }).join('');
      const idx = selectedCase ? allCases.indexOf(selectedCase) : 0;
      select.value = String(idx >= 0 ? idx : 0);
    }
    select.addEventListener('change', () => {
      const idx = Number(select.value);
      if (!Number.isNaN(idx) && allCases[idx]) {
        selectedCase = allCases[idx];
        setForm(blankForm());
        applyCaseDefaults();
        buildForm();
        updateSimilar();
      }
    });
    pastRow.appendChild(select);
    sourceBox.appendChild(pastRow);
    sourceBox.appendChild(similarLine);
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
  /** collect() plus (for past cases) the board thumbnail as a data URL. */
  const collectWithImage = async (): Promise<ReportData | null> => {
    const data = collect();
    if (!data) return null;
    if (!data.imageUrl && !useCurrent && selectedCase?.imagePath) {
      // redraw the saved YOLO detections onto the thumbnail so the PDF matches the panel
      const img = await fetchCaseImage(selectedCase.imagePath, legsFromAnalysis(selectedCase.analysisRaw));
      if (img) {
        data.imageUrl = img.url;
        data.imageFormat = img.format;
        data.imageLabel = img.label;
      }
    }
    return data;
  };

  downloadBtn.onclick = () => {
    void (async () => {
      const data = await collectWithImage();
      if (!data) return;
      const fonts = await getPdfFonts();
      buildReportPdf(data, fonts).save(`${data.reportId}.pdf`);
    })();
  };

  /** Create the server record for the current session, with its report data. */
  async function postReportCase(caseId: string, rd: CaseReportData): Promise<void> {
    const diag = appState.lastDiagnosis;
    const causes = diag ? diag.defect.causes : [];
    const defectLabel = defectType();
    const res = await fetch(`${BASE_URL}/cases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        case_id: caseId,
        image_path: appState.lastImage?.analysis?.image_path ?? 'manual-entry',
        analysis_result: appState.lastImage?.analysis ?? {},
        ranked_causes: causes.map((c) => ({ cause: c.causeId, score: c.score, reasons: c.reasons })),
        action_plan: (appState.lastActions ?? []).map((a) => a.title),
        engineer_feedback: {
          actual_cause: appState.lastConfirmedCause ?? null,
          confirmed_defects: defectLabel ? [defectLabel] : [],
          notes: rd.notes ?? null,
        },
        report_data: rd,
      }),
    });
    if (!res.ok) throw new Error(`case create failed: ${res.status}`);
  }

  /** Persist the current report form into the case record (local + server). */
  async function saveReportDetails(): Promise<void> {
    const rd = reportDataSnapshot();
    if (!rd) {
      setStatus('Fill in some report fields first.');
      return;
    }
    saveDetailsBtn.disabled = true;
    saveDetailsBtn.textContent = 'Saving…';
    try {
      if (!useCurrent && selectedCase) {
        if (selectedCase.localId != null) await patchCase(selectedCase.localId, { reportData: rd });
        if (selectedCase.serverCaseId) await apiUpdateCase(selectedCase.serverCaseId, { report_data: rd });
        setStatus(`Report details saved to case ${selectedCase.idLabel}.`);
      } else {
        // current session: patch the existing record, or create one
        if (appState.caseRecordId != null) {
          await patchCase(
            appState.caseRecordId,
            rd.notes ? { reportData: rd, notes: rd.notes } : { reportData: rd },
          );
        } else {
          const diag = appState.lastDiagnosis;
          const causes = diag ? diag.defect.causes : [];
          const localId = await upsertCase({
            timestamp: Date.now(),
            material: appState.material ?? '',
            defectId: (diag?.defect.defectId ?? 'inconsistent-volume') as DefectId,
            symptoms: [...appState.symptoms],
            topCause: (causes[0]?.causeId ?? 'equipment-inspection') as CauseId,
            notes: rd.notes,
            rankedCauses: causes.map((c) => ({ causeId: c.causeId, score: c.score })),
            actionPlan: (appState.lastActions ?? []).map((a) => a.title),
            reportData: rd,
          });
          appState.caseRecordId = localId;
        }
        const caseId = appState.caseId ?? newCaseId();
        appState.caseId = caseId;
        try {
          await apiUpdateCase(caseId, { report_data: rd });
        } catch {
          // no server record for this session yet - create it
          await postReportCase(caseId, rd);
        }
        setStatus('Report details saved to the current case.');
        refreshReportTab();
      }
    } catch (err) {
      console.error('save report details failed', err);
      setStatus('Could not save the report details. See console for details.', true);
    } finally {
      saveDetailsBtn.disabled = false;
      saveDetailsBtn.textContent = 'Save report details';
    }
  }

  // Dev/test aid: fill every report field with a realistic sample (Change: demo)
  function fillSampleReport() {
    const tomorrow = new Date(Date.now() + 86400000);
    Object.assign(form, {
      employeeName: 'A. Engineer (Lead QA)',
      employeeId: 'E-2048 / T-1092',
      machineId: 'Dispenser Head A3',
      affectedCount: '14 of 100 units affected',
      d3Status: 'Completed',
      d3Action: 'Purged syringe line, verified backpressure at 0.35 MPa, replaced disposable 27G dispense tip.',
      d3CompletedBy: 'A. Engineer (Lead QA)',
      d3CompletedAt: nowLocalDatetime(),
      d4Status: 'Confirmed',
      d4Method: 'Acoustic micro-void check confirmed trapped micro-air pocket near syringe piston interface.',
      d5Status: 'In Progress',
      d5TargetDate: tomorrow.toISOString().slice(0, 10),
      d5Responsible: 'B. Technician (Process Eng)',
      d6Action: 'Installed inline bubble sensor and updated syringe priming sequence in recipe v4.2.',
      d6Status: 'Implemented',
      d6Verified: 'Yes',
      d7Notes: 'Standardize syringe thaw-and-degas timing; update daily pre-flight check sheet.',
      confirmedCause: 'Air trapped in syringe / fluid supply',
      closedBy: 'A. Engineer (Lead QA)',
      closedDate: new Date().toISOString().slice(0, 10),
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
    setForm(blankForm());
    applyCaseDefaults();
    renderSourceBox();
    buildForm();
    updateSimilar();
  }).catch(() => { /* keep current-session mode */ });

  // Lightweight refresh: reload the case list + counts without touching the
  // form or rebuilding the fields. Also used on tab-visibility changes and by
  // refreshReportTab() from other modules.
  const refreshCounts = () => {
    loadAllCases().then((cases) => {
      allCases = cases;
      if (!useCurrent && !selectedCase && allCases.length) selectedCase = allCases[0];
      renderSourceBox();
      updateSimilar();
    }).catch(() => { /* ignore */ });
  };
  mountedRefresh = refreshCounts;
  mountedReset = () => {
    // new session: blank the fields and rebuild (the source selector stays as-is)
    setForm(blankForm());
    buildForm();
    updateSimilar();
  };

  // Reload the case list when this tab becomes visible (server may have been
  // starting when the page first loaded).
  const pane = host;
  const paneState = pane as unknown as { __reportPaneObserver?: MutationObserver };
  paneState.__reportPaneObserver?.disconnect();
  let wasHidden = pane.classList.contains('hidden');
  const observer = new MutationObserver(() => {
    const hidden = pane.classList.contains('hidden');
    if (wasHidden && !hidden) refreshCounts();
    wasHidden = hidden;
  });
  observer.observe(pane, { attributes: true, attributeFilter: ['class'] });
  paneState.__reportPaneObserver = observer;
}
