import { MATERIALS } from '../engine/knowledgeBase';
import { runDiagnosis } from '../engine/scorer';
import { buildActionPlan } from '../engine/actions';
import type { SymptomId } from '../engine/types';
import { appState, addSymptoms, resetState } from './state';
import { el, clear, button, panel } from './dom';
import { LlmRouter, HeuristicNlu } from '../nlu/llmRouter';
import { getAllCases, priorOverrides, upsertCase } from '../db/caseDB';
import { renderReportTab, refreshReportTab, resetReportForm, reportDataSnapshot } from './report';
import { switchWorkbenchView } from './nav';
import { isLowConfidence, LOW_TOP_CAUSE_SCORE } from './confidence';
import { createInspectionPanel, type VisionResult } from './vision';
import { boardClassToSymptoms } from '../vision/qualityScore';
import { template } from './templates';
import {
  BASE_URL,
  chat,
  fetchServerCasesAsIdbFormat,
  getMatchingCases,
  getSimilarCases,
  type AnalysisResult,
  type ChatMessage,
  type ChatPhase,
  type ChatResponse,
  type RuleEngineResult,
  type SimilarCasesResult,
} from '../api/pipeline';
import { renderCaseCardDetail, unifiedFromServerCases, type UnifiedCase } from './database';

const llm = new LlmRouter();

// ---------------------------------------------------------------------------
// Assistant drawer (overlay). The state lives at module level so it survives
// re-renders, and closing the drawer never clears the conversation.
// ---------------------------------------------------------------------------
let assistantOpen = false;
let assistantUnread = false;
let assistantEscBound = false;

function syncAssistant(): void {
  const drawer = document.getElementById('chat-drawer');
  const toggle = document.getElementById('assistant-toggle');

  // The backdrop is only in the DOM while the drawer is open, so a stuck dim
  // state is structurally impossible even if the CSS fails to load.
  let backdrop = document.getElementById('chat-backdrop');
  if (assistantOpen) {
    if (!backdrop) {
      backdrop = el('div', 'chat-backdrop');
      backdrop.id = 'chat-backdrop';
      backdrop.addEventListener('click', () => closeAssistant());
      document.body.appendChild(backdrop);
      // add the class on the next frame so the opacity transition still plays
      requestAnimationFrame(() => backdrop?.classList.add('open'));
    }
  } else if (backdrop) {
    backdrop.remove();
  }

  if (drawer && assistantOpen) {
    // keep the drawer content clear of the sticky topbar (which stays on top)
    const topbar = document.querySelector('.topbar') as HTMLElement | null;
    drawer.style.paddingTop = topbar ? `${topbar.offsetHeight}px` : '0px';
  }
  drawer?.classList.toggle('open', assistantOpen);
  drawer?.setAttribute('aria-hidden', String(!assistantOpen));
  toggle?.classList.toggle('has-unread', assistantUnread && !assistantOpen);
  toggle?.setAttribute('aria-expanded', String(assistantOpen));
}

