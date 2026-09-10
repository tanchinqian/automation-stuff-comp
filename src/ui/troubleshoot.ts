import { BASE_QUESTIONS, FOLLOW_UPS, FOLLOW_UP_RULES, MATERIALS } from '../engine/knowledgeBase';
import { runDiagnosis } from '../engine/scorer';
import { buildActionPlan } from '../engine/actions';
import type { MaterialType, QuestionDef, SymptomId } from '../engine/types';
import { appState, addSymptoms, resetState } from './state';
import { el, clear, button, panel } from './dom';
import { LlmRouter, HeuristicNlu, type ChatContext } from '../nlu/llmRouter';
import { saveCase, getAllCases, priorOverrides } from '../db/caseDB';
import { renderReportTab } from './report';
import { createInspectionPanel, type VisionResult } from './vision';
import { boardClassToSymptoms } from '../vision/qualityScore';
import { template, acknowledgeTemplate, imageCrossTemplate } from './templates';

interface PendingQuestion {
  def: QuestionDef;
  next: string | null;
}

type Phase = 'welcome' | 'intake' | 'awaiting-image' | 'diagnosed';

const llm = new LlmRouter();

/** Which base questions are already answered by the current evidence. */
const ANSWERED_BY_SYMPTOMS: Partial<Record<string, SymptomId[]>> = {
  'q-material': [],
  'q-amount': ['amount-too-small', 'amount-too-large', 'inconsistent-size', 'missing-occasionally', 'missing-location', 'spread-beyond', 'shape-irregular'],
  'q-occurrence': ['occurrence-continuous', 'occurrence-occasional', 'occurrence-once'],
  'q-recent-change': ['recent-change-material', 'recent-change-nozzle', 'recent-change-parameter'],
  'q-location': ['single-location', 'multi-location'],
};

