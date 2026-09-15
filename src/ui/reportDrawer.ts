import { el } from './dom';

let scrim: HTMLElement | null = null;
let drawer: HTMLElement | null = null;
let host: HTMLElement | null = null;
let onOpenHandler: (() => void) | null = null;
let lastFocused: HTMLElement | null = null;

function ensureCreated(): void {
  if (drawer) return;

  scrim = el('div', 'report-drawer-scrim');
  drawer = el('div', 'report-drawer');
  drawer.setAttribute('role', 'dialog');
  drawer.setAttribute('aria-modal', 'true');
  drawer.setAttribute('aria-label', '8D Dispensing Defect Report');
  drawer.setAttribute('aria-hidden', 'true');

  host = el('div', 'report-drawer-host');
  drawer.appendChild(host);

  scrim.addEventListener('click', closeReportDrawer);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isReportDrawerOpen()) closeReportDrawer();
  });

  document.body.appendChild(scrim);
  document.body.appendChild(drawer);
}

/** Content mount point for renderReportTab(). Safe to call before open(). */
export function getReportDrawerHost(): HTMLElement {
  ensureCreated();
  return host!;
}

export function isReportDrawerOpen(): boolean {
  return !!drawer?.classList.contains('open');
}

/** Register a callback that fires every time the drawer opens (used to refresh report content). */
export function setReportDrawerOnOpen(fn: () => void): void {
  onOpenHandler = fn;
}

export function openReportDrawer(): void {
  ensureCreated();
  onOpenHandler?.();
  lastFocused = document.activeElement as HTMLElement | null;
  scrim!.classList.add('open');
  drawer!.classList.add('open');
  drawer!.setAttribute('aria-hidden', 'false');
  const focusTarget = drawer!.querySelector<HTMLElement>('button, [href], input, select, textarea');
  focusTarget?.focus();
}

export function closeReportDrawer(): void {
  if (!drawer) return;
  scrim!.classList.remove('open');
  drawer.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
  lastFocused?.focus();
}
