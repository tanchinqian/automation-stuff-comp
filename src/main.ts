import './style.css';
import { el } from './ui/dom';
import { initTheme, createThemeToggle } from './ui/theme';
import { renderTroubleshoot, switchTab } from './ui/troubleshoot';
import { renderDatabase } from './ui/database';
import { renderReportTab } from './ui/report';
import { getReportDrawerHost, setReportDrawerOnOpen } from './ui/reportDrawer';

initTheme();

const TABS = [
  { id: 'troubleshoot', label: '01 WORKBENCH' },
  { id: 'database', label: '02 LEARNING DB' },
];

const app = document.getElementById('app')!;

// Visually hidden document-level heading for structure / screen readers
const h1 = document.createElement('h1');
h1.style.cssText = 'position:absolute;left:-9999px;top:auto;width:1px;height:1px;overflow:hidden;';
h1.textContent = 'DISPENSE.AI - AI Dispensing Defect Detective';
app.appendChild(h1);

// Top bar
const topbar = el('div', 'topbar');
const brand = el('div', 'brand');
brand.appendChild(el('span', 'mark'));
brand.appendChild(el('span', '', 'DISPENSE.AI'));
brand.appendChild(el('span', '', '- AI Dispensing Defect Detective'));
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
topbar.appendChild(createThemeToggle());

app.appendChild(topbar);

// Tab panes
const panes = el('div', 'panes');
for (const t of TABS) {
  const pane = el('div', 'tab-pane');
  pane.id = `tab-${t.id}`;
  pane.setAttribute('role', 'tabpanel');
  pane.setAttribute('aria-labelledby', t.id);
  if (t.id !== 'troubleshoot') pane.classList.add('hidden');
  panes.appendChild(pane);
}
app.appendChild(panes);

// Render each tab
renderTroubleshoot(document.getElementById('tab-troubleshoot')!);
renderDatabase(document.getElementById('tab-database')!);

// Report is a slide-out drawer, not a top-level tab: pre-render it now (so
// it's ready the instant it's opened) and refresh it on every subsequent open.
setReportDrawerOnOpen(() => renderReportTab(getReportDrawerHost()));
renderReportTab(getReportDrawerHost());

// Footer
const footer = el('div', 'footer');

app.appendChild(footer);
