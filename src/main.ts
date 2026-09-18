import './style.css';
import { el } from './ui/dom';
import { renderTroubleshoot, switchTab, toggleAssistant } from './ui/troubleshoot';
import { renderDatabase } from './ui/database';
import { renderReportTab } from './ui/report';
import { renderCalibrationTab } from './ui/calibration';
import { switchWorkbenchView } from './ui/nav';

const TABS = [
  { id: 'troubleshoot', label: '01 WORKBENCH' },
  { id: 'database', label: '02 LEARNING DB' },
];

const app = document.getElementById('app')!;

// Visually hidden document-level heading for structure / screen readers
const h1 = document.createElement('h1');
h1.style.cssText = 'position:absolute;left:-9999px;top:auto;width:1px;height:1px;overflow:hidden;';
h1.textContent = 'PasteTrace';
app.appendChild(h1);

// Top bar
const topbar = el('div', 'topbar');
const brand = el('div', 'brand');

// PCB inspection-target brand mark: outer registration square, corner bracket
// arms, and a center dot. All drawn in currentColor so it follows the brand
// token in both dark and light mode without extra CSS overrides.
const brandMark = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
brandMark.setAttribute('width', '18');
brandMark.setAttribute('height', '18');
brandMark.setAttribute('viewBox', '0 0 18 18');
brandMark.setAttribute('fill', 'none');
brandMark.setAttribute('aria-hidden', 'true');
brandMark.setAttribute('class', 'brand-mark');
brandMark.innerHTML = [
  '<rect x="0.5" y="0.5" width="17" height="17" rx="2" stroke="currentColor" stroke-width="1" opacity="0.45"/>',
  '<path d="M3 7.5 L3 3 L7.5 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
  '<path d="M10.5 3 L15 3 L15 7.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
  '<path d="M3 10.5 L3 15 L7.5 15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
  '<path d="M10.5 15 L15 15 L15 10.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
  '<circle cx="9" cy="9" r="2" fill="currentColor"/>',
].join('');
brand.appendChild(brandMark);
brand.appendChild(el('span', '', 'PasteTrace'));
topbar.appendChild(brand);

const nav = el('div', 'nav-tabs');
nav.setAttribute('role', 'tablist');
nav.setAttribute('aria-label', 'Primary');
for (const t of TABS) {
  const tab = el('button', 'nav-tab', t.label) as HTMLButtonElement;
  tab.type = 'button';
  tab.id = t.id;
  tab.dataset.tab = t.id;
  tab.setAttribute('role', 'tab');
  tab.setAttribute('aria-selected', t.id === 'troubleshoot' ? 'true' : 'false');
  tab.setAttribute('aria-controls', `tab-${t.id}`);
  tab.onclick = () => switchTab(t.id);
  nav.appendChild(tab);
}
topbar.appendChild(nav);

topbar.appendChild(el('div', 'spacer'));

// Light / dark mode toggle (persisted). Applied before the first paint.
const MODE_KEY = 'pastetrace.mode';
const modeBtn = el('button', 'btn sm ghost mode-toggle', '') as HTMLButtonElement;
modeBtn.type = 'button';
modeBtn.id = 'mode-toggle';

const applyMode = (mode: 'dark' | 'light'): void => {
  document.documentElement.dataset.mode = mode;
  try { localStorage.setItem(MODE_KEY, mode); } catch { /* storage unavailable */ }
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', mode === 'light' ? '#f6f8fa' : '#0d1016');
  modeBtn.textContent = mode === 'light' ? 'Dark mode' : 'Light mode';
  const label = mode === 'light' ? 'Switch to dark mode' : 'Switch to light mode';
  modeBtn.title = label;
  modeBtn.setAttribute('aria-label', label);
  modeBtn.setAttribute('aria-pressed', String(mode === 'light'));
};

const readMode = (): 'dark' | 'light' => {
  try { return localStorage.getItem(MODE_KEY) === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
};

let mode = readMode();
applyMode(mode);
modeBtn.onclick = () => {
  mode = mode === 'light' ? 'dark' : 'light';
  applyMode(mode);
};
topbar.appendChild(modeBtn);

// Assistant drawer toggle (right side of the topbar)
const assistantBtn = el('button', 'btn sm ghost assistant-toggle', 'Assistant') as HTMLButtonElement;
assistantBtn.type = 'button';
assistantBtn.id = 'assistant-toggle';
assistantBtn.setAttribute('aria-controls', 'chat-drawer');
assistantBtn.setAttribute('aria-expanded', 'false');
assistantBtn.onclick = () => toggleAssistant();
topbar.appendChild(assistantBtn);

app.appendChild(topbar);

// Expose the topbar's rendered height so the sticky Workbench sub-tabs can sit
// directly below it. Measured (not hardcoded) because the bar wraps on narrow
// screens and when the content changes.
const syncTopbarHeight = (): void => {
  document.documentElement.style.setProperty('--topbar-h', `${topbar.offsetHeight}px`);
};
syncTopbarHeight();
if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(syncTopbarHeight).observe(topbar);
} else {
  window.addEventListener('resize', syncTopbarHeight);
}

// Tab panes
const panes = el('div', 'panes');
for (const t of TABS) {
  const pane = el('div', 'tab-pane');
  pane.id = `tab-${t.id}`;
  pane.setAttribute('role', 'tabpanel');
  pane.setAttribute('aria-labelledby', t.id);
  if (t.id !== 'troubleshoot') pane.classList.add('hidden');
  panes.appendChild(pane);

  if (t.id === 'troubleshoot') {
    // Workbench sub-tabs: inspect & diagnose, report, calibration. All panes
    // stay in the DOM (only visibility toggles) so switching never resets state.
    const subtabs = el('div', 'subtabs');
    subtabs.setAttribute('role', 'tablist');
    subtabs.setAttribute('aria-label', 'Workbench sections');
    for (const v of [
      { id: 'inspect', label: 'Inspect & Diagnose' },
      { id: 'report', label: 'Report' },
      { id: 'calibration', label: 'Calibration' },
    ] as const) {
      const b = el('button', 'subtab', v.label) as HTMLButtonElement;
      b.type = 'button';
      b.id = `workbench-${v.id}-tab`;
      b.dataset.view = v.id;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', v.id === 'inspect' ? 'true' : 'false');
      b.setAttribute('aria-controls', `workbench-${v.id}`);
      b.onclick = () => switchWorkbenchView(v.id);
      subtabs.appendChild(b);
    }
    pane.appendChild(subtabs);

    for (const v of ['inspect', 'report', 'calibration'] as const) {
      const sub = el('div', v === 'inspect' ? 'subpane' : 'subpane hidden');
      sub.id = `workbench-${v}`;
      sub.setAttribute('role', 'tabpanel');
      sub.setAttribute('aria-labelledby', `workbench-${v}-tab`);
      if (v !== 'inspect') sub.setAttribute('aria-hidden', 'true');
      pane.appendChild(sub);
    }
  }
}
app.appendChild(panes);

// Render each section
renderTroubleshoot(document.getElementById('workbench-inspect')!);
renderReportTab(document.getElementById('workbench-report')!);
renderCalibrationTab(document.getElementById('workbench-calibration')!);
renderDatabase(document.getElementById('tab-database')!);

// Footer
const footer = el('div', 'footer');

app.appendChild(footer);