export function openAssistant(): void {
  assistantOpen = true;
  assistantUnread = false;
  syncAssistant();
}
export function closeAssistant(): void {
  assistantOpen = false;
  syncAssistant();
}
export function toggleAssistant(): void {
  if (assistantOpen) closeAssistant();
  else openAssistant();
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Create a namespaced SVG element with attributes (there is no SVG helper in dom.ts). */
function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/** One clickable case marker on the related-cases timeline. */
interface TimelineNode {
  record: UnifiedCase;
  x: number;
  y: number;
  match: boolean;
}

const DAY_MS = 86_400_000;

const fmtDay = (ms: number): string =>
  new Date(ms).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

/**
 * Related-cases timeline: one node per matching case, placed at its real date
 * on a single axis that runs from the oldest case to today (proportional
 * spacing, no bucketing). Colour marks whether the case was confirmed as the
 * current top cause; clicking opens the shared case-detail popover. Nodes are
 * fixed - dragging would misrepresent when a case actually happened.
 */
function renderCaseTimeline(host: HTMLElement, defectType: string, topCause: string | null): void {
  void (async () => {
    let cases: UnifiedCase[];
    try {
      const res = await getMatchingCases(defectType);
      cases = unifiedFromServerCases(res.cases).filter((c) => c.timestamp > 0);
    } catch {
      host.remove(); // endpoint unreachable - keep the text summary only
      return;
    }
    if (!host.isConnected || cases.length === 0) {
      host.remove();
      return;
    }
    // Sparse data: the one-line summary reads better than a two-node timeline.
    if (cases.length < 3) {
      host.remove();
      return;
    }

    const todayMs = Date.now();
    const minTs = Math.min(...cases.map((c) => c.timestamp));
    const domainSpan = todayMs - minTs;

    // geometry (viewBox units; the SVG scales to the container)
    const W = 460;
    const H = 80;
    const padL = 14;
    const padR = 14;
    const railY = 50;
    const plotW = W - padL - padR;
    const r = 4.5;
    const xOf = (t: number): number => (domainSpan <= 0
      ? padL + plotW
      : padL + Math.min(1, Math.max(0, (t - minTs) / domainSpan)) * plotW);

    // lane assignment: cases on the same / near dates stack upwards so each
    // node stays visible and clickable instead of overlapping
    const offsets = [0, -9, -18, -27, -36];
    const laneLast = offsets.map(() => -Infinity);
    const matchKey = (topCause ?? '').toLowerCase();
    const nodes: TimelineNode[] = [...cases]
      .sort((a, b) => a.timestamp - b.timestamp)
      .map((c) => {
        const x = xOf(c.timestamp);
        let lane = laneLast.findIndex((last) => x - last >= r * 2 + 2);
        if (lane < 0) lane = laneLast.indexOf(Math.min(...laneLast));
        laneLast[lane] = x;
        return {
          record: c,
          x,
          y: railY + offsets[Math.min(lane, offsets.length - 1)],
          match: !!c.resolvedCause && c.resolvedCause.toLowerCase() === matchKey,
        };
      });

    // ---- compact metrics for the info column (all from this payload) ----
    const total = cases.length;
    const confirmed = nodes.filter((n) => n.match).length;
    const confirmedPct = total ? Math.round((confirmed / total) * 100) : 0;
    const spanDays = Math.max(1, Math.round((todayMs - minTs) / DAY_MS));
    const recentCount = cases.filter((c) => todayMs - c.timestamp <= 30 * DAY_MS).length;

    const causeCounts = new Map<string, number>();
    for (const c of cases) {
      if (c.resolvedCause) causeCounts.set(c.resolvedCause, (causeCounts.get(c.resolvedCause) ?? 0) + 1);
    }
    const topCauses = [...causeCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    const recentCases = [...cases].sort((a, b) => b.timestamp - a.timestamp).slice(0, 3);

    // legend (single compact row above the rail, hint folded in)
    const legend = el('div', 'tl-legend');
    const legendKey = (swatch: string, text: string) => {
      const k = el('span', 'tl-key');
      k.appendChild(el('span', `tl-swatch ${swatch}`));
      const label = el('span', 'tl-key-label', text);
      label.title = text;
      k.appendChild(label);
      legend.appendChild(k);
    };
    legendKey('confirmed', topCause ? `Confirmed: ${topCause}` : 'Confirmed as top cause');
    legendKey('other', `Other ${defectType} cases`);
    legend.appendChild(el('span', 'tl-hint', 'Click a point for details'));

    const svg = svgEl('svg', {
      viewBox: `0 0 ${W} ${H}`,
      class: 'tl-svg',
      role: 'img',
      'aria-label': `${defectType} cases from ${fmtDay(minTs)} to today`,
    });

    // rail + today marker at the right end, level with the nodes
    svg.appendChild(svgEl('line', { x1: padL, y1: railY, x2: padL + plotW, y2: railY, class: 'tl-rail' }));
    svg.appendChild(svgEl('line', { x1: padL + plotW, y1: railY - 6, x2: padL + plotW, y2: railY + 6, class: 'tl-today' }));

    // date ticks: evenly spaced across the real span; "Today" anchors the right
    const fmtTick = (ms: number): string => new Date(ms).toLocaleDateString(
      'en-GB',
      domainSpan > 300 * DAY_MS ? { month: 'short', year: '2-digit' } : { day: '2-digit', month: 'short' },
    );
    for (const frac of [0, 1 / 5, 2 / 5, 3 / 5, 4 / 5]) {
      const x = padL + frac * plotW;
      svg.appendChild(svgEl('line', { x1: x, y1: railY - 3, x2: x, y2: railY + 3, class: 'tl-tick' }));
      const label = svgEl('text', {
        x,
        y: railY + 16,
        class: 'tl-label',
        'text-anchor': frac === 0 ? 'start' : 'middle',
      });
      label.textContent = fmtTick(minTs + frac * domainSpan);
      svg.appendChild(label);
    }
    const todayLabel = svgEl('text', {
      x: padL + plotW, y: railY + 16, class: 'tl-today-label', 'text-anchor': 'end',
    });
    todayLabel.textContent = 'Today';
    svg.appendChild(todayLabel);

    // tooltip + popover (same pattern as the original case graph)
    const tip = el('div', 'tl-tip');
    host.appendChild(tip);
    const pop = el('div', 'tl-pop');
    host.appendChild(pop);

    const onDocClick = (e: MouseEvent) => {
      if (!pop.contains(e.target as Node)) closePop();
    };
    function closePop(): void {
      pop.classList.remove('show');
      document.removeEventListener('click', onDocClick);
    }
    const showTip = (ev: MouseEvent, text: string) => {
      const box = (ev.currentTarget as SVGGElement).getBoundingClientRect();
      const hostBox = host.getBoundingClientRect();
      tip.textContent = text;
      tip.style.left = `${box.left - hostBox.left + box.width / 2}px`;
      tip.style.top = `${box.top - hostBox.top}px`;
      tip.classList.add('show');
    };
    const hideTip = () => tip.classList.remove('show');

    const openPop = (anchor: Element, record: UnifiedCase) => {
      clear(pop);
      pop.appendChild(renderCaseCardDetail(record, {
        matchedBecause: `Matched because: same defect type (${defectType})`,
      }));
      const close = button('×', 'tl-close', () => closePop());
      close.setAttribute('aria-label', 'Close case detail');
      pop.appendChild(close);

      const box = anchor.getBoundingClientRect();
      const hostBox = host.getBoundingClientRect();
      // clamp so a chip near either edge keeps the panel inside the accordion
      const halfW = Math.max(0, Math.min(150, hostBox.width / 2 - 8));
      const anchorX = box.left - hostBox.left + box.width / 2;
      pop.style.left = `${Math.min(Math.max(anchorX, halfW), hostBox.width - halfW)}px`;
      pop.style.top = `${box.top - hostBox.top + box.height / 2}px`;
      pop.classList.add('show');
      setTimeout(() => document.addEventListener('click', onDocClick), 0);
    };

    // nodes at their real dates
    for (const n of nodes) {
      const c = n.record;
      const causeName = c.resolvedCause ?? 'No confirmed cause';
      const text = `${c.idLabel} · ${fmtDay(c.timestamp)} · ${causeName}`;
      const group = svgEl('g', {
        class: 'tl-nodegroup',
        tabindex: 0,
        role: 'button',
        'aria-label': `${c.idLabel}: ${causeName}, ${fmtDay(c.timestamp)}`,
      });
      group.appendChild(svgEl('circle', { cx: n.x, cy: n.y, r: 8, class: 'tl-ring' }));
      group.appendChild(svgEl('circle', { cx: n.x, cy: n.y, r, class: n.match ? 'tl-node match' : 'tl-node' }));
      const title = document.createElementNS(SVG_NS, 'title');
      title.textContent = text;
      group.appendChild(title);
      group.addEventListener('mouseenter', (ev) => showTip(ev, text));
      group.addEventListener('mouseleave', hideTip);
      group.addEventListener('click', (ev) => { ev.stopPropagation(); openPop(group, c); });
      group.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openPop(group, c); }
      });
      svg.appendChild(group);
    }

    // ---- two-column body: compact chart left, case info right ----
    const chartCol = el('div', 'tc-chart');
    chartCol.appendChild(legend);
    chartCol.appendChild(svg);

    const infoCol = el('div', 'tc-info');

    const stats = el('div', 'tc-stats');
    const stat = (label: string, value: string) => {
      const s = el('div', 'tc-stat');
      s.appendChild(el('div', 'k', label));
      s.appendChild(el('div', 'v', value));
      stats.appendChild(s);
    };
    stat('Cases', `${total}`);
    stat('Confirmed', `${confirmed} (${confirmedPct}%)`);
    stat('Span', `${spanDays} d`);
    stat('Last 30 d', `${recentCount}`);
    infoCol.appendChild(stats);

    if (topCauses.length) {
      const sec = el('div', 'tc-causes');
      sec.appendChild(el('div', 'tc-title', 'Confirmed causes'));
      const maxCount = Math.max(1, topCauses[0][1]);
      for (const [name, count] of topCauses) {
        const row = el('div', 'tc-cause');
        const nm = el('span', 'name', name);
        nm.title = name;
        row.appendChild(nm);
        row.appendChild(el('span', 'n', `${count}`));
        const bar = el('div', 'tc-bar');
        const fill = el('div', 'tc-bar-fill');
        fill.style.transform = `scaleX(${(count / maxCount).toFixed(3)})`;
        bar.appendChild(fill);
        row.appendChild(bar);
        sec.appendChild(row);
      }
      infoCol.appendChild(sec);
    }

    if (recentCases.length) {
      const sec = el('div', 'tc-recent');
      sec.appendChild(el('div', 'tc-title', 'Recent cases'));
      const chips = el('div', 'tc-chips');
      for (const c of recentCases) {
        const chip = button(`${c.idLabel} · ${fmtDay(c.timestamp)}`, 'tc-chip');
        chip.title = `${c.idLabel} · ${fmtDay(c.timestamp)} · ${c.resolvedCause ?? 'No confirmed cause'}`;
        chip.onclick = (ev) => { ev.stopPropagation(); openPop(chip, c); };
        chips.appendChild(chip);
      }
      sec.appendChild(chips);
      infoCol.appendChild(sec);
    }

    const wrap = el('div', 'tc-wrap');
    wrap.appendChild(chartCol);
    wrap.appendChild(infoCol);
    host.appendChild(wrap);
  })();
}

