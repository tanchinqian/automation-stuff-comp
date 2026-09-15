import { MATERIALS } from '../engine/knowledgeBase';
import { runDiagnosis } from '../engine/scorer';
import { buildActionPlan } from '../engine/actions';
import type { SymptomId } from '../engine/types';
import { appState, addSymptoms, resetState } from './state';
import { el, clear, button, panel } from './dom';
import { LlmRouter, HeuristicNlu } from '../nlu/llmRouter';
import { getAllCases, priorOverrides, upsertCase } from '../db/caseDB';
import { renderReportTab } from './report';
import { getReportDrawerHost, openReportDrawer } from './reportDrawer';
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

/** One draggable surrounding node in the radial historical-case graph. */
interface NodeView {
  case: UnifiedCase;
  group: SVGGElement;
  circle: SVGCircleElement;
  label: SVGTextElement;
  line: SVGLineElement;
  slot: number;
  baseR: number;
  x: number;
  y: number;
  r: number;
  raf: number | null;
}

const SNAP_MS = 170;

/** cubic-bezier(0.16, 1, 0.3, 1) - the app's documented ease-standard curve. */
function cubicBezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const ax = 3 * x1 - 3 * x2 + 1;
  const bx = 3 * x2 - 6 * x1;
  const cx = 3 * x1;
  const ay = 3 * y1 - 3 * y2 + 1;
  const by = 3 * y2 - 6 * y1;
  const cy = 3 * y1;
  const sampleX = (t: number): number => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number): number => ((ay * t + by) * t + cy) * t;
  const sampleDX = (t: number): number => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number): number => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = sampleX(t) - x;
      if (Math.abs(err) < 1e-4) break;
      const d = sampleDX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    return sampleY(t);
  };
}
const snapEase = cubicBezier(0.16, 1, 0.3, 1);

/**
 * Inline radial graph: the current diagnosis at the centre, one node per
 * historical case returned by GET /cases/matching, arranged evenly on a
 * circle. Nodes whose confirmed cause matches the current top cause are
 * accent-filled; clicking one opens the shared case-detail panel; dragging
 * one reorders the circle (snapping to the nearest fixed slot, swapping with
 * whichever node occupies it).
 */
