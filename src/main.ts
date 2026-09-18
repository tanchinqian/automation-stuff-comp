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
    ?.setAttribute('content', mode === 'light' ? '#f6f8fa' : '#111620');
  modeBtn.textContent = mode === 'light' ? '🌙 Dark mode' : '☀️ Light mode';
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

// Technician Hotkey Guide HUD
let hotkeyOpen = false;
let hotkeyBackdrop: HTMLElement | null = null;

const createHotkeyModal = (): HTMLElement => {
  const backdrop = el('div', 'hotkey-backdrop');
  backdrop.id = 'hotkey-backdrop';
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeHotkeyModal();
  });

  const card = el('div', 'hotkey-card');
  const cardHead = el('div', 'hotkey-card-head');
  cardHead.appendChild(el('strong', '', 'TECHNICIAN KEYBOARD CONTROLS & HUD'));
  const closeBtn = el('button', 'btn sm ghost', '×') as HTMLButtonElement;
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close hotkey guide');
  closeBtn.onclick = () => closeHotkeyModal();
  cardHead.appendChild(closeBtn);
  card.appendChild(cardHead);

  const cardBody = el('div', 'hotkey-card-body');

  // Group 1: Navigation
  const sec1 = el('div', '');
  sec1.appendChild(el('div', 'hotkey-section-title', 'Primary Console Navigation'));
  const grid1 = el('div', 'hotkey-grid');
  const addRow = (parent: HTMLElement, key: string, desc: string) => {
    const r = el('div', 'hotkey-row');
    r.appendChild(el('span', 'kbd-badge', key));
    r.appendChild(el('span', 'desc', desc));
    parent.appendChild(r);
  };
  addRow(grid1, '1', 'Switch to 01 WORKBENCH');
  addRow(grid1, '2', 'Switch to 02 LEARNING DB');
  addRow(grid1, 'I', 'Jump to Inspect & Diagnose subpane');
  addRow(grid1, 'R', 'Jump to Report generation & PDF preview');
  addRow(grid1, 'C', 'Jump to Calibration & star thresholds');
  sec1.appendChild(grid1);
  cardBody.appendChild(sec1);

  // Group 2: Diagnostic Controls
  const sec2 = el('div', '');
  sec2.appendChild(el('div', 'hotkey-section-title', 'Diagnostic & Assistant Controls'));
  const grid2 = el('div', 'hotkey-grid');
  addRow(grid2, 'A', 'Toggle Assistant drawer (open / close)');
  addRow(grid2, '?', 'Toggle this Technician Hotkey Guide');
  addRow(grid2, 'Esc', 'Close drawer, dismiss modals, deselect reticle');
  addRow(grid2, 'Enter', 'Submit message when in chat input (Shift+Enter for newline)');
  sec2.appendChild(grid2);
  cardBody.appendChild(sec2);

  // Group 3: Inspection Canvas
  const sec3 = el('div', '');
  sec3.appendChild(el('div', 'hotkey-section-title', 'Inspection Canvas Actions'));
  const grid3 = el('div', 'hotkey-grid');
  addRow(grid3, 'Click Pad', 'Lock reticle on pad and zoom micro-crop');
  addRow(grid3, 'Filter Chips', 'Isolate defects: All, Defects Only, Less Paste, Bridging');
  sec3.appendChild(grid3);
  cardBody.appendChild(sec3);

  card.appendChild(cardBody);

  const cardFoot = el('div', 'hotkey-card-foot');
  cardFoot.appendChild(el('span', '', 'Cleanroom & glove-friendly controls. Active when not typing in text fields.'));
  const escBtn = el('button', 'btn sm', 'CLOSE (ESC)') as HTMLButtonElement;
  escBtn.type = 'button';
  escBtn.onclick = () => closeHotkeyModal();
  cardFoot.appendChild(escBtn);
  card.appendChild(cardFoot);

  backdrop.appendChild(card);
  document.body.appendChild(backdrop);
  return backdrop;
};

