import { MATERIALS } from '../engine/knowledgeBase';
import { runDiagnosis } from '../engine/scorer';
import { buildActionPlan } from '../engine/actions';
import type { SymptomId } from '../engine/types';
import { appState, addSymptoms, resetState } from './state';
import { el, clear, button, panel } from './dom';
import { LlmRouter, HeuristicNlu } from '../nlu/llmRouter';
import { getAllCases, priorOverrides, upsertCase } from '../db/caseDB';
import { renderReportTab } from './report';
import { createInspectionPanel, type VisionResult } from './vision';
import { boardClassToSymptoms } from '../vision/qualityScore';
import { template } from './templates';
import {
  BASE_URL,
  chat,
  fetchServerCasesAsIdbFormat,
  getSimilarCases,
  type AnalysisResult,
  type ChatMessage,
  type ChatPhase,
  type ChatResponse,
  type RuleEngineResult,
  type SimilarCasesResult,
} from '../api/pipeline';

const llm = new LlmRouter();

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
  const chatPanel = panel('Assistant');
  chatPanel.classList.add('chat-sticky');
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
    renderReportTab(document.getElementById('tab-report') as HTMLElement);
  };

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
    // bring the diagnosis conversation into view automatically
    switchTab('troubleshoot');
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

  const reason = el('div', 'reasoning diag-section');
  reason.appendChild(el('div', 'rlabel', 'Why this ranking'));
  reason.appendChild(el('p', '', d.reasoning));
  body.appendChild(reason);

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
  body.appendChild(causesSection);

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
    body.appendChild(scDivider);
    scBlock = el('div', 'similar-cases');
    body.appendChild(scBlock);

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
        scBlock.appendChild(el('div', 'sc-label', 'Historical cases'));
        scBlock.appendChild(el('div', 'sc-text', sc.message));
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
  fb.appendChild(el('div', 'feedback-help', 'Pick the cause that resolved it, or type what fixed it. Optional.'));

  const fixInput = el('input', 'freetext-input') as HTMLInputElement;
  fixInput.placeholder = 'What actually fixed it? (optional)';
  fixInput.setAttribute('aria-label', 'What actually fixed it');
  fixInput.value = appState.fixNote ?? '';
  fixInput.addEventListener('input', () => {
    appState.fixNote = fixInput.value.trim() || undefined;
  });
  fb.appendChild(fixInput);

  const causeOptions = d.causes.slice(0, 5);
  const chips = el('div', 'chips');
  const status = el('div', 'nlu-note', '');
  status.setAttribute('aria-live', 'polite');
  let chosenCauseId: string | null = null;

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

    renderReportTab(document.getElementById('tab-report') as HTMLElement);
    return id;
  };

  const chooseCause = async (causeId: string) => {
    try {
      chosenCauseId = causeId;
      appState.lastConfirmedCause = d.causes.find((c) => c.causeId === causeId)?.name ?? causeId;
      const cases = await getAllCases();
      const id = await persistCase();
      status.innerHTML = `<b style="color:var(--accent)">✓ Case #${id} saved.</b> Confirmed: ${appState.lastConfirmedCause}. Priors updated from ${cases.length} historical cases.`;
    } catch (err) {
      console.error('chooseCause failed', err);
      status.textContent = 'Could not save the case. See console for details.';
    }
  };
  for (const c of causeOptions) {
    const b = button(`✓ ${c.name}`, 'btn sm ghost', () => chooseCause(c.causeId));
    chips.appendChild(b);
  }
  fb.appendChild(chips);
  fb.appendChild(status);
  body.appendChild(fb);

  const row = el('div', 'freetext-row');
  const saveBtn = button('Save to Case Log', 'btn', async () => {
    try {
      const id = await persistCase();
      saveBtn.textContent = `Case #${id} saved`;
      // stays enabled: saving again updates the SAME case (upsert)
    } catch (err) {
      console.error('Save to Case Log failed', err);
      saveBtn.textContent = 'Save failed';
    }
  });
  const reportBtn = button('Open Report', 'btn primary', () => {
    renderReportTab(document.getElementById('tab-report') as HTMLElement);
    switchTab('report');
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