function renderHistoricalGraph(
  host: HTMLElement,
  defectType: string,
  topCause: string | null,
  expected: number,
): void {
  const count = Math.max(expected, 1);
  const radius = count <= 8 ? 120 : count <= 14 ? 145 : 165;
  const centerR = 11;
  const pad = 44;
  const size = 2 * (radius + 10 + pad);
  const cx = size / 2;
  const cy = size / 2;

  const svg = svgEl('svg', {
    viewBox: `0 0 ${size} ${size}`,
    class: 'rc-svg',
    role: 'img',
    'aria-label': `Historical cases graph for ${defectType}`,
  });
  host.appendChild(svg);

  // soft, low-opacity accent glow used to "lift" the node being dragged
  const defs = svgEl('defs');
  const glow = svgEl('filter', {
    id: 'rc-drag-glow', x: '-60%', y: '-60%', width: '220%', height: '220%',
  });
  glow.appendChild(svgEl('feDropShadow', {
    dx: 0, dy: 0, stdDeviation: 3, 'flood-color': '#2ee6a8', 'flood-opacity': 0.45,
  }));
  defs.appendChild(glow);
  svg.appendChild(defs);

  // centre = current case; pulses (existing .loading animation) while loading
  const center = svgEl('g', { class: 'rc-center loading' });
  center.appendChild(svgEl('circle', { cx, cy, r: centerR, class: 'rc-node-current' }));
  const centerLabel = svgEl('text', {
    x: cx, y: cy + centerR + 15, class: 'rc-nodelabel rc-current-label', 'text-anchor': 'middle',
  });
  centerLabel.textContent = 'Current';
  center.appendChild(centerLabel);
  svg.appendChild(center);

  const tip = el('div', 'rc-tip');
  host.appendChild(tip);
  const pop = el('div', 'rc-pop');
  host.appendChild(pop);

  const onDocClick = (e: MouseEvent) => {
    if (!pop.contains(e.target as Node)) closePop();
  };
  function closePop(): void {
    pop.classList.remove('show');
    document.removeEventListener('click', onDocClick);
  }

  const showTip = (ev: MouseEvent, text: string) => {
    const r = (ev.currentTarget as SVGGElement).getBoundingClientRect();
    const hr = host.getBoundingClientRect();
    tip.textContent = text;
    tip.style.left = `${r.left - hr.left + r.width / 2}px`;
    tip.style.top = `${r.top - hr.top}px`;
    tip.classList.add('show');
  };
  const hideTip = () => tip.classList.remove('show');

  const openPop = (group: SVGGElement, record: UnifiedCase) => {
    clear(pop);
    pop.appendChild(renderCaseCardDetail(record, {
      matchedBecause: `Matched because: same defect type (${defectType})`,
    }));
    const close = button('×', 'rc-close', () => closePop());
    close.setAttribute('aria-label', 'Close case detail');
    pop.appendChild(close);

    const r = group.getBoundingClientRect();
    const hr = host.getBoundingClientRect();
    pop.style.left = `${r.left - hr.left + r.width / 2}px`;
    pop.style.top = `${r.top - hr.top + r.height / 2}px`;
    pop.classList.add('show');
    setTimeout(() => document.addEventListener('click', onDocClick), 0);
  };

  // ---- Drag-to-reorder state + geometry helpers ----
  const nodes: NodeView[] = [];
  const slotPos: { x: number; y: number }[] = [];
  let drag: {
    nv: NodeView;
    pointerId: number;
    startX: number;
    startY: number;
    startTime: number;
  } | null = null;

  // write the current (x, y, r) of a node to its circle, label and edge
  const applyNode = (nv: NodeView): void => {
    nv.circle.setAttribute('cx', String(nv.x));
    nv.circle.setAttribute('cy', String(nv.y));
    nv.circle.setAttribute('r', String(nv.r));
    nv.label.setAttribute('x', String(nv.x));
    nv.label.setAttribute('y', String(nv.y + nv.r + 11));
    nv.line.setAttribute('x2', String(nv.x));
    nv.line.setAttribute('y2', String(nv.y));
  };

  // ease the node (circle + label + edge, together) to a target position
  const tweenPos = (nv: NodeView, tx: number, ty: number, tr: number, dur: number): void => {
    if (nv.raf) cancelAnimationFrame(nv.raf);
    const sx = nv.x; const sy = nv.y; const sr = nv.r;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min((now - start) / dur, 1);
      const e = snapEase(t);
      nv.x = sx + (tx - sx) * e;
      nv.y = sy + (ty - sy) * e;
      nv.r = sr + (tr - sr) * e;
      applyNode(nv);
      nv.raf = t < 1 ? requestAnimationFrame(step) : null;
    };
    nv.raf = requestAnimationFrame(step);
  };

  // nearest fixed angular slot to an angle (slots are evenly spaced)
  const nearestSlot = (ang: number): number => {
    let best = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < slotPos.length; i++) {
      const a = (Math.PI * 2 * i) / slotPos.length - Math.PI / 2;
      let d = ang - a;
      d = Math.atan2(Math.sin(d), Math.cos(d)); // normalise to [-pi, pi]
      const ad = Math.abs(d);
      if (ad < bestDiff) { bestDiff = ad; best = i; }
    }
    return best;
  };

  // client (screen) coords -> SVG viewBox user units
  const toSvg = (clientX: number, clientY: number): { x: number; y: number } => {
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: clientX, y: clientY };
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };

  const finishDrag = (
    group: SVGGElement,
    nv: NodeView,
    clientX: number,
    clientY: number,
    pointerId: number,
    allowClick: boolean,
  ): void => {
    const dt = performance.now() - (drag?.startTime ?? performance.now());
    const dx = clientX - (drag?.startX ?? clientX);
    const dy = clientY - (drag?.startY ?? clientY);
    try { group.releasePointerCapture(pointerId); } catch { /* capture already gone */ }
    group.classList.remove('dragging');
    drag = null;

    // a quick, near-stationary press is a click, not a drag
    if (allowClick && Math.hypot(dx, dy) < 4 && dt < 200) {
      openPop(group, nv.case);
      return;
    }

    const ang = Math.atan2(nv.y - cy, nv.x - cx);
    const target = nearestSlot(ang);
    if (target === nv.slot) {
      // dropped near its own slot - just settle back
      tweenPos(nv, slotPos[nv.slot].x, slotPos[nv.slot].y, nv.baseR, SNAP_MS);
      return;
    }
    // swap with whichever node currently occupies the target slot
    const other = nodes.find((n) => n !== nv && n.slot === target);
    if (other) {
      other.slot = nv.slot;
      tweenPos(other, slotPos[other.slot].x, slotPos[other.slot].y, other.baseR, SNAP_MS);
    }
    nv.slot = target;
    tweenPos(nv, slotPos[target].x, slotPos[target].y, nv.baseR, SNAP_MS);
  };

  void (async () => {
    let cases: UnifiedCase[];
    try {
      const res = await getMatchingCases(defectType);
      cases = unifiedFromServerCases(res.cases);
    } catch {
      host.remove(); // endpoint unreachable - keep the text summary only
      return;
    }
    if (!host.isConnected || cases.length === 0) {
      host.remove();
      return;
    }
    center.classList.remove('loading');

    // fixed, evenly-spaced angular slots (positions never move; nodes swap)
    for (let i = 0; i < cases.length; i++) {
      const a = (Math.PI * 2 * i) / cases.length - Math.PI / 2;
      slotPos.push({ x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) });
    }

    const times = cases.map((c) => c.timestamp).filter((t) => t > 0);
    const maxTs = times.length ? Math.max(...times) : 0;
    const minTs = times.length ? Math.min(...times) : 0;
    const span = Math.max(maxTs - minTs, 1);
    const matchKey = (topCause ?? '').toLowerCase();

    cases.forEach((c, i) => {
      const pos = slotPos[i];
      const recency = times.length ? (c.timestamp - minTs) / span : 0.5;
      const baseR = 5.5 + recency * 2.5;
      const isMatch = !!c.resolvedCause && c.resolvedCause.toLowerCase() === matchKey;
      const causeName = c.resolvedCause ?? 'No confirmed cause';

      const line = svgEl('line', { x1: cx, y1: cy, x2: pos.x, y2: pos.y, class: 'rc-edge' });
      svg.appendChild(line);

      const group = svgEl('g', {
        class: 'rc-nodegroup',
        tabindex: 0,
        role: 'button',
        'aria-label': `${c.idLabel}: ${causeName}`,
      });
      const circle = svgEl('circle', { cx: pos.x, cy: pos.y, r: baseR, class: isMatch ? 'rc-node match' : 'rc-node' });
      group.appendChild(circle);
      const idLabel = svgEl('text', { x: pos.x, y: pos.y + baseR + 11, class: 'rc-nodelabel', 'text-anchor': 'middle' });
      idLabel.textContent = c.idLabel;
      group.appendChild(idLabel);

      const nv: NodeView = {
        case: c, group, circle, label: idLabel, line,
        slot: i, baseR, x: pos.x, y: pos.y, r: baseR, raf: null,
      };
      nodes.push(nv);

      group.addEventListener('mouseenter', (ev) => showTip(ev, `${c.idLabel} · ${causeName}`));
      group.addEventListener('mouseleave', hideTip);
      group.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openPop(group, c); }
      });
      // click-to-open is resolved in pointerup (drag vs click); this only keeps
      // the synthetic click from reaching the outside-click popover dismisser
      group.addEventListener('click', (ev) => ev.stopPropagation());

      group.addEventListener('pointerdown', (ev) => {
        if (drag) return;
        hideTip();
        if (nv.raf) { cancelAnimationFrame(nv.raf); nv.raf = null; }
        svg.appendChild(group); // paint order: raise above the other nodes
        try { group.setPointerCapture(ev.pointerId); } catch { /* ignore */ }
        drag = { nv, pointerId: ev.pointerId, startX: ev.clientX, startY: ev.clientY, startTime: performance.now() };
        group.classList.add('dragging');
        nv.r = nv.baseR + 2; // subtle lift
        applyNode(nv);
      });
      group.addEventListener('pointermove', (ev) => {
        if (!drag || drag.nv !== nv || ev.pointerId !== drag.pointerId) return;
        const p = toSvg(ev.clientX, ev.clientY);
        nv.x = p.x;
        nv.y = p.y;
        applyNode(nv);
      });
      group.addEventListener('pointerup', (ev) => {
        if (!drag || drag.nv !== nv || ev.pointerId !== drag.pointerId) return;
        finishDrag(group, nv, ev.clientX, ev.clientY, ev.pointerId, true);
      });
      group.addEventListener('pointercancel', (ev) => {
        if (!drag || drag.nv !== nv || ev.pointerId !== drag.pointerId) return;
        finishDrag(group, nv, ev.clientX, ev.clientY, ev.pointerId, false);
      });

      svg.appendChild(group);
    });
  })();
}

