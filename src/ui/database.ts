import { getAllCases, clearCases, seedCases, computePriorStats, type CaseRecord } from '../db/caseDB';
import { el, clear, panel, button, emptyState } from './dom';
import { renderLearningStats } from './report';

export function renderDatabase(host: HTMLElement): void {
  clear(host);
  const layout = el('div', 'layout');
  host.appendChild(layout);

  const topPanel = panel('AI Learning Database', 'case-based reasoning · IndexedDB');
  const tBody = topPanel.querySelector('.panel-body')!;

  const row = el('div', 'freetext-row');
  const seedBtn = button('SEED DEMO HISTORY', 'btn', async () => {
    const existing = await getAllCases();
    if (existing.length) {
      await clearCases();
    }
    for (const c of seedCases()) {
      await import('../db/caseDB').then((m) => m.saveCase(c));
    }
    await renderAll();
  });
  const clearBtn = button('CLEAR ALL', 'btn ghost', async () => {
    await clearCases();
    await renderAll();
  });
  row.appendChild(seedBtn);
  row.appendChild(clearBtn);
  tBody.appendChild(row);

  const explain = el('div', 'reasoning');
  explain.appendChild(el('div', 'rlabel', 'How the learning works'));
  explain.appendChild(
    el('p', '', 'Every troubleshooting session is stored locally. When an engineer marks which cause actually fixed the problem, that resolved outcome becomes evidence. The diagnosis engine blends these empirical priors with the built-in knowledge base — so the system genuinely gets smarter with each resolved case, entirely on-device.'),
  );
  tBody.appendChild(explain);

  layout.appendChild(topPanel);

  const histPanel = panel('Case History & Priors', 'stored in this browser');
  const hBody = histPanel.querySelector('.panel-body')! as HTMLElement;
  layout.appendChild(histPanel);

  const statsPanel = panel('Cause Frequency', 'what actually fixed things');
  const sBody = statsPanel.querySelector('.panel-body')! as HTMLElement;
  layout.appendChild(statsPanel);

  async function renderAll() {
    const cases = await getAllCases();
    renderHistory(hBody, cases);
    renderLearningStats(sBody);
  }

  renderAll();
}

function renderHistory(body: HTMLElement, cases: CaseRecord[]): void {
  clear(body);
  if (!cases.length) {
    body.appendChild(emptyState('No cases yet', 'Seed demo history or complete a troubleshooting session to populate the database.'));
    return;
  }
  const sorted = [...cases].sort((a, b) => b.timestamp - a.timestamp);
  for (const c of sorted.slice(0, 12)) {
    const row = el('div', 'hist-row');
    row.appendChild(el('span', 'mat', c.material || '—'));
    row.appendChild(el('span', '', c.defectId.replace(/-/g, ' ')));
    row.appendChild(el('span', 'cause', c.resolvedCause ? `✓ ${c.resolvedCause.replace(/-/g, ' ')}` : `pred. ${c.topCause.replace(/-/g, ' ')}`));
    row.appendChild(el('span', 'res', c.resolvedCause ? 'resolved' : 'open'));
    body.appendChild(row);
  }
}