// ---------------------------------------------------------------------------
// Collapsible diagnosis sections. Expansion state is session-only (module
// scope) so it survives re-analysis within a session but resets on reload.
// ---------------------------------------------------------------------------

const diagSectionState = { ranking: false, related: false };

interface CollapsibleSection {
  root: HTMLElement;
  /** content goes here (clipped while collapsed) */
  inner: HTMLElement;
  setBadge: (text: string) => void;
  /** always-visible line under the header (only when withSummary) */
  setSummary: (text: string) => void;
}

function collapsibleSection(opts: {
  title: string;
  badge?: string;
  open: boolean;
  onToggle: (open: boolean) => void;
  withSummary?: boolean;
}): CollapsibleSection {
  const root = el('div', 'acc');
  root.dataset.open = String(opts.open);

  const head = el('button', 'acc-head') as HTMLButtonElement;
  head.type = 'button';
  head.setAttribute('aria-expanded', String(opts.open));

  const caret = svgEl('svg', { class: 'acc-caret', viewBox: '0 0 12 12', width: 10, height: 10, 'aria-hidden': 'true' });
  caret.appendChild(svgEl('path', {
    d: 'M4 2 L8 6 L4 10', fill: 'none', stroke: 'currentColor',
    'stroke-width': 1.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  }));
  head.appendChild(caret);
  head.appendChild(el('span', 'acc-title', opts.title));
  const badge = el('span', 'acc-badge', opts.badge ?? '');
  head.appendChild(badge);
  root.appendChild(head);

  let summary: HTMLElement | null = null;
  if (opts.withSummary) {
    summary = el('div', 'acc-summary', '');
    summary.hidden = true;
    root.appendChild(summary);
  }

  // grid-template-rows 0fr -> 1fr gives a smooth height reveal without
  // animating height/width directly; the inner wrapper clips the content.
  const bodyEl = el('div', 'acc-body');
  const clip = el('div', 'acc-inner');
  const inner = el('div', 'acc-pad');
  clip.appendChild(inner);
  bodyEl.appendChild(clip);
  root.appendChild(bodyEl);

  const apply = (open: boolean): void => {
    root.dataset.open = String(open);
    head.setAttribute('aria-expanded', String(open));
    bodyEl.setAttribute('aria-hidden', String(!open));
    bodyEl.toggleAttribute('inert', !open);
    if (open) {
      // release the clip after the reveal so nested popovers are not cut off
      window.setTimeout(() => {
        if (root.dataset.open === 'true') clip.classList.add('uncut');
      }, 240);
    } else {
      clip.classList.remove('uncut');
    }
  };
  apply(opts.open);

  head.onclick = () => {
    const open = root.dataset.open !== 'true';
    apply(open);
    opts.onToggle(open);
  };

  return {
    root,
    inner,
    setBadge: (text: string) => { badge.textContent = text; },
    setSummary: (text: string) => {
      if (!summary) return;
      summary.textContent = text;
      summary.hidden = !text;
    },
  };
}

