import { getAllCases, clearCases, resolveCase, type CaseRecord } from '../db/caseDB';
import { BASE_URL } from '../api/pipeline';
import { el, clear, panel, button } from './dom';
import { CAUSES } from '../engine/knowledgeBase';
import { openPdfPreview } from '../report/pdfPreview';
import type { ReportData } from '../report/pdfReport';
import type { ActionStep } from '../engine/actions';
import type { CauseId, DefectId, SymptomId } from '../engine/types';

// ---------------------------------------------------------------------------
// Unified case model (IndexedDB + server case_log.json)
// ---------------------------------------------------------------------------
interface RankedCause {
  cause: string;
  score: number; // 0-1 (server may also send 0-100)
  reasons?: string[];
}

interface BoardResult {
  verdict: string;
  lessPaste: number;
  bridging: number;
  good: number;
  total: number;
  flagged: number;
}
export interface UnifiedCase {
  key: string;
  source: 'local' | 'server' | 'both';
  idLabel: string;
  timestamp: number; // ms
  defectId: string | null;
  /** vision-domain label: "Less Paste" | "Bridging" | "Good" */
  defectLabel: string | null;
  material: string | null;
  symptoms: string[];
  rankedCauses: RankedCause[];
  actionPlan: string[];
  notes: string | null;
  resolvedCause: string | null;
  board: BoardResult | null;
  localId?: number;
  serverCaseId?: string;
  imagePath?: string;
  analysisRaw?: unknown;
}

const PAGE_SIZE = 20;
const DEDUP_WINDOW_MS = 2000;

const humanize = (s: string): string => s.replace(/-/g, ' ');
const pct = (score: number): number => Math.round(score <= 1 ? score * 100 : score);
const fmtTime = (ms: number): string =>
  new Date(ms).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });

const DISPLAY_TO_DEFECT: Record<string, string> = {
  'Less Paste': 'missing-dot',
  'Bridging': 'oversized-dot',
};

// reverse map for local records (rule-engine DefectId -> vision defect label),
// including the pre-Fix5 dispensing ids in case any survive
const DEFECT_TO_VISION: Record<string, string> = {
  'missing-dot': 'Less Paste',
  'undersized-dot': 'Less Paste',
  'inconsistent-volume': 'Less Paste',
  'oversized-dot': 'Bridging',
  'excessive-spread': 'Bridging',
  'irregular-shape': 'Bridging',
};
const VISION_LABELS = new Set(['Less Paste', 'Bridging', 'Good']);

function visionLabelFromDefectId(defectId?: string | null): string | null {
  if (!defectId) return null;
  if (VISION_LABELS.has(defectId)) return defectId;
  return DEFECT_TO_VISION[defectId] ?? null;
}

function mapToDefectId(name?: string | null): string | null {
  if (!name) return null;
  return DISPLAY_TO_DEFECT[name] ?? name;
}

function dominantLabel(summary: Record<string, number> | undefined): string | null {
  if (!summary) return null;
  if ((summary['Less Paste'] ?? 0) > 0) return 'Less Paste';
  if ((summary['Bridging'] ?? 0) > 0) return 'Bridging';
  return null;
}

function serverBoard(rec: Record<string, unknown>): BoardResult | null {
  const a = (rec.analysis_result ?? null) as Record<string, unknown> | null;
  if (!a) return null;
  const ds = (a.defect_summary ?? {}) as Record<string, number>;
  if (a.board_verdict == null && Object.keys(ds).length === 0) return null;
  return {
    verdict: String(a.board_verdict ?? 'n/a'),
    lessPaste: ds['Less Paste'] ?? 0,
    bridging: ds['Bridging'] ?? 0,
    good: ds['Good'] ?? 0,
    total: Number(a.total_legs_detected ?? 0),
    flagged: Number(a.flagged_legs ?? 0),
  };
}

function localToUnified(c: CaseRecord): UnifiedCase {
  return {
    key: `local-${c.id ?? c.timestamp}`,
    source: 'local',
    idLabel: c.id != null ? `#${c.id}` : '#',
    timestamp: c.timestamp,
    defectId: c.defectId ?? null,
    defectLabel: visionLabelFromDefectId(c.defectId),
    material: c.material || null,
    symptoms: c.symptoms ?? [],
    rankedCauses: (c.rankedCauses ?? []).map((rc) => ({ cause: rc.causeId, score: rc.score })),
    actionPlan: c.actionPlan ?? [],
    notes: c.notes ?? null,
    resolvedCause: c.resolvedCause ?? null,
    board: null,
    localId: c.id,
  };
}

