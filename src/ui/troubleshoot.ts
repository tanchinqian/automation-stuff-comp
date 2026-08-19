import { BASE_QUESTIONS, FOLLOW_UPS, FOLLOW_UP_RULES, MATERIALS } from '../engine/knowledgeBase';
import { runDiagnosis } from '../engine/scorer';
import { buildActionPlan } from '../engine/actions';
import type { QuestionDef, SymptomId } from '../engine/types';
import { appState, addSymptoms, resetState } from './state';
import { el, clear, button, panel, stars } from './dom';
import { LlmRouter, HeuristicNlu } from '../nlu/llmRouter';
import { saveCase, getAllCases, priorOverrides } from '../db/caseDB';
import { renderReportTab } from './report';
import { createInspectionPanel, type VisionResult } from './vision';
import { classToSymptoms } from '../vision/qualityScore';

interface PendingQuestion {
  def: QuestionDef;
  next: string | null;
}

const llm = new LlmRouter();

export function renderTroubleshoot(host: HTMLElement): void {
  clear(host);
  resetState();
  const layout = el('div', 'layout workspace');
  host.appendChild(layout);

  // ---- Main column: inspection + diagnosis ----
  const mainCol = el('div', '');
  layout.appendChild(mainCol);

  const diagPanel = panel('Diagnosis', 'live analysis');
  const diagBody = diagPanel.querySelector('.panel-body')! as HTMLElement;
  mainCol.appendChild(diagPanel);

  const vision = createInspectionPanel({
    onAnalyze: () => {
      aiSay('Frame analyzed — quality score and defect flags updated on the left.');
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
  const chatLog = el('div', 'chat-log');
  const inputRow = el('div', 'freetext-row');
  const input = el('input', 'freetext-input') as HTMLInputElement;
  input.placeholder = 'Or describe the problem in your own words… (offline AI parses it)';
  const sendBtn = button('ANALYZE', 'btn primary');
  inputRow.appendChild(input);
  inputRow.appendChild(sendBtn);
  const nluNote = el('div', 'nlu-note', 'NLU: detecting local AI engine…');
  chatBody.appendChild(chatLog);
  chatBody.appendChild(inputRow);
  chatBody.appendChild(nluNote);
  layout.appendChild(chatPanel);

  // ---- Chat wiring ----
  const queue: PendingQuestion[] = [];
  let followUpsAsked = 0;
  let asked = 0;
  let intakeDone = false;

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

  const askQuestion = (q: QuestionDef) => {
    const block = el('div', 'question-block');
    block.appendChild(el('div', 'question-label', `QUESTION ${queue.length + 1}`));
    block.appendChild(el('div', 'question-text', q.text));

    if (q.intent === 'single' && q.options) {
      const grid = el('div', 'opt-grid');
      for (const opt of q.options) {
        const chip = el('button', 'opt', opt.label) as HTMLButtonElement;
        chip.type = 'button';
        chip.onclick = () => {
          userSay(opt.label);
          block.remove();
          addSymptoms(opt.adds);
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
    if (asked < BASE_QUESTIONS.length) {
      const q = BASE_QUESTIONS[asked];
      asked++;
      aiSay(q.text);
      askQuestion(q);
      return;
    }
    finishIntake();
  };

  const runFromFreeText = async (text: string) => {
    userSay(text);
    nluNote.innerHTML = 'NLU engine: parsing with <b>' + llm.engineLabel + '</b>…';
    let parsed = await llm.parse(text);
    if (parsed.material) appState.material = parsed.material;
    addSymptoms(parsed.symptoms as SymptomId[]);
    nluNote.innerHTML = `NLU engine: <b>${llm.engineLabel}</b> · ${parsed.summary}`;
    if (parsed.symptoms.length === 0 && parsed.engine !== 'heuristic') {
      const fallback = await new HeuristicNlu().parse(text);
      addSymptoms(fallback.symptoms as SymptomId[]);
      nluNote.innerHTML += ' · fallback rules applied';
    }
    aiSay(`Understood — updating the symptom profile.${appState.material ? ` Material: ${MATERIALS[appState.material]}.` : ''}`);
    finishIntake(true);
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

  const finishIntake = (force = false) => {
    if (!force && asked < BASE_QUESTIONS.length) return;
    if (intakeDone) return;
    intakeDone = true;
    aiSay('Analyzing your answers against the dispensing knowledge base…');
    diagnose();
  };

  const diagnose = async () => {
    const cases = await getAllCases();
    const priors = priorOverrides(cases);
    const report = runDiagnosis([...appState.symptoms], appState.material ? MATERIALS[appState.material] : '', priors);
    appState.lastDiagnosis = report;
    appState.lastActions = buildActionPlan(report.defect.causes.map((c) => c.causeId));
    if (appState.lastImage?.quality) {
      report.qualityScore = appState.lastImage.quality.overall;
    }
    renderDiagnosis(diagBody, report, appState.lastActions);
    aiSay(
      `Diagnosis complete. Identified <b>${report.defect.defectName}</b> with ${(report.defect.defectConfidence * 100).toFixed(0)}% confidence. <br><span style="color:var(--ink-dim)">${report.defect.reasoning}</span>`,
      true,
    );
  };

  const feedVision = (r: VisionResult) => {
    const syms = classToSymptoms(r.analysis.dominantClass) as SymptomId[];
    addSymptoms(syms);
    appState.lastImage = {
      label: r.label,
      analysis: r.analysis,
      quality: r.quality,
      imageUrl: r.imageUrl,
    };
    const names = syms.map((s) => s.replace(/-/g, ' '));
    userSay(`[Image] analyzed: ${r.analysis.dominantClass.toUpperCase()}`);
    aiSay(
      `Image findings accepted — flagged symptoms: <b>${names.join(', ') || 'none'}</b>. Quality score <b>${r.quality.overall}/100</b>. Running diagnosis with the combined evidence.`,
      true,
    );
    diagnose();
  };

  renderDiagnosis(diagBody, undefined, undefined);
  setTimeout(() => {
    aiSay('Welcome to <b>DISPENSE.AI</b> — the AI Dispensing Defect Detective.');
    aiSay('I will ask up to five smart questions to pinpoint the dispensing problem. You can also describe the issue in your own words, or run an image inspection on the left and feed it into the diagnosis.');
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
    e.innerHTML = '<div class="big">◈</div><div>Awaiting operator intake</div><div style="margin-top:6px;font-size:12px">Answer the AI assistant questions or run an image inspection on the left to start a diagnosis.</div>';
    return;
  }

  const d = report.defect;

  const hero = el('div', 'diag-hero');
  hero.appendChild(el('div', 'kicker', 'Identified dispensing defect'));
  hero.appendChild(el('h2', '', d.defectName));
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

  if (appState.lastImage?.quality) {
    const qLabel = el('div', 'question-label');
    qLabel.style.marginTop = '16px';
    qLabel.textContent = 'Dispensing quality score (image-derived)';
    body.appendChild(qLabel);
    const q = appState.lastImage.quality;
    const qh = el('div', 'q-hero');
    qh.appendChild(el('div', 'score', `${q.overall}`));
    qh.appendChild(el('div', 'score-label', 'out of 100'));
    body.appendChild(qh);
    const grid = el('div', 'q-grid');
    const card = (label: string, val: number) => {
      const c = el('div', 'q-card');
      c.appendChild(el('div', 'qlabel', label));
      c.appendChild(el('div', 'stars', stars(val)));
      c.appendChild(el('div', 'qval', `${val} / 5`));
      grid.appendChild(c);
    };
    card('Shape consistency', q.shape);
    card('Size consistency', q.size);
    card('Position', q.position);
    card('Defect risk', q.defectRisk);
    body.appendChild(grid);
  }

  const fb = el('div', 'feedback');
  fb.appendChild(el('div', 'flabel', 'Engineer feedback — what actually fixed it? (feeds the learning database)'));
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
  row.appendChild(saveBtn);
  row.appendChild(reportBtn);
  body.appendChild(row);
}

export function switchTab(name: string): void {
  document.querySelectorAll('.nav-tab').forEach((t) => {
    t.classList.toggle('active', t.getAttribute('data-tab') === name);
  });
  document.querySelectorAll('.tab-pane').forEach((p) => {
    p.classList.toggle('hidden', p.id !== `tab-${name}`);
  });
}