export function renderTroubleshoot(host: HTMLElement): void {
  clear(host);
  resetState();
  resetReportForm(); // a new session starts with a fresh report form
  assistantOpen = false;
  assistantUnread = false;
  const layout = el('div', 'layout workbench');
  host.appendChild(layout);

  // ---- Main column: inspection + diagnosis (full width, no sidebar) ----
  const mainCol = el('div', 'main-col');
  layout.appendChild(mainCol);

  const diagPanel = panel('Diagnosis');
  const diagBody = diagPanel.querySelector('.panel-body')! as HTMLElement;
  mainCol.appendChild(diagPanel);

  const vision = createInspectionPanel({
    onAnalyze: () => {
      aiSay('Board analyzed - starting the diagnosis conversation.', true);
      updateEvidence();
    },
    onFeed: (r: VisionResult) => {
      feedVision(r);
    },
  });
  mainCol.insertBefore(vision.panel, diagPanel);

  // ---- Assistant: overlay drawer (does not occupy layout space) ----
  // The backdrop lives in syncAssistant(): it is only in the DOM while open.
  document.getElementById('chat-drawer')?.remove();
  document.getElementById('chat-backdrop')?.remove();

  const chatDrawer = el('aside', 'chat-drawer');
  chatDrawer.id = 'chat-drawer';
  chatDrawer.setAttribute('aria-label', 'Assistant');
  chatDrawer.setAttribute('aria-hidden', 'true');
  document.body.appendChild(chatDrawer);

  const chatPanel = panel('Assistant');
  const chatBody = chatPanel.querySelector('.panel-body')! as HTMLElement;
  chatDrawer.appendChild(chatPanel);

  if (!assistantEscBound) {
    assistantEscBound = true;
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && assistantOpen) closeAssistant();
    });
  }
  syncAssistant();

  const evidenceStrip = el('div', 'evidence-strip');
  chatBody.appendChild(evidenceStrip);

  const chatLog = el('div', 'chat-log');
  chatLog.setAttribute('aria-live', 'polite');
  const inputRow = el('div', 'freetext-row chat-row');
  const input = el('textarea', 'chat-input') as HTMLTextAreaElement;
  input.rows = 1;
  input.placeholder = 'Describe the problem in your own words…';
  input.setAttribute('aria-label', 'Describe the dispensing problem in your own words');
  input.setAttribute('autocomplete', 'off');
  // auto-expand as the user types (capped by max-height in CSS)
  const autoGrow = () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
    // only show a scrollbar once we hit the max height
    input.style.overflowY = input.scrollHeight > 120 ? 'auto' : 'hidden';
  };
  input.addEventListener('input', autoGrow);
  const sendBtn = button('ANALYZE', 'btn primary');
  inputRow.appendChild(input);
  inputRow.appendChild(sendBtn);
  chatBody.appendChild(chatLog);
  chatBody.appendChild(inputRow);

  // ---- Conversation state (Gemini-backed discovery) ----
  let conversationHistory: ChatMessage[] = [];
  let chatPhase: ChatPhase = 'discovery';
  let lastAnalysis: AnalysisResult | null = null;
  let lastRuleEngine: RuleEngineResult | null = null;
  let lastSimilar: SimilarCasesResult | null = null;
  let diagnosed = false;

  const aiSay = (text: string, html = false) => {
    const m = el('div', 'msg ai');
    m.appendChild(el('div', 'avatar', 'PT'));
    const b = el('div', 'bubble');
    if (html) b.innerHTML = text;
    else b.textContent = text;
    m.appendChild(b);
    chatLog.appendChild(m);
    chatLog.scrollTop = chatLog.scrollHeight;
    // new assistant content while the drawer is closed -> unread indicator
    if (!assistantOpen) {
      assistantUnread = true;
      syncAssistant();
    }
  };
  const userSay = (text: string) => {
    const m = el('div', 'msg user');
    m.appendChild(el('div', 'avatar', 'OP'));
    m.appendChild(el('div', 'bubble', text));
    chatLog.appendChild(m);
    chatLog.scrollTop = chatLog.scrollHeight;
  };

  // ---- Rule engine bridge: run the deterministic engine, build chat grounding ----
  const computeRuleEngine = async () => {
    // blend locally-saved cases with confirmed cases from the server case log
    const [idbCases, serverCases] = await Promise.all([
      getAllCases(),
      fetchServerCasesAsIdbFormat(),
    ]);
    const priors = priorOverrides([...idbCases, ...serverCases]);
    const report = runDiagnosis(
      [...appState.symptoms],
      appState.material ? MATERIALS[appState.material] : '',
      priors,
      appState.emphasized ? [...appState.emphasized] : undefined,
    );
    const actions = buildActionPlan(report.defect.causes.map((c) => c.causeId));
    const rule: RuleEngineResult = {
      defect_name: report.defect.defectName,
      defect_confidence: report.defect.defectConfidence,
      ranked_causes: report.defect.causes.slice(0, 5).map((c) => ({
        cause: c.name,
        score: c.score * 100,
        reasons: c.reasons,
      })),
      action_plan: actions.map((a) => `${a.title}. ${a.detail}`),
      reasoning: report.defect.reasoning,
    };
    return { report, actions, rule };
  };

  // Render the structured diagnosis panel (unchanged UI) when the engine fires.
  const renderDiagnosisFor = (
    report: ReturnType<typeof runDiagnosis>,
    actions: ReturnType<typeof buildActionPlan>,
  ) => {
    appState.lastDiagnosis = report;
    appState.lastActions = actions;
    if (appState.lastImage?.quality) report.qualityScore = appState.lastImage.quality.overall;
    renderDiagnosis(diagBody, report, actions);
    diagnosed = true;
    updateEvidence();
    renderReportTab(document.getElementById('workbench-report') as HTMLElement);
  };

  // ---- Demo: jump straight to a completed diagnosis (dev/test aid) ----
  const loadDemoSession = async () => {
    // 1. drive the real inspection panel: select + analyze the first less-paste board
    const result = await vision.analyzeFirst((b) => b.class === 'less-paste');

    // 2. session context from the (real) analysis
    appState.material = 'solder-paste';
    const boardClass = result?.board?.dominantDefect ?? 'less-paste';
    addSymptoms(boardClassToSymptoms(boardClass) as SymptomId[]);
    if (result) {
      appState.lastImage = {
        label: result.label,
        imageUrl: result.imageUrl,
        board: result.board,
        quality: result.quality,
        analysis: result.analysis,
      };
    }
    appState.lastConfirmedCause = 'Air trapped in syringe / supply';
    appState.lastSimilarCases = {
      total: 12,
      most_common_cause: 'Air trapped in syringe / supply',
      message: 'Similar problems occurred 12 times. In 5 cases, the main cause was Air trapped in syringe / supply.',
      defect_type: boardClass === 'bridging' ? 'Bridging' : 'Less Paste',
    };

    // 3. run the real rule engine locally (no Gemini call)
    const { report, actions } = await computeRuleEngine();

    // 4. supply the chat with a canned (completed) discovery transcript
    clear(chatLog);
    conversationHistory = [];
    chatPhase = 'followup';
    diagnosed = true;
    lastAnalysis = result?.analysis ?? null;
    const ds = result?.analysis?.defect_summary;
    const counts = ds
      ? `${ds['Less Paste']} leg(s) with insufficient paste, ${ds.Bridging} bridging and ${ds.Good} good`
      : 'a dispensing defect';
    const say = (role: 'user' | 'model', text: string) => {
      if (role === 'user') userSay(text);
      else aiSay(text, true);
      conversationHistory.push({ role, content: text });
    };
    say('model', `Board analyzed. I see ${counts}. Has this been happening continuously, or only occasionally?`);
    say('user', 'Occasionally, and it started after we switched to a new solder paste batch.');
    say('model', 'Got it. Is it concentrated in one area of the board, or spread across several locations?');
    say('user', 'Mostly along one edge of the board.');
    say('model', 'Understood. The diagnosis is ready on the left - review the ranked causes and the action plan.');

    // 5. reveal results and open the assistant so the transcript is visible
    renderDiagnosisFor(report, actions);
    updateEvidence();
    switchTab('troubleshoot');
    openAssistant();
  };
  const demoBtn = button('Load demo', 'btn sm ghost');
  demoBtn.style.marginLeft = 'auto';
  demoBtn.title = 'Skip setup: analyze the first board and load a completed diagnosis';
  demoBtn.onclick = () => { void loadDemoSession(); };
  chatPanel.querySelector('.panel-head')!.appendChild(demoBtn);
  const drawerClose = button('×', 'drawer-close', () => closeAssistant());
  drawerClose.setAttribute('aria-label', 'Close assistant');
  chatPanel.querySelector('.panel-head')!.appendChild(drawerClose);

  // ---- One Gemini chat turn (template fallback when the server is down) ----
  const sendTurn = async (message: string, fallback: string, pushUser: boolean) => {
    if (pushUser) conversationHistory.push({ role: 'user', content: message });

    // refresh the rule-engine grounding from the current symptom evidence
    let report: ReturnType<typeof runDiagnosis> | undefined;
    let actions: ReturnType<typeof buildActionPlan> | undefined;
    if (appState.symptoms.size > 0) {
      const computed = await computeRuleEngine();
      report = computed.report;
      actions = computed.actions;
      lastRuleEngine = computed.rule;
    }

    const thinking = el('div', 'msg ai');
    thinking.appendChild(el('div', 'avatar', 'PT'));
    thinking.appendChild(el('div', 'bubble loading', '…'));
    chatLog.appendChild(thinking);
    chatLog.scrollTop = chatLog.scrollHeight;

    let resp: ChatResponse | null = null;
    try {
      resp = await chat(message, conversationHistory, lastAnalysis, chatPhase, lastRuleEngine, lastSimilar);
    } catch (err) {
      console.warn('chat endpoint unavailable, using offline response', err);
    }
    thinking.remove();

    if (resp) {
      aiSay(resp.reply, true);
      conversationHistory.push({ role: 'model', content: resp.reply });
      if (
        resp.suggested_phase === 'discovery' ||
        resp.suggested_phase === 'diagnosis' ||
        resp.suggested_phase === 'followup'
      ) {
        chatPhase = resp.suggested_phase;
      }
      appState.lastEngineLabel = 'Gemini API';
      if (resp.ready_for_diagnosis && report && actions && !diagnosed) {
        renderDiagnosisFor(report, actions);
      }
    } else {
      aiSay(fallback, true);
      conversationHistory.push({ role: 'model', content: fallback });
    }
  };

  // ---- Live evidence summary ----
  const updateEvidence = () => {
    clear(evidenceStrip);
    evidenceStrip.appendChild(el('span', 'elabel', 'Evidence'));
    const mat = el('span', appState.material ? 'evidence-chip ok' : 'evidence-chip warn');
    mat.appendChild(el('span', 'mark', appState.material ? '✓' : '✗'));
    mat.appendChild(el('span', '', 'material'));
    if (appState.material) mat.appendChild(el('span', '', ` ${MATERIALS[appState.material]}`));
    evidenceStrip.appendChild(mat);

    const syms = el('span', appState.symptoms.size ? 'evidence-chip ok' : 'evidence-chip warn');
    syms.appendChild(el('span', 'mark', appState.symptoms.size ? '✓' : '✗'));
    syms.appendChild(el('span', '', `symptoms (${appState.symptoms.size})`));
    evidenceStrip.appendChild(syms);

    const img = el('span', appState.lastImage ? 'evidence-chip ok' : 'evidence-chip warn');
    img.appendChild(el('span', 'mark', appState.lastImage ? '✓' : '✗'));
    img.appendChild(el('span', '', 'image'));
    evidenceStrip.appendChild(img);
  };
  updateEvidence();

  const runFromFreeText = async (text: string) => {
    userSay(text);
    sendBtn.disabled = true;
    sendBtn.textContent = 'PROCESSING…';
    try {
      // parse free text into symptom IDs for the deterministic rule engine
      const parsed = await llm.parse(text);
      if (parsed.material) appState.material = parsed.material;
      addSymptoms(parsed.symptoms as SymptomId[]);
      if (parsed.symptoms.length === 0) {
        const fallback = await new HeuristicNlu().parse(text);
        addSymptoms(fallback.symptoms as SymptomId[]);
      }
      if (parsed.emphasis?.length) appState.emphasized = new Set(parsed.emphasis as SymptomId[]);
      updateEvidence();

      const emphasized = parsed.emphasis?.length ? parsed.emphasis.join(', ') : '';
      await sendTurn(
        text,
        emphasized ? `Understood - I will weigh ${emphasized} more heavily.` : template('acknowledge'),
        true,
      );
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = 'ANALYZE';
    }
  };

  sendBtn.onclick = () => {
    const t = input.value.trim();
    if (!t) return;
    input.value = '';
    input.style.height = 'auto'; // collapse back to one row after submit
    runFromFreeText(t);
  };
  input.addEventListener('keydown', (e) => {
    // Enter submits; Shift+Enter inserts a newline
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendBtn.click();
    }
  });

  const feedVision = async (r: VisionResult) => {
    if (!r.board) return;
    const syms = boardClassToSymptoms(r.board.dominantDefect) as SymptomId[];
    addSymptoms(syms);
    appState.lastImage = {
      label: r.label,
      board: r.board,
      quality: r.quality,
      imageUrl: r.imageUrl,
      analysis: r.analysis,
    };
    updateEvidence();

    // a new board starts a fresh consultation
    conversationHistory = [];
    chatPhase = 'discovery';
    diagnosed = false;
    lastAnalysis = r.analysis ?? null;
    lastRuleEngine = null;
    lastSimilar = null;
    appState.lastSimilarCases = undefined;
    appState.lastConfirmedCause = undefined;
    appState.fixNote = undefined;
    appState.caseRecordId = undefined;
    appState.caseId = undefined;

    // pull similar historical cases using the vision defect type
    if (r.analysis) {
      const ds = r.analysis.defect_summary;
      const defectType = ds['Less Paste'] > 0 ? 'Less Paste' : ds.Bridging > 0 ? 'Bridging' : null;
      if (defectType) {
        try {
          lastSimilar = await getSimilarCases(defectType);
        } catch {
          lastSimilar = null;
        }
      }
    }

    // a zero-leg result means the image is not a usable board shot
    const noBoard = r.analysis
      ? r.analysis.total_legs_detected === 0
      : r.board
        ? r.board.pads.length === 0
        : false;

    userSay(noBoard
      ? '[Image] analyzed: no board detected'
      : `[Board] analyzed: ${r.board.dominantDefect.toUpperCase()}`);
    // kick off the Gemini consultation (not counted as an engineer turn)
    await sendTurn(
      noBoard
        ? 'The vision system found 0 legs in the supplied image, so no board was detected. Tell the engineer plainly that no board was detected in the image, that the defect counts are therefore meaningless (not a clean board), and ask them to supply a clearer board photo or offer to continue from their description alone. Do not invent defect counts.'
        : 'The vision system just analyzed a board and the result is in your context. Begin the consultation and ask your first question.',
      noBoard
        ? 'No board was detected in that image, so no inspection result is available. Please upload a clearer, straight-on board photo - or describe the problem in your own words and I will work from that.'
        : template('image-cross-ref'),
      false,
    );
  };

  renderDiagnosis(diagBody, undefined, undefined);
  appState.lastEngineLabel = 'Gemini API';
  aiSay(template('welcome'), true);
}