export function renderTroubleshoot(host: HTMLElement): void {
  clear(host);
  resetState();
  const layout = el('div', 'layout workspace');
  host.appendChild(layout);

  // ---- Main column: inspection + diagnosis ----
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

  // ---- Sidebar: assistant chat ----
  // Collapsible dock: starts as a narrow rail (an operator console shouldn't
  // give a chatbot equal billing with the inspection/diagnosis workflow by
  // default) and expands on demand, or automatically once the assistant has
  // something proactive to say (see feedVision below).
  const chatPanel = panel('Assistant');
  chatPanel.classList.add('chat-sticky');
  const chatHead = chatPanel.querySelector('.panel-head')! as HTMLElement;
  const chatToggle = el('button', 'chat-toggle') as HTMLButtonElement;
  chatToggle.type = 'button';
  const chatToggleIcon = el('span', 'chat-toggle-icon', '▸');
  const chatToggleLabel = el('span', 'chat-toggle-label', 'Assistant chat');
  chatToggle.appendChild(chatToggleIcon);
  chatToggle.appendChild(chatToggleLabel);
  chatToggle.setAttribute('aria-label', 'Expand or collapse the assistant chat');
  chatToggle.setAttribute('aria-expanded', 'false');
  chatHead.appendChild(chatToggle);
  const setChatOpen = (open: boolean): void => {
    layout.classList.toggle('chat-open', open);
    chatToggle.setAttribute('aria-expanded', String(open));
    chatToggleIcon.textContent = open ? '◂' : '▸';
  };
  chatToggle.onclick = () => setChatOpen(!layout.classList.contains('chat-open'));
  const chatBody = chatPanel.querySelector('.panel-body')! as HTMLElement;

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
  layout.appendChild(chatPanel);

  // ---- Conversation state (Gemini-backed discovery) ----
  let conversationHistory: ChatMessage[] = [];
  let chatPhase: ChatPhase = 'discovery';
  let lastAnalysis: AnalysisResult | null = null;
  let lastRuleEngine: RuleEngineResult | null = null;
  let lastSimilar: SimilarCasesResult | null = null;
  let diagnosed = false;

  const aiSay = (text: string, html = false) => {
    const m = el('div', 'msg ai');
    m.appendChild(el('div', 'avatar', 'DA'));
    const b = el('div', 'bubble');
    if (html) b.innerHTML = text;
    else b.textContent = text;
    m.appendChild(b);
    chatLog.appendChild(m);
    chatLog.scrollTop = chatLog.scrollHeight;
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
    renderReportTab(getReportDrawerHost());
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

    // 5. reveal results and focus the workbench
    renderDiagnosisFor(report, actions);
    updateEvidence();
    switchTab('troubleshoot');
    chatPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const demoBtn = button('Load demo', 'btn sm ghost');
  demoBtn.style.marginLeft = 'auto';
  demoBtn.title = 'Skip setup: analyze the first board and load a completed diagnosis';
  demoBtn.onclick = () => { void loadDemoSession(); };
  chatPanel.querySelector('.panel-head')!.appendChild(demoBtn);

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
    thinking.appendChild(el('div', 'avatar', 'DA'));
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

    userSay(`[Board] analyzed: ${r.board.dominantDefect.toUpperCase()}`);
    // bring the diagnosis conversation into view automatically - the
    // assistant has something proactive to say, so expand the dock
    switchTab('troubleshoot');
    setChatOpen(true);
    chatPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // kick off the Gemini consultation (not counted as an engineer turn)
    await sendTurn(
      'The vision system just analyzed a board and the result is in your context. Begin the consultation and ask your first question.',
      template('image-cross-ref'),
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
    body.appendChild(el('div', 'empty-state', ''));
    const e = body.lastChild as HTMLElement;
    e.innerHTML = '<div class="big">◆-◆</div><div>Select a board to begin inspection</div>';
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

    const strip = el('div', 'vision-strip');
    const item = (label: string, value: string, valueCls = '') => {
      const cell = el('div', 'stat-item');
      cell.appendChild(el('div', 'stat-label', label));
      cell.appendChild(el('div', valueCls ? `stat-value ${valueCls}` : 'stat-value', value));
      strip.appendChild(cell);
    };
    const isPass = analysis.board_verdict === 'PASS';
    item('Board verdict', analysis.board_verdict, isPass ? 'verdict-pass' : 'verdict-fail');
    item('Less paste', `${ds['Less Paste']} legs`);
    item('Bridging', `${ds.Bridging} legs`);
    item('Good', `${ds.Good} legs`);
    item('Quality score', `${quality} / 100`);
    body.appendChild(strip);
  }

  const hero = el('div', 'diag-hero');
  hero.appendChild(el('div', 'kicker', 'Identified dispensing defect'));
  hero.appendChild(el('h2', '', d.defectName));
  hero.appendChild(el('p', '', d.defectDescription));
  const conf = el('div', 'confidence-row');
  conf.appendChild(el('span', 'confidence-label', 'Defect confidence'));
  conf.appendChild(el('span', 'confidence-value', `${(d.defectConfidence * 100).toFixed(0)}%`));
  hero.appendChild(conf);
  body.appendChild(hero);

  // ---- Analysis details: reasoning + ranked causes + historical cases,
  // grouped under one collapsible disclosure (closed by default) so the
  // panel opens on the defect identity + action plan, not a wall of text.
  const analysisDetails = el('details', 'diag-collapse');
  analysisDetails.open = false;
  const analysisSummary = el('summary', 'diag-collapse-summary', 'Analysis details (ranking, reasoning, historical cases)');
  analysisDetails.appendChild(analysisSummary);
  body.appendChild(analysisDetails);

  const reason = el('div', 'reasoning diag-section');
  reason.appendChild(el('div', 'rlabel', 'Why this ranking'));
  reason.appendChild(el('p', '', d.reasoning));
  analysisDetails.appendChild(reason);

  // ---- Ranked causes ----
  const causesSection = el('div', 'diag-section');
  causesSection.appendChild(el('div', 'question-label', 'Possible causes'));
  for (const c of d.causes.slice(0, 5)) {
    const row = el('div', 'bar-row');
    const nameCell = el('div', 'name');
    nameCell.appendChild(el('b', '', c.name));
    nameCell.appendChild(el('div', '', c.category));
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
  }
  analysisDetails.appendChild(causesSection);

  // ---- Similar historical cases (async, non-blocking) ----
  const defectType = analysis
    ? analysis.defect_summary['Less Paste'] > 0
      ? 'Less Paste'
      : analysis.defect_summary.Bridging > 0
        ? 'Bridging'
        : null
    : null;

  let scBlock: HTMLElement | null = null;
  let scDivider: HTMLElement | null = null;
  if (defectType) {
    scDivider = el('div', 'section-divider');
    analysisDetails.appendChild(scDivider);
    scBlock = el('div', 'similar-cases');
    analysisDetails.appendChild(scBlock);

    // insert placeholder already done; fetch in the background with a 1s cap
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
        if (!scBlock || !scBlock.isConnected) return;
        if (!sc.total_cases) {
          scBlock.remove();
          scDivider?.remove();
          return;
        }
        scBlock.appendChild(el('div', 'sc-label', 'Historical cases - confirmed cause breakdown'));
        scBlock.appendChild(el('div', 'sc-text', sc.message));

        // confirmed-cause frequency chart - reuses the same bar idiom as the
        // ranked-causes "Cause Tree" above, so this reads as one visual
        // language instead of a second chart type.
        const entries = Object.entries(sc.confirmed_causes ?? {}).sort((a, b) => b[1] - a[1]);
        if (entries.length) {
          const chartWrap = el('div', 'sc-bars');
          for (const [name, count] of entries) {
            const pct = sc.total_cases ? Math.round((count / sc.total_cases) * 100) : 0;
            const row = el('div', 'bar-row sc-bar-row');
            const nameCell = el('div', 'name');
            nameCell.appendChild(el('b', '', name));
            row.appendChild(nameCell);
            const track = el('div', 'bar-track');
            const fill = el('div', 'bar-fill');
            fill.style.width = `${Math.max(4, pct)}%`;
            track.appendChild(fill);
            row.appendChild(track);
            row.appendChild(el('div', 'pct', `${count} (${pct}%)`));
            chartWrap.appendChild(row);
          }
          scBlock.appendChild(chartWrap);
        }
      })
      .catch(() => {
        scBlock?.remove();
        scDivider?.remove();
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
        : `<b style="color:var(--accent)">✓ Case #${appState.caseRecordId ?? ''} saved.</b> Confirmed: ${name}.`;
    } else {
      status.textContent = `Selected: ${name} - press Save to Case Log to record it.`;
    }
  };
  const syncSaveBtn = (): void => {
    saveBtn.textContent = savedCauseId !== null && !isDirty()
      ? `Case #${appState.caseRecordId} saved`
      : 'Save to Case Log';
  };

  // one upsert path for both the ✓ chips and SAVE CASE -> same case number
  const persistCase = async (): Promise<number> => {
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
      }),
    }).catch((err) => console.warn('case sync to server failed', err));

    renderReportTab(getReportDrawerHost());
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
    openReportDrawer();
  });
  const newSessionBtn = button('Start New Session', 'btn ghost', () => {
    const host = document.getElementById('tab-troubleshoot');
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