export function renderTroubleshoot(host: HTMLElement): void {
  clear(host);
  resetState();
  const layout = el('div', 'layout workspace');
  host.appendChild(layout);

  // ---- Main column: inspection + diagnosis ----
  const mainCol = el('div', 'main-col');
  layout.appendChild(mainCol);

  const diagPanel = panel('Diagnosis', 'live analysis');
  const diagBody = diagPanel.querySelector('.panel-body')! as HTMLElement;
  mainCol.appendChild(diagPanel);

  const vision = createInspectionPanel({
    onAnalyze: () => {
      aiSay('Frame analyzed - click <b>FEED TO DIAGNOSIS</b> on the left to use it as evidence.', true);
      updateEvidence();
    },
    onFeed: (r: VisionResult) => {
      feedVision(r);
    },
  });
  mainCol.insertBefore(vision.panel, diagPanel);

  // ---- Sidebar: AI assistant chat ----
  const chatPanel = panel('AI Assistant', 'intake + free-text NLU');
  chatPanel.classList.add('chat-sticky');
  const chatBody = chatPanel.querySelector('.panel-body')! as HTMLElement;

  const evidenceStrip = el('div', 'evidence-strip');
  chatBody.appendChild(evidenceStrip);

  const chatLog = el('div', 'chat-log');
  chatLog.setAttribute('aria-live', 'polite');
  const inputRow = el('div', 'freetext-row');
  const input = el('input', 'freetext-input') as HTMLInputElement;
  input.placeholder = 'Or describe the problem in your own words… (offline AI parses it)';
  input.setAttribute('aria-label', 'Describe the dispensing problem in your own words');
  input.setAttribute('autocomplete', 'off');
  const sendBtn = button('ANALYZE', 'btn primary');
  inputRow.appendChild(input);
  inputRow.appendChild(sendBtn);
  const nluNote = el('div', 'nlu-note', 'NLU: detecting local AI engine…');
  nluNote.setAttribute('aria-live', 'polite');
  chatBody.appendChild(chatLog);
  chatBody.appendChild(inputRow);
  chatBody.appendChild(nluNote);
  layout.appendChild(chatPanel);

  // ---- Conversation state ----
  let phase: Phase = 'welcome';
  const queue: PendingQuestion[] = [];
  let followUpsAsked = 0;
  let questionCount = 0;

  const isAnswered = (qid: string): boolean => {
    if (qid === 'q-material') return !!appState.material;
    const syms = ANSWERED_BY_SYMPTOMS[qid] ?? [];
    return syms.some((s) => appState.symptoms.has(s));
  };

  const aiSay = (text: string, html = false) => {
    const m = el('div', 'msg ai');
    m.appendChild(el('div', 'avatar', 'AI'));
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

  // ---- Natural-language replies: LLM when available, template fallback ----
  const aiRespond = async (ctx: ChatContext, fallback: string) => {
    const thinking = el('div', 'msg ai');
    thinking.appendChild(el('div', 'avatar', 'AI'));
    thinking.appendChild(el('div', 'bubble loading', '…'));
    chatLog.appendChild(thinking);
    chatLog.scrollTop = chatLog.scrollHeight;
    const text = await Promise.race([
      llm.respond(ctx),
      new Promise<string | null>((res) => setTimeout(() => res(null), 4000)),
    ]);
    thinking.remove();
    aiSay(text ?? fallback, true);
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

  // ---- Image gate (block until image or skip) ----
  const showImageGate = () => {
    phase = 'awaiting-image';
    const m = el('div', 'msg ai');
    m.appendChild(el('div', 'avatar', 'AI'));
    const b = el('div', 'bubble');
    const gate = el('div', 'gate-notice');
    gate.appendChild(el('div', 'g-label', 'Action needed'));
    gate.appendChild(
      el('p', '', 'You have described the problem, but no inspection image yet. An image sharpens the diagnosis. Pick a board on the left, click ANALYZE BOARD, then FEED TO DIAGNOSIS. Or continue with text only.'),
    );
    const row = el('div', 'freetext-row');
    row.style.marginTop = '8px';
    row.appendChild(button('SKIP IMAGE', 'btn sm', async () => {
      appState.imageSkipped = true;
      userSay('Skip image - continue with text evidence');
      row.remove();
      await aiRespond({ intent: 'skip-ack' }, template('skip-ack'));
      await diagnose();
    }));
    gate.appendChild(row);
    b.appendChild(gate);
    m.appendChild(b);
    chatLog.appendChild(m);
    chatLog.scrollTop = chatLog.scrollHeight;
  };

  // ---- Adaptive intake ----
  const askQuestion = (q: QuestionDef) => {
    questionCount++;
    const block = el('div', 'question-block');
    block.appendChild(el('div', 'question-label', `QUESTION ${questionCount}`));
    block.appendChild(el('div', 'question-text', q.text));

    if (q.intent === 'single' && q.options) {
      const grid = el('div', 'opt-grid');
      for (const opt of q.options) {
        const chip = el('button', 'opt', opt.label) as HTMLButtonElement;
        chip.type = 'button';
        chip.onclick = async () => {
          userSay(opt.label);
          block.remove();
          // material question sets material from the option id
          if (q.id === 'q-material') appState.material = opt.id as MaterialType;
          addSymptoms(opt.adds);
          updateEvidence();
          const labelList = opt.adds.map((s) => s.replace(/-/g, ' '));
          await aiRespond({ intent: 'acknowledge', userText: opt.label, symptoms: labelList, material: appState.material ? MATERIALS[appState.material] : undefined }, acknowledgeTemplate({ intent: 'acknowledge', symptoms: labelList }));
          const follow = FOLLOW_UP_RULES.find((f) => f.questionId === q.id && f.answerId === opt.id);
          if (follow && followUpsAsked < 5) {
            const fu = FOLLOW_UPS.find((f) => f.id === follow.nextQuestionId);
            if (fu) {
              followUpsAsked++;
              queue.push({ def: fu, next: null });
              aiSay(`<span style="color:var(--accent)">Follow-up:</span> ${fu.text}`, true);
              askQuestion(fu);
              return;
            }
          }
          nextQuestion();
        };
        grid.appendChild(chip);
      }
      block.appendChild(grid);
    }
    chatLog.appendChild(block);
    chatLog.scrollTop = chatLog.scrollHeight;
  };

  const nextQuestion = () => {
    if (queue.length > 0) {
      const pq = queue.shift()!;
      askQuestion(pq.def);
      return;
    }
    // pick the next unanswered base question
    const next = BASE_QUESTIONS.find((q) => !isAnswered(q.id));
    if (next) {
      aiSay(next.text);
      askQuestion(next);
      return;
    }
    finishIntake();
  };

  const runFromFreeText = async (text: string) => {
    userSay(text);
    sendBtn.disabled = true;
    sendBtn.textContent = 'PROCESSING…';
    try {
      nluNote.innerHTML = 'NLU engine: parsing with <b>' + llm.engineLabel + '</b>…';
      let parsed = await llm.parse(text);
      if (parsed.material) appState.material = parsed.material;
      addSymptoms(parsed.symptoms as SymptomId[]);
      if (parsed.emphasis?.length) appState.emphasized = new Set(parsed.emphasis as SymptomId[]);
      nluNote.innerHTML = `NLU engine: <b>${llm.engineLabel}</b> · ${parsed.summary}`;
      if (parsed.symptoms.length === 0 && parsed.engine !== 'heuristic') {
        const fallback = await new HeuristicNlu().parse(text);
        addSymptoms(fallback.symptoms as SymptomId[]);
        nluNote.innerHTML += ' · fallback rules applied';
      }
      updateEvidence();
      const labelList = [...appState.symptoms].map((s) => s.replace(/-/g, ' '));
      const emphasized = parsed.emphasis?.length ? parsed.emphasis.map((s) => s.replace(/-/g, ' ')) : undefined;
      await aiRespond(
        { intent: 'acknowledge', userText: text, symptoms: labelList, emphasized, material: appState.material ? MATERIALS[appState.material] : undefined },
        `Understood - ${parsed.summary}${emphasized?.length ? ` I will weigh ${emphasized.join(', ')} more heavily.` : ''}`,
      );
      // continue asking remaining relevant questions, or finish if all answered
      if (BASE_QUESTIONS.every((q) => isAnswered(q.id))) {
        finishIntake();
      } else {
        nextQuestion();
      }
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = 'ANALYZE';
    }
  };

  sendBtn.onclick = () => {
    const t = input.value.trim();
    if (!t) return;
    input.value = '';
    runFromFreeText(t);
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendBtn.click();
  });

  const finishIntake = async () => {
    if (phase === 'diagnosed') return;
    phase = 'intake';
    updateEvidence();
    if (appState.lastImage || appState.imageSkipped) {
      aiSay('Analyzing your answers against the dispensing knowledge base…');
      await diagnose();
    } else {
      showImageGate();
    }
  };

  const diagnose = async () => {
    const cases = await getAllCases();
    const priors = priorOverrides(cases);
    const report = runDiagnosis(
      [...appState.symptoms],
      appState.material ? MATERIALS[appState.material] : '',
      priors,
      appState.emphasized ? [...appState.emphasized] : undefined,
    );
    appState.lastDiagnosis = report;
    appState.lastActions = buildActionPlan(report.defect.causes.map((c) => c.causeId));
    if (appState.lastImage?.quality) {
      report.qualityScore = appState.lastImage.quality.overall;
    }
    renderDiagnosis(diagBody, report, appState.lastActions);
    phase = 'diagnosed';
    updateEvidence();
    renderReportTab(document.getElementById('tab-report') as HTMLElement);
    const top = report.defect.causes[0];
    await aiRespond(
      {
        intent: 'diagnosis-announce',
        symptoms: report.activeSymptoms.map((s) => s.replace(/-/g, ' ')),
        image: appState.lastImage ? { className: appState.lastImage.board?.dominantDefect ?? 'board', quality: appState.lastImage.quality?.overall } : undefined,
        diagnosis: { defectName: report.defect.defectName, confidence: report.defect.defectConfidence, topCause: top?.name ?? 'unknown' },
      },
      `Diagnosis complete. Identified <b>${report.defect.defectName}</b> with ${(report.defect.defectConfidence * 100).toFixed(0)}% confidence. <br><span style="color:var(--ink-dim)">${report.defect.reasoning}</span>`,
    );
  };

  const feedVision = async (r: VisionResult) => {
    if (!r.board) return;
    const syms = boardClassToSymptoms(r.board.dominantDefect) as SymptomId[];
    addSymptoms(syms);
    appState.lastImage = {
      label: r.label,
      board: r.board,
      quality: r.quality,
      imageUrl: r.imageUrl,
    };
    updateEvidence();
    const names = syms.map((s) => s.replace(/-/g, ' '));
    const priorTextSyms = [...appState.symptoms].filter((s) => !syms.includes(s)).map((s) => s.replace(/-/g, ' '));
    userSay(`[Board] analyzed: ${r.board.dominantDefect.toUpperCase()}`);
    const ctx: ChatContext = {
      intent: 'image-cross-ref',
      symptoms: [...new Set([...priorTextSyms, ...names])],
      image: { className: r.board.dominantDefect, quality: r.quality?.overall },
      material: appState.material ? MATERIALS[appState.material] : undefined,
    };
    if (phase === 'diagnosed') {
      await aiRespond(ctx, imageCrossTemplate(ctx));
      await diagnose();
    } else if (phase === 'awaiting-image') {
      await aiRespond(ctx, imageCrossTemplate(ctx));
      await diagnose();
    } else {
      await aiRespond(ctx, imageCrossTemplate(ctx));
      if (BASE_QUESTIONS.every((q) => isAnswered(q.id))) {
        finishIntake();
      }
    }
  };

  renderDiagnosis(diagBody, undefined, undefined);
  setTimeout(async () => {
    await aiRespond({ intent: 'welcome' }, template('welcome'));
    phase = 'intake';
    nextQuestion();
  }, 150);

  // Boot NLU detection
  llm.detect().then((engine) => {
    const label = engine === 'gemini-nano' ? 'Chrome built-in Gemini Nano' : engine === 'transformers' ? 'On-device model (transformers.js)' : 'Embedded rules engine';
    appState.lastEngineLabel = label;
    nluNote.innerHTML = `NLU engine: <b>${label}</b> · <span style="color:var(--ink-faint)">fully offline</span>`;
  });
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
    e.innerHTML = '<div class="big">◆-◆</div><div>Awaiting operator intake</div><div style="margin-top:6px;font-size:13.5px">Answer the AI assistant questions or run an image inspection on the left to start a diagnosis.</div>';
    return;
  }

  const d = report.defect;

  const hero = el('div', 'diag-hero');
  hero.appendChild(el('div', 'kicker', 'Identified dispensing defect'));
  hero.appendChild(el('h3', '', d.defectName));
  hero.appendChild(el('p', '', d.defectDescription));
  const conf = el('div', 'confidence-row');
  conf.appendChild(el('span', 'confidence-label', 'DEFECT CONFIDENCE'));
  conf.appendChild(el('span', 'confidence-value', `${(d.defectConfidence * 100).toFixed(0)}%`));
  hero.appendChild(conf);
  body.appendChild(hero);

  const reason = el('div', 'reasoning');
  reason.appendChild(el('div', 'rlabel', 'Why this ranking'));
  reason.appendChild(el('p', '', d.reasoning));
  body.appendChild(reason);

  body.appendChild(el('div', 'question-label', 'Possible causes · likelihood'));
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
    body.appendChild(row);
  }

  const treeLabel = el('div', 'question-label');
  treeLabel.style.marginTop = '16px';
  treeLabel.textContent = 'Cause tree';
  body.appendChild(treeLabel);
  const tree = el('div', 'cause-tree');
  for (const c of d.causes.slice(0, 4)) {
    const node = el('div', 'tree-node');
    node.appendChild(el('span', 'dot'));
    node.appendChild(el('span', '', c.name));
    node.appendChild(el('span', 'cat', c.category));
    node.appendChild(el('span', 'val', `${(c.score * 100).toFixed(0)}%`));
    tree.appendChild(node);
  }
  body.appendChild(tree);

  const actionLabel = el('div', 'question-label');
  actionLabel.style.marginTop = '16px';
  actionLabel.textContent = 'Recommended troubleshooting sequence';
  body.appendChild(actionLabel);
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
  body.appendChild(actionList);

  const fb = el('div', 'feedback');
  fb.appendChild(el('div', 'flabel', 'Engineer feedback - what actually fixed it? (feeds the learning database)'));
  const chips = el('div', 'chips');
  const causeOptions = d.causes.slice(0, 5);
  const chooseCause = async (causeId: string) => {
    const cases = await getAllCases();
    const id = await saveCase({
      timestamp: Date.now(),
      material: appState.material ?? '',
      defectId: d.defectId,
      symptoms: [...appState.symptoms],
      topCause: d.causes[0].causeId,
      resolvedCause: causeId as never,
    });
    clear(chips);
    const done = el('div', 'nlu-note');
    done.innerHTML = `<b style="color:var(--accent)">✓ Case #${id} saved.</b> Knowledge-base priors updated from ${cases.length} historical cases.`;
    chips.appendChild(done);
    renderReportTab(document.getElementById('tab-report') as HTMLElement);
  };
  for (const c of causeOptions) {
    const b = button(`✓ ${c.name}`, 'btn sm ghost', () => chooseCause(c.causeId));
    chips.appendChild(b);
  }
  fb.appendChild(chips);
  body.appendChild(fb);

  const row = el('div', 'freetext-row');
  const saveBtn = button('SAVE CASE', 'btn', async () => {
    const id = await saveCase({
      timestamp: Date.now(),
      material: appState.material ?? '',
      defectId: d.defectId,
      symptoms: [...appState.symptoms],
      topCause: d.causes[0].causeId,
    });
    saveBtn.textContent = `CASE #${id} SAVED ✓`;
    saveBtn.disabled = true;
  });
  const reportBtn = button('PDF REPORT', 'btn primary', () => {
    renderReportTab(document.getElementById('tab-report') as HTMLElement);
    switchTab('report');
  });
  const newSessionBtn = button('NEW SESSION', 'btn ghost', () => {
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