const openHotkeyModal = (): void => {
  if (!hotkeyBackdrop) hotkeyBackdrop = createHotkeyModal();
  hotkeyOpen = true;
  requestAnimationFrame(() => hotkeyBackdrop?.classList.add('open'));
};

const closeHotkeyModal = (): void => {
  hotkeyOpen = false;
  hotkeyBackdrop?.classList.remove('open');
};

const toggleHotkeyModal = (): void => {
  if (hotkeyOpen) closeHotkeyModal();
  else openHotkeyModal();
};

// Hotkey guide toggle button in topbar
const hotkeyBtn = el('button', 'btn sm ghost hotkey-toggle', '? Hotkeys') as HTMLButtonElement;
hotkeyBtn.type = 'button';
hotkeyBtn.id = 'hotkey-toggle';
hotkeyBtn.title = 'Technician keyboard shortcuts (?)';
hotkeyBtn.setAttribute('aria-label', 'Technician keyboard shortcuts');
hotkeyBtn.onclick = () => toggleHotkeyModal();
topbar.appendChild(hotkeyBtn);

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

// Footer: Dedicated technician hotkey guide strip for quick shop-floor reference
const footer = el('div', 'footer');

const kbdStrip = el('div', 'kbd-strip');
const kbdLabel = el('span', 'kbd-strip-label', 'Controls:');
kbdStrip.appendChild(kbdLabel);

const addKbdItem = (key: string, label: string, onClick?: () => void) => {
  const item = el('button', 'kbd-item') as HTMLButtonElement;
  item.type = 'button';
  const badge = el('span', 'kbd-badge', key);
  item.appendChild(badge);
  item.appendChild(document.createTextNode(label));
  if (onClick) item.onclick = onClick;
  kbdStrip.appendChild(item);
};

addKbdItem('1', 'Workbench', () => switchTab('troubleshoot'));
addKbdItem('2', 'Learning DB', () => switchTab('database'));
addKbdItem('I', 'Inspect', () => { switchTab('troubleshoot'); switchWorkbenchView('inspect'); });
addKbdItem('R', 'Report', () => { switchTab('troubleshoot'); switchWorkbenchView('report'); });
addKbdItem('C', 'Calibration', () => { switchTab('troubleshoot'); switchWorkbenchView('calibration'); });
addKbdItem('A', 'Assistant', () => toggleAssistant());
addKbdItem('?', 'All Hotkeys', () => toggleHotkeyModal());

footer.appendChild(kbdStrip);

const footerRight = el('div', '', 'PasteTrace v1.0 · Lab Console');
footer.appendChild(footerRight);

app.appendChild(footer);

// Global Keyboard Navigation
window.addEventListener('keydown', (e: KeyboardEvent) => {
  const tag = (e.target as HTMLElement)?.tagName;
  const isEditable = (e.target as HTMLElement)?.isContentEditable;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || isEditable) {
    if (e.key === 'Escape') {
      (e.target as HTMLElement)?.blur();
      if (hotkeyOpen) closeHotkeyModal();
    }
    return;
  }

  if (e.key === '?') {
    e.preventDefault();
    toggleHotkeyModal();
  } else if (e.key === 'Escape') {
    if (hotkeyOpen) {
      e.preventDefault();
      closeHotkeyModal();
    }
  } else if (e.key === '1') {
    e.preventDefault();
    switchTab('troubleshoot');
  } else if (e.key === '2') {
    e.preventDefault();
    switchTab('database');
  } else if (e.key === 'i' || e.key === 'I') {
    e.preventDefault();
    switchTab('troubleshoot');
    switchWorkbenchView('inspect');
  } else if (e.key === 'r' || e.key === 'R') {
    e.preventDefault();
    switchTab('troubleshoot');
    switchWorkbenchView('report');
  } else if (e.key === 'c' || e.key === 'C') {
    e.preventDefault();
    switchTab('troubleshoot');
    switchWorkbenchView('calibration');
  } else if (e.key === 'a' || e.key === 'A') {
    e.preventDefault();
    toggleAssistant();
  }
});
