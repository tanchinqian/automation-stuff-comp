import { el, button } from '../ui/dom';
import { buildReportPdf, previewPdfUrl, type ReportData } from './pdfReport';

/**
 * Open a modal preview of a built report. The embedded iframe shows the PDF and
 * the Download button saves it. Closes on Close / Esc / backdrop click and
 * releases the blob URL.
 */
export function openPdfPreview(data: ReportData, fileName: string, host: HTMLElement = document.body): void {
  const { url, revoke } = previewPdfUrl(data);

  const overlay = el('div', 'pdf-modal');
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Report preview');

  const panel = el('div', 'pdf-modal-panel');
  const head = el('div', 'pdf-modal-head');
  head.appendChild(el('span', 'pdf-modal-title', 'Report preview'));
  const closeX = button('Close', 'btn sm ghost');
  head.appendChild(closeX);
  panel.appendChild(head);

  const frame = document.createElement('iframe');
  frame.className = 'pdf-frame';
  frame.title = 'Report preview';
  frame.src = url;
  panel.appendChild(frame);

  const actions = el('div', 'pdf-modal-actions');
  const download = button('Download PDF', 'btn primary', () =>
    buildReportPdf(data).save(fileName));
  const close = button('Close', 'btn ghost');
  actions.appendChild(download);
  actions.appendChild(close);
  panel.appendChild(actions);

  overlay.appendChild(panel);
  host.appendChild(overlay);

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') dismiss();
  }
  function dismiss() {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    revoke();
  }
  closeX.onclick = dismiss;
  close.onclick = dismiss;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) dismiss(); });
  document.addEventListener('keydown', onKey);
  closeX.focus();
}
