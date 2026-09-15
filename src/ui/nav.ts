/**
 * Workbench sub-navigation: "Inspect & Diagnose" vs "Report".
 *
 * Kept in its own module so both troubleshoot.ts and report.ts can switch
 * views without importing each other. Pure DOM toggling - both panes stay in
 * the document, so switching never resets state.
 */
export type WorkbenchView = 'inspect' | 'report' | 'calibration';

export function switchWorkbenchView(view: WorkbenchView): void {
  document.querySelectorAll('.subtab').forEach((t) => {
    const active = t.getAttribute('data-view') === view;
    t.classList.toggle('active', active);
    t.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.querySelectorAll('.subpane').forEach((p) => {
    const active = p.id === `workbench-${view}`;
    p.classList.toggle('hidden', !active);
    if (active) p.removeAttribute('aria-hidden');
    else p.setAttribute('aria-hidden', 'true');
  });
}
