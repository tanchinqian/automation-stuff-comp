import './style.css';
import { el } from './ui/dom';
import { renderTroubleshoot, switchTab } from './ui/troubleshoot';
import { renderVision } from './ui/vision';
import { renderLive } from './ui/live';
import { renderDatabase } from './ui/database';
import { renderReportTab } from './ui/report';

const TABS = [
  { id: 'troubleshoot', label: '01 · TROUBLESHOOT' },
  { id: 'vision', label: '02 · IMAGE ANALYSIS' },
  { id: 'live', label: '03 · LIVE INSPECTION' },
  { id: 'database', label: '04 · LEARNING DB' },
  { id: 'report', label: '05 · REPORT' },
];

const app = document.getElementById('app')!;

// Top bar
const topbar = el('div', 'topbar');
const brand = el('div', 'brand');
brand.appendChild(el('span', 'mark'));
brand.appendChild(el('span', '', 'DISPENSE.AI'));
brand.appendChild(el('span', '', '— AI Dispensing Defect Detective'));
topbar.appendChild(brand);

const nav = el('div', 'nav-tabs');
for (const t of TABS) {
  const tab = el('button', 'nav-tab', t.label) as HTMLButtonElement;
  tab.type = 'button';
  tab.dataset.tab = t.id;
  tab.onclick = () => switchTab(t.id);
  nav.appendChild(tab);
}
topbar.appendChild(nav);

topbar.appendChild(el('div', 'spacer'));

const offlineChip = el('div', 'status-chip online');
offlineChip.appendChild(el('span', 'led'));
offlineChip.appendChild(el('span', 'mono', '100% ON-DEVICE'));
offlineChip.title = 'No cloud services required. All analysis, diagnosis, learning and reporting run in this browser.';
topbar.appendChild(offlineChip);

const engineChip = el('div', 'status-chip');
engineChip.appendChild(el('span', 'led'));
engineChip.appendChild(el('span', 'mono', 'ENGINE: DETECTING…'));
engineChip.id = 'engine-chip';
topbar.appendChild(engineChip);

app.appendChild(topbar);

// Tab panes
const panes = el('div', '');
for (const t of TABS) {
  const pane = el('div', 'tab-pane');
  pane.id = `tab-${t.id}`;
  if (t.id !== 'troubleshoot') pane.classList.add('hidden');
  panes.appendChild(pane);
}
app.appendChild(panes);

// Render each tab
renderTroubleshoot(document.getElementById('tab-troubleshoot')!);
renderVision(document.getElementById('tab-vision')!);
renderLive(document.getElementById('tab-live')!);
renderDatabase(document.getElementById('tab-database')!);
renderReportTab(document.getElementById('tab-report')!);

// Footer
const footer = el('div', 'footer');
footer.appendChild(el('span', '', 'NSW AUTOMATION · AI Horizon Solution Challenge 2026'));
footer.appendChild(el('span', '', 'Self-contained diagnostic engine + classical CV + on-device NLU (Gemini Nano → on-device model → embedded rules)'));
footer.appendChild(el('span', '', 'ESP32-CAM live-stream wiring: placeholder — see src/live/esp32.ts'));
app.appendChild(footer);

// Boot NLU detection for the status chip
import('./nlu/llmRouter').then(async ({ LlmRouter }) => {
  const r = new LlmRouter();
  const engine = await r.detect();
  const label =
    engine === 'gemini-nano'
      ? 'GEMINI NANO'
      : engine === 'transformers'
        ? 'ON-DEVICE MODEL'
        : 'EMBEDDED RULES';
  const chip = document.getElementById('engine-chip')!;
  chip.innerHTML = '<span class="led"></span><span class="mono">ENGINE: ' + label + '</span>';
  chip.classList.add(engine === 'heuristic' ? 'warn' : 'online');
});