export function serverToUnified(rec: Record<string, unknown>): UnifiedCase {
  const fb = (rec.engineer_feedback ?? {}) as Record<string, unknown>;
  const confirmed = (fb.confirmed_defects ?? []) as string[];
  const board = serverBoard(rec);
  const defectId = mapToDefectId(confirmed[0])
    ?? mapToDefectId(board ? dominantLabel({
      'Less Paste': board.lessPaste, 'Bridging': board.bridging, 'Good': board.good,
    }) : null);
  // prefer an explicit vision label from the engineer confirmation, else derive
  // it from the board summary; never show the dispensing-domain id here
  const defectLabel = confirmed.find((n) => VISION_LABELS.has(n))
    ?? (board ? dominantLabel({
      'Less Paste': board.lessPaste, 'Bridging': board.bridging, 'Good': board.good,
    }) : null)
    ?? visionLabelFromDefectId(defectId);
  const ranked = ((rec.ranked_causes ?? []) as Record<string, unknown>[]).map((r) => ({
    cause: String(r.cause ?? ''),
    score: Number(r.score ?? 0),
    reasons: (r.reasons as string[]) ?? [],
  }));
  return {
    key: `server-${String(rec.case_id ?? '')}`,
    source: 'server',
    idLabel: `#${String(rec.case_id ?? '').slice(0, 6)}`,
    timestamp: Number(rec.timestamp ?? 0) * 1000,
    defectId,
    defectLabel,
    material: null,
    symptoms: [],
    rankedCauses: ranked,
    actionPlan: ((rec.action_plan ?? []) as string[]).slice(),
    notes: (fb.notes as string) ?? null,
    resolvedCause: (fb.actual_cause as string) ?? null,
    board,
    serverCaseId: String(rec.case_id ?? ''),
    imagePath: (rec.image_path as string) ?? undefined,
    analysisRaw: rec.analysis_result,
  };
}

/** Map raw server case-log records (e.g. GET /cases/matching) to the unified model. */
export function unifiedFromServerCases(records: Record<string, unknown>[]): UnifiedCase[] {
  return records.map(serverToUnified);
}

function mergeBoth(local: UnifiedCase, server: UnifiedCase): UnifiedCase {
  return {
    ...local,
    key: `both-${server.serverCaseId}`,
    source: 'both',
    serverCaseId: server.serverCaseId,
    imagePath: server.imagePath,
    analysisRaw: server.analysisRaw,
    board: server.board ?? local.board,
    rankedCauses: local.rankedCauses.length ? local.rankedCauses : server.rankedCauses,
    actionPlan: local.actionPlan.length ? local.actionPlan : server.actionPlan,
    notes: local.notes ?? server.notes,
    resolvedCause: local.resolvedCause ?? server.resolvedCause,
    symptoms: local.symptoms.length ? local.symptoms : server.symptoms,
    defectId: local.defectId ?? server.defectId,
    defectLabel: local.defectLabel ?? server.defectLabel,
  };
}

function defectsOverlap(a: UnifiedCase, b: UnifiedCase): boolean {
  if (a.defectId && b.defectId) return a.defectId === b.defectId;
  // one side has no known defect: accept the time match
  return true;
}

async function fetchServerCases(attempts = 4, delayMs = 1500): Promise<Record<string, unknown>[]> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      const res = await fetch(`${BASE_URL}/cases/all`, { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) {
        const body = (await res.json()) as { cases?: Record<string, unknown>[] };
        return body.cases ?? [];
      }
    } catch {
      // server not ready / unreachable - retry below
    }
    if (attempt < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  return []; // server unreachable after retries - use IndexedDB only
}