export function renderDiagnosis(
  body: HTMLElement,
  report: ReturnType<typeof runDiagnosis> | undefined,
  actions: ReturnType<typeof buildActionPlan> | undefined,
): void {
  clear(body);
  if (!report || !actions) {
    body.appendChild(el('div', 'empty-state', 'Select a board to begin inspection'));
    return;
  }

  const d = report.defect;
  const analysis = appState.lastImage?.analysis;

  // stable id for this diagnosis session so SAVE CASE and the ✓ button update
  // ONE case record (same case number) instead of appending new ones
  const sessionCaseId = (): string => {
    if (!appState.caseId) {
      const raw = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      appState.caseId = raw.replace(/-/g, '').slice(0, 12);
    }
    return appState.caseId;
  };

  // ---- Vision evidence strip (only when a board analysis exists) ----
  if (analysis) {
    const ds = analysis.defect_summary;
    const total = analysis.total_legs_detected;
    const quality = total
      ? Math.round((ds.Good / total) * 100)
      : appState.lastImage?.quality?.overall ?? 0;

    const isPass = analysis.board_verdict === 'PASS';
    const strip = el('div', isPass ? 'vision-strip strip-pass' : 'vision-strip strip-fail');
    const item = (label: string, value: string, valueCls = '') => {
      const cell = el('div', 'stat-item');
      cell.appendChild(el('div', 'stat-label', label));
      cell.appendChild(el('div', valueCls ? `stat-value ${valueCls}` : 'stat-value', value));
      strip.appendChild(cell);
    };
    item('Board verdict', analysis.board_verdict, isPass ? 'verdict-pass' : 'verdict-fail');
    item('Less paste', `${ds['Less Paste']} legs`);
    item('Bridging', `${ds.Bridging} legs`);
    item('Good', `${ds.Good} legs`);
    item('Quality score', total ? `${quality} / 100` : 'not measured');
    body.appendChild(strip);
  }

  const hero = el('div', 'diag-hero');
  hero.appendChild(el('div', 'kicker', 'Identified dispensing defect'));
  hero.appendChild(el('h2', '', d.defectName));
  hero.appendChild(el('p', '', d.defectDescription));
  const conf = el('div', 'confidence-row');
  conf.appendChild(el('span', 'confidence-label', 'Defect confidence'));
  conf.appendChild(el('span', 'confidence-value', `${(d.defectConfidence * 100).toFixed(0)}%`));
  if (isLowConfidence(d.defectConfidence, report.activeSymptoms.length)) {
    conf.appendChild(el('span', 'low-conf-badge', 'Low confidence - limited evidence'));
  }
  hero.appendChild(conf);
  body.appendChild(hero);

  // ---- Ranking details (why + ranked causes), collapsed by default ----
  const causeRows = d.causes.slice(0, 5);
  const ranking = collapsibleSection({
    title: 'Ranking details',
    badge: `${causeRows.length} causes ranked`,
    open: diagSectionState.ranking,
    onToggle: (open) => { diagSectionState.ranking = open; },
  });
  ranking.inner.appendChild(el('p', 'acc-reasoning', d.reasoning));

  const causesSection = el('div', 'causes-block');
  causesSection.appendChild(el('div', 'question-label', 'Possible causes'));
  causeRows.forEach((c, i) => {
    const row = el('div', 'bar-row');
    const nameCell = el('div', 'name');
    nameCell.appendChild(el('b', '', c.name));
    nameCell.appendChild(el('div', '', c.category));
    // additively flag a top cause that is not really evidenced (no ranking change)
    if (i === 0 && c.score < LOW_TOP_CAUSE_SCORE) {
      nameCell.appendChild(el('div', 'low-conf-note', 'Weak evidence'));
    }
    row.appendChild(nameCell);
    const track = el('div', 'bar-track');
    const fill = el('div', 'bar-fill');
    fill.style.width = `${Math.max(4, c.score * 100)}%`;
    if (c.score >= 0.75) fill.classList.add('amber');
    if (c.score >= 0.9) fill.classList.add('red');
    track.appendChild(fill);
    row.appendChild(track);
    row.appendChild(el('div', 'pct', `${(c.score * 100).toFixed(0)}%`));
    causesSection.appendChild(row);
  });
  ranking.inner.appendChild(causesSection);
  body.appendChild(ranking.root);

  // defect type used to fetch related historical cases
  const defectType = analysis
    ? analysis.defect_summary['Less Paste'] > 0
      ? 'Less Paste'
      : analysis.defect_summary.Bridging > 0
        ? 'Bridging'
        : null
    : null;

  // ---- Related historical cases (collapsible; summary stays visible) ----
  if (defectType) {
    const related = collapsibleSection({
      title: 'Related cases',
      open: diagSectionState.related,
      onToggle: (open) => { diagSectionState.related = open; },
      withSummary: true,
    });
    body.appendChild(related.root);

    // fetch in the background with a 1s cap
    Promise.race([
      getSimilarCases(defectType),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('similar-cases timeout')), 1000),
      ),
    ])
      .then((sc) => {
        // remember the historical data for the PDF report
        appState.lastSimilarCases = {
          total: sc.total_cases,
          most_common_cause: sc.most_common_cause,
          message: sc.message,
          defect_type: sc.defect_type,
        };
        if (!related.root.isConnected) return;
        if (!sc.total_cases) {
          related.root.remove();
          return;
        }
        // short summary stays visible even while the section is collapsed
        related.setSummary(sc.message);
        const chart = el('div', 'trend');
        related.inner.appendChild(chart);
        renderCaseTimeline(chart, defectType, d.causes[0]?.name ?? null);
      })
      .catch(() => {
        related.root.remove();
      });
  }

  body.appendChild(el('div', 'section-divider'));

  // ---- Action plan ----
  const actionSection = el('div', 'diag-section');
  actionSection.appendChild(el('div', 'question-label', 'Recommended troubleshooting sequence'));
  const actionList = el('div', 'action-list');
  for (const a of actions) {
    const step = el('div', 'action-step');
    step.appendChild(el('div', 'num', `${a.order}`));
    const txt = el('div', '');
    txt.appendChild(el('div', 'title', a.title));
    txt.appendChild(el('div', 'detail', a.detail));
    step.appendChild(txt);
    actionList.appendChild(step);
  }
  actionSection.appendChild(actionList);
  body.appendChild(actionSection);

  body.appendChild(el('div', 'section-divider'));

  // ---- Engineer feedback (stays interactive after saving) ----
  const fb = el('div', 'feedback diag-section');
  fb.appendChild(el('div', 'flabel', 'What actually fixed it? (feeds learning database)'));
  fb.appendChild(el('div', 'feedback-help', 'Pick the cause that resolved it, then press Save to Case Log. The note is optional.'));

  const noteDrafts = new Map<string, string>();
  let chosenCauseId: string | null = null;
  let savedCauseId: string | null = null;
  let savedNote = '';

  const fixInput = el('input', 'freetext-input') as HTMLInputElement;
  fixInput.placeholder = 'What actually fixed it? (optional)';
  fixInput.setAttribute('aria-label', 'What actually fixed it');
  fixInput.value = noteDrafts.get('') ?? '';
  fixInput.addEventListener('input', () => {
    noteDrafts.set(currentKey(), fixInput.value);
    appState.fixNote = fixInput.value.trim() || undefined;
    updateStatus();
    syncSaveBtn();
  });
  fb.appendChild(fixInput);

  const causeOptions = d.causes.slice(0, 5);
  const chips = el('div', 'chips');
  const chipButtons: HTMLButtonElement[] = [];
  const status = el('div', 'nlu-note', '');
  status.setAttribute('aria-live', 'polite');

  const currentKey = (): string => chosenCauseId ?? '';
  const isDirty = (): boolean => chosenCauseId !== savedCauseId || fixInput.value !== savedNote;
  const updateStatus = (): void => {
    if (!chosenCauseId) return;
    const name = appState.lastConfirmedCause ?? chosenCauseId;
    if (savedCauseId) {
      status.innerHTML = isDirty()
        ? `Selected: ${name}. <b style="color:var(--warn)">Unsaved change</b> - press Save to Case Log to update.`
        : `<b style="color:var(--status-good)">✓ Case saved to the log.</b> Confirmed: ${name}.`;
    } else {
      status.textContent = `Selected: ${name} - press Save to Case Log to record it.`;
    }
  };
  const syncSaveBtn = (): void => {
    saveBtn.textContent = savedCauseId !== null && !isDirty()
      ? 'Case saved'
      : 'Save to Case Log';
  };

  // one upsert path for both the ✓ chips and SAVE CASE -> same case number
  const persistCase = async (): Promise<number> => {
    // snapshot the current 8D report fields so the case keeps its own copy
    const reportData = reportDataSnapshot();
    const id = await upsertCase({
      id: appState.caseRecordId,
      timestamp: Date.now(),
      material: appState.material ?? '',
      defectId: d.defectId,
      symptoms: [...appState.symptoms],
      topCause: d.causes[0].causeId,
      resolvedCause: (chosenCauseId ?? undefined) as never,
      rankedCauses: d.causes.map((c) => ({ causeId: c.causeId, score: c.score })),
      actionPlan: actions.map((a) => a.title),
      notes: appState.fixNote,
      reportData: reportData ?? undefined,
    });
    appState.caseRecordId = id;

    const chosenName = chosenCauseId
      ? d.causes.find((c) => c.causeId === chosenCauseId)?.name ?? chosenCauseId
      : null;
    fetch(`${BASE_URL}/cases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_path: appState.lastImage?.analysis?.image_path ?? 'unknown',
        analysis_result: appState.lastImage?.analysis ?? {},
        ranked_causes: d.causes.map((c) => ({
          cause: c.causeId,
          score: c.score,
          reasons: c.reasons,
        })),
        action_plan: actions.map((a) => a.title),
        case_id: sessionCaseId(),
        engineer_feedback: {
          actual_cause: chosenName ?? appState.fixNote ?? null,
          confirmed_defects: chosenName ? [d.defectId] : [],
          notes: appState.fixNote ?? (chosenName ? 'Confirmed via engineer feedback button' : 'Saved without confirmation'),
        },
        report_data: reportData ?? undefined,
      }),
    }).catch((err) => console.warn('case sync to server failed', err));

    // refresh the report's counts without rebuilding the pane (keeps typed values)
    refreshReportTab();
    return id;
  };

  // Selecting a cause does NOT persist - it only stages the choice until SAVE.
  const selectCause = (causeId: string) => {
    const prevKey = currentKey();
    noteDrafts.set(prevKey, fixInput.value);
    // text typed before a cause was picked carries into the first selection
    if (prevKey === '' && !noteDrafts.has(causeId) && fixInput.value) {
      noteDrafts.set(causeId, fixInput.value);
    }
    chosenCauseId = causeId;
    appState.lastConfirmedCause = d.causes.find((c) => c.causeId === causeId)?.name ?? causeId;
    chipButtons.forEach((b) => b.classList.toggle('selected', b.dataset.causeId === causeId));
    fixInput.value = noteDrafts.get(causeId) ?? '';
    appState.fixNote = fixInput.value.trim() || undefined;
    updateStatus();
    syncSaveBtn();
  };
  for (const c of causeOptions) {
    const b = button(`✓ ${c.name}`, 'btn sm ghost', () => selectCause(c.causeId));
    b.dataset.causeId = c.causeId;
    chipButtons.push(b);
    chips.appendChild(b);
  }
  fb.appendChild(chips);
  fb.appendChild(status);
  body.appendChild(fb);

  const row = el('div', 'freetext-row');
  const saveBtn = button('Save to Case Log', 'btn', async () => {
    if (!chosenCauseId) {
      status.textContent = 'Select the cause that fixed it, then press Save to Case Log.';
      syncSaveBtn();
      return;
    }
    try {
      await persistCase();
      savedCauseId = chosenCauseId;
      savedNote = fixInput.value;
      syncSaveBtn();
      updateStatus();
      // stays enabled: saving again (after selecting a different cause) updates the SAME case
    } catch (err) {
      console.error('Save to Case Log failed', err);
      status.textContent = 'Could not save the case. See console for details.';
    }
  });
  const reportBtn = button('Open Report', 'btn primary', () => {
    refreshReportTab();
    switchTab('troubleshoot');
    switchWorkbenchView('report');
  });
  const newSessionBtn = button('Start New Session', 'btn ghost', () => {
    const host = document.getElementById('workbench-inspect');
    if (host) renderTroubleshoot(host);
  });
  row.appendChild(saveBtn);
  row.appendChild(reportBtn);
  row.appendChild(newSessionBtn);
  body.appendChild(row);
}

export function switchTab(name: string): void {
  document.querySelectorAll('.nav-tab').forEach((t) => {
    const active = t.getAttribute('data-tab') === name;
    t.classList.toggle('active', active);
    t.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.querySelectorAll('.tab-pane').forEach((p) => {
    const active = p.id === `tab-${name}`;
    p.classList.toggle('hidden', !active);
    if (!active) p.setAttribute('aria-hidden', 'true');
    else p.removeAttribute('aria-hidden');
  });
}