/** Merge IndexedDB + server cases, dedup, tag source, newest first. */
export async function loadAllCases(): Promise<UnifiedCase[]> {
  const [local, server] = await Promise.all([getAllCases(), fetchServerCases()]);
  const localU = local.map(localToUnified);
  const serverU = server.map(serverToUnified);

  const usedServer = new Set<number>();
  const merged: UnifiedCase[] = [];

  for (const l of localU) {
    const idx = serverU.findIndex((s, i) =>
      !usedServer.has(i)
      && Math.abs(s.timestamp - l.timestamp) <= DEDUP_WINDOW_MS
      && defectsOverlap(l, s));
    if (idx >= 0) {
      usedServer.add(idx);
      merged.push(mergeBoth(l, serverU[idx]));
    } else {
      merged.push(l);
    }
  }
  serverU.forEach((s, i) => { if (!usedServer.has(i)) merged.push(s); });

  const sorted = merged.sort((a, b) => b.timestamp - a.timestamp);

  // TEMP DEBUG (Bug 3): show exactly what defect labels are stored per source
  console.log('[case-browser] first 5 raw defect labels:',
    sorted.slice(0, 5).map((c) => ({
      source: c.source,
      id: c.idLabel,
      defectId: c.defectId,
      defectLabel: c.defectLabel,
      resolvedCause: c.resolvedCause,
    })));

  return sorted;
}

function genCaseId(): string {
  const raw = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return raw.replace(/-/g, '').slice(0, 12);
}

/** Build a reportable 8D PDF dataset from a single stored case. */
export function caseToReportData(c: UnifiedCase): ReportData {
  const causes = c.rankedCauses.map((rc) => {
    const info = CAUSES[rc.cause as CauseId];
    return {
      causeId: rc.cause as CauseId,
      name: info?.name ?? humanize(rc.cause),
      category: info?.category ?? 'Process',
      description: info?.description ?? '',
      score: rc.score,
      reasons: rc.reasons ?? [],
    };
  });
  const top = causes[0];
  const defectName = c.defectLabel ?? (c.defectId ? humanize(c.defectId) : 'Unknown defect');
  const actions: ActionStep[] = c.actionPlan.map((title, i) => ({
    order: i + 1,
    causeId: (top?.causeId ?? 'equipment-inspection') as CauseId,
    title,
    detail: '',
  }));
  const resolved = !!c.resolvedCause;

  return {
    diagnosis: {
      defect: {
        defectId: (c.defectId ?? 'inconsistent-volume') as DefectId,
        defectName,
        defectDescription: 'Recorded inspection case from the learning database.',
        defectConfidence: top ? top.score : 0,
        causes,
        reasoning: top
          ? (top.reasons.length ? top.reasons.join(' ') : `Top ranked cause: ${top.name}.`)
          : 'No ranked causes were recorded for this case.',
        activeSymptoms: c.symptoms as SymptomId[],
      },
      material: c.material ?? '',
      timestamp: c.timestamp,
      activeSymptoms: c.symptoms as SymptomId[],
      qualityScore: c.board ? Math.round((c.board.good / Math.max(1, c.board.total)) * 100) : undefined,
    },
    actions,
    engineLabel: 'Case log export',
    reportId: `CASE-${c.idLabel.replace(/[^A-Za-z0-9]/g, '') || 'log'}`,
    containmentVerified: resolved,
    rootCauseVerified: resolved,
    correctiveActionVerified: false,
    engineerNotes: c.notes ?? undefined,
    confirmedCause: c.resolvedCause ?? undefined,
    visionAnalysis: c.board ? {
      board_verdict: c.board.verdict,
      defect_summary: { 'Less Paste': c.board.lessPaste, Bridging: c.board.bridging, Good: c.board.good },
      total_legs_detected: c.board.total,
      flagged_legs: c.board.flagged,
      low_confidence_count: 0,
    } : undefined,
  };
}

export interface CaseDetailOptions {
  /** Honest one-line reason this case is shown (used by the case graph). */
  matchedBecause?: string;
  /** When provided, renders the inline resolve control (Learning DB tab only). */
  onConfirm?: (causeId: string) => void;
}

/** Shared expanded-case detail markup (Learning DB tab + case graph popover). */
export function renderCaseCardDetail(c: UnifiedCase, opts: CaseDetailOptions = {}): HTMLElement {
  const detail = el('div', 'case-detail');
  if (opts.matchedBecause) detail.appendChild(el('div', 'cd-match', opts.matchedBecause));

  const row = (label: string, value: string) => {
    const r = el('div', 'cd-row');
    r.appendChild(el('div', 'cd-label', label));
    r.appendChild(el('div', 'cd-value', value));
    detail.appendChild(r);
  };

  row('Material', c.material || 'Not recorded');
  row('Symptoms', c.symptoms.length ? c.symptoms.map(humanize).join(' · ') : 'Not recorded');
  row('Board result', c.board
    ? `${c.board.verdict} · ${c.board.lessPaste} Less Paste · ${c.board.bridging} Bridging · ${c.board.good} Good · ${c.board.total} legs detected`
    : 'Not recorded');

  if (c.rankedCauses.length) {
    const sec = el('div', 'cd-section');
    sec.appendChild(el('div', 'cd-label', 'Ranked causes'));
    for (const [i, rc] of c.rankedCauses.slice(0, 3).entries()) {
      const line = el('div', 'cd-line');
      line.appendChild(el('span', 'num', `${i + 1}.`));
      line.appendChild(el('span', 'val', humanize(rc.cause)));
      line.appendChild(el('span', 'pct', `${pct(rc.score)}%`));
      sec.appendChild(line);
    }
    detail.appendChild(sec);
  }

  if (c.actionPlan.length) {
    const sec = el('div', 'cd-section');
    sec.appendChild(el('div', 'cd-label', 'Action plan'));
    for (const [i, step] of c.actionPlan.entries()) {
      const line = el('div', 'cd-line');
      line.appendChild(el('span', 'num', `${i + 1}.`));
      line.appendChild(el('span', 'val', step));
      sec.appendChild(line);
    }
    detail.appendChild(sec);
  }

  if (c.notes) row('Engineer notes', c.notes);
  if (c.resolvedCause) row('Confirmed cause', `✓ ${humanize(c.resolvedCause)}`);

  // Resolve action (open cases only; the Learning DB tab supplies onConfirm)
  if (!c.resolvedCause && c.rankedCauses.length && opts.onConfirm) {
    const confirm = opts.onConfirm;
    const resolveRow = el('div', 'case-resolve');
    resolveRow.appendChild(el('span', 'cd-label', 'Confirmed cause'));
    const sel = el('select', 'case-resolve-select') as HTMLSelectElement;
    sel.innerHTML = '<option value="">Select cause...</option>'
      + c.rankedCauses.map((rc) => `<option value="${rc.cause}">${humanize(rc.cause)}</option>`).join('');
    const confirmBtn = button('Confirm ✓', 'btn sm', () => {
      if (!sel.value) { sel.focus(); return; }
      confirmBtn.disabled = true;
      confirm(sel.value);
    });
    resolveRow.appendChild(sel);
    resolveRow.appendChild(confirmBtn);
    detail.appendChild(resolveRow);
  }

  // Per-case report preview
  const actionsRow = el('div', 'case-detail-actions');
  actionsRow.appendChild(button('Preview Report', 'btn sm', () => {
    openPdfPreview(caseToReportData(c), `case-${c.idLabel.replace(/[^A-Za-z0-9]/g, '') || 'log'}.pdf`);
  }));
  detail.appendChild(actionsRow);

  return detail;
}

// ---------------------------------------------------------------------------
// Tab renderer
// ---------------------------------------------------------------------------
export function renderDatabase(host: HTMLElement): void {
  clear(host);
  const layout = el('div', 'layout');
  host.appendChild(layout);

  const panelEl = panel('Learning Database');
  const body = panelEl.querySelector('.panel-body')! as HTMLElement;
  layout.appendChild(panelEl);

  // Summary strip --------------------------------------------------------
  const summary = el('div', 'case-summary');
  body.appendChild(summary);

  // Search / filter row --------------------------------------------------
  const searchRow = el('div', 'case-search-row');
  const searchInput = el('input', 'case-search-input') as HTMLInputElement;
  searchInput.type = 'search';
  searchInput.placeholder = 'Search cases...';
  searchInput.setAttribute('aria-label', 'Search cases');
  const defectSel = el('select', 'case-filter') as HTMLSelectElement;
  defectSel.setAttribute('aria-label', 'Filter by defect type');
  const statusSel = el('select', 'case-filter') as HTMLSelectElement;
  statusSel.setAttribute('aria-label', 'Filter by status');
  statusSel.innerHTML = '<option value="all">All status</option><option value="resolved">Resolved</option><option value="open">Open</option>';
  searchRow.appendChild(searchInput);
  searchRow.appendChild(defectSel);
  searchRow.appendChild(statusSel);
  body.appendChild(searchRow);

  const countLine = el('div', 'case-count');
  body.appendChild(countLine);
  const refreshBtn = button('Refresh', 'btn sm ghost', () => { void refresh(); });
  refreshBtn.setAttribute('aria-label', 'Refresh cases');
  countLine.appendChild(refreshBtn);
  const countText = el('span', '', '');
  countLine.prepend(countText);
  const list = el('div', 'case-list');
  body.appendChild(list);
  const pager = el('div', 'case-pager');
  body.appendChild(pager);

  // De-emphasised destructive action at the bottom -----------------------
  const footer = el('div', 'case-footer');
  const clearBtn = button('Clear Case History', 'btn ghost sm', async () => {
    if (!confirm('Delete all locally stored cases? Server cases are not affected.')) return;
    await clearCases();
    await refresh();
  });
  footer.appendChild(clearBtn);
  body.appendChild(footer);

  // State ----------------------------------------------------------------
  let all: UnifiedCase[] = [];
  let query = '';
  let defectFilter = 'all';
  let statusFilter = 'all';
  let page = 1;
  const expanded = new Set<string>();

  const filteredCases = (): UnifiedCase[] => {
    const q = query.trim().toLowerCase();
    return all.filter((c) => {
      if (defectFilter !== 'all' && c.defectLabel !== defectFilter) return false;
      const isResolved = !!c.resolvedCause;
      if (statusFilter === 'resolved' && !isResolved) return false;
      if (statusFilter === 'open' && isResolved) return false;
      if (!q) return true;
      const haystack = [
        c.defectLabel ?? '',
        c.defectId ?? '',
        c.resolvedCause ?? '',
        c.material ?? '',
        c.notes ?? '',
        ...c.rankedCauses.map((r) => r.cause),
      ].join(' ').toLowerCase();
      return haystack.includes(q);
    });
  };

  const renderSummary = () => {
    clear(summary);
    const resolved = all.filter((c) => c.resolvedCause).length;
    const causeCounts = new Map<string, number>();
    for (const c of all) {
      if (c.resolvedCause) causeCounts.set(c.resolvedCause, (causeCounts.get(c.resolvedCause) ?? 0) + 1);
    }
    const top = [...causeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '-';
    const item = (label: string, value: string) => {
      const s = el('span', 'case-summary-item');
      s.appendChild(el('span', 'cs-label', `${label}: `));
      s.appendChild(el('b', 'cs-value', value));
      summary.appendChild(s);
    };
    item('Total cases', `${all.length}`);
    item('Resolved', `${resolved}`);
    item('Most common cause', humanize(top));
  };

  const renderDefectOptions = () => {
    const current = defectSel.value || defectFilter;
    const ids = [...new Set(all.map((c) => c.defectLabel).filter((x): x is string => !!x))].sort();
    defectSel.innerHTML = '<option value="all">All defects</option>'
      + ids.map((id) => `<option value="${id}">${humanize(id)}</option>`).join('');
    defectSel.value = ids.includes(current) ? current : 'all';
    defectFilter = defectSel.value;
  };

  const buildDetail = (c: UnifiedCase): HTMLElement => {
    return renderCaseCardDetail(c, { onConfirm: (causeId) => { void confirmCause(c, causeId); } });
  };

  const buildCard = (c: UnifiedCase): HTMLElement => {
    const card = el('div', 'case-card');
    const isOpen = expanded.has(c.key);
    if (isOpen) card.classList.add('open');

    const head = el('div', 'case-head');
    head.appendChild(el('span', 'case-id', c.idLabel));

    const defectCell = el('div', 'case-defect');
    defectCell.appendChild(el('span', 'case-defect-name', c.defectLabel ?? 'Unknown defect'));
    const status = el('span', 'case-status', c.resolvedCause ? `✓ ${humanize(c.resolvedCause)}` : 'open');
    if (c.resolvedCause) status.classList.add('resolved');
    defectCell.appendChild(status);
    head.appendChild(defectCell);

    head.appendChild(el('span', 'case-ts', fmtTime(c.timestamp)));

    const sourceLabel = c.source === 'both' ? 'synced' : c.source;
    const badge = el('span', `case-source ${c.source === 'both' ? 'synced' : c.source}`, sourceLabel);
    head.appendChild(badge);

    const toggle = () => {
      if (expanded.has(c.key)) expanded.delete(c.key);
      else expanded.add(c.key);
      renderList();
    };
    head.onclick = (e) => { e.stopPropagation(); toggle(); };
    card.onclick = () => { if (!expanded.has(c.key)) toggle(); };

    card.appendChild(head);
    if (isOpen) card.appendChild(buildDetail(c));
    return card;
  };

  const renderPager = (total: number) => {
    clear(pager);
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (pages <= 1) return;
    const prev = button('← Prev', 'btn sm ghost', () => { if (page > 1) { page--; renderList(); } });
    const next = button('Next →', 'btn sm ghost', () => { if (page < pages) { page++; renderList(); } });
    prev.disabled = page <= 1;
    next.disabled = page >= pages;
    pager.appendChild(prev);
    pager.appendChild(el('span', 'case-page', `Page ${page} of ${pages}`));
    pager.appendChild(next);
  };

  const renderList = () => {
    clear(list);
    clear(pager);
    const filtered = filteredCases();
    countText.textContent = all.length
      ? `Showing ${filtered.length} of ${all.length} cases`
      : '';

    if (!all.length) {
      list.appendChild(el('div', 'case-empty', 'No cases yet. Analyze a board in the Workbench, then save or confirm a cause.'));
      return;
    }
    if (!filtered.length) {
      const empty = el('div', 'case-empty');
      empty.appendChild(el('span', '', 'No cases match your search. '));
      const reset = button('Clear filters', 'case-link', () => {
        query = ''; defectFilter = 'all'; statusFilter = 'all'; page = 1;
        searchInput.value = ''; defectSel.value = 'all'; statusSel.value = 'all';
        renderList();
      });
      empty.appendChild(reset);
      list.appendChild(empty);
      return;
    }

    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (page > pages) page = pages;
    const start = (page - 1) * PAGE_SIZE;
    for (const c of filtered.slice(start, start + PAGE_SIZE)) list.appendChild(buildCard(c));
    renderPager(filtered.length);
  };

  const refresh = async () => {
    // clear any previously rendered cards/rows BEFORE the async load so nothing
    // stale (or a stale skeleton) lingers while loadAllCases() is in flight
    clear(list);
    clear(pager);
    countText.textContent = 'Loading cases...';
    all = await loadAllCases();
    renderSummary();
    renderDefectOptions();
    page = 1;
    renderList();
  };

  async function confirmCause(c: UnifiedCase, causeId: string): Promise<void> {
    const ranked = c.rankedCauses.find((r) => r.cause === causeId);
    const causeName = ranked ? humanize(ranked.cause) : humanize(causeId);
    if (c.localId != null) {
      try { await resolveCase(c.localId, causeId as CauseId); } catch (err) { console.warn('local resolve failed', err); }
    }
    fetch(`${BASE_URL}/cases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        case_id: c.serverCaseId ?? genCaseId(),
        image_path: c.imagePath ?? 'unknown',
        analysis_result: c.analysisRaw ?? {},
        ranked_causes: c.rankedCauses.map((r) => ({ cause: r.cause, score: r.score, reasons: r.reasons ?? [] })),
        action_plan: c.actionPlan,
        engineer_feedback: {
          actual_cause: causeName,
          confirmed_defects: c.defectLabel ? [c.defectLabel] : (c.defectId ? [c.defectId] : []),
          notes: c.notes ?? 'Confirmed from Case Browser',
        },
      }),
    }).catch((err) => console.warn('case sync failed', err));
    await refresh();
  }

  // Events ---------------------------------------------------------------
  searchInput.addEventListener('input', () => { query = searchInput.value; page = 1; renderList(); });
  defectSel.addEventListener('change', () => { defectFilter = defectSel.value; page = 1; renderList(); });
  statusSel.addEventListener('change', () => { statusFilter = statusSel.value; page = 1; renderList(); });

  refresh();

  // Reload when this tab becomes visible: the server may have still been
  // starting when the page first loaded, and the initial fetch happens once.
  const pane = host;
  const paneState = pane as unknown as { __casePaneObserver?: MutationObserver };
  paneState.__casePaneObserver?.disconnect();
  let wasHidden = pane.classList.contains('hidden');
  const observer = new MutationObserver(() => {
    const hidden = pane.classList.contains('hidden');
    if (wasHidden && !hidden) void refresh();
    wasHidden = hidden;
  });
  observer.observe(pane, { attributes: true, attributeFilter: ['class'] });
  paneState.__casePaneObserver = observer;
}
