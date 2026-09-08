import { jsPDF } from 'jspdf';
import type { DiagnosticReport } from '../engine/scorer';
import type { ActionStep } from '../engine/actions';
import type { QualityBreakdown } from '../vision/qualityScore';

export interface ReportData {
  diagnosis: DiagnosticReport;
  actions: ActionStep[];
  quality?: QualityBreakdown;
  imageLabel?: string;
  imageUrl?: string;
  engineLabel: string;

  // ── 8D-Lite fields ────────────────────────────────────────────────────────
  reportId: string;
  /** D1 Individual: employee name */
  employeeName?: string;
  /** D1 Individual: employee ID */
  employeeId?: string;
  /** D2: dispenser / production line identifier */
  machineId?: string;
  /** D2: affected unit count (free text) */
  affectedCount?: string;
  /** D3: operator confirmed containment was taken */
  containmentVerified: boolean;
  /** D4: operator confirmed root cause */
  rootCauseVerified: boolean;
  /** D5/D6: operator confirmed corrective action applied */
  correctiveActionVerified: boolean;
  /** D7: process note / SOP update */
  engineerNotes?: string;
  /** Sign-off: operator name */
  closedBy?: string;
  /** Sign-off: ISO date string */
  closedDate?: string;
}

// ── Monochrome palette only ───────────────────────────────────────────────────
const C = {
  black:     [0,   0,   0  ] as [number, number, number],
  dark:      [30,  30,  30 ] as [number, number, number],
  mid:       [100, 100, 100] as [number, number, number],
  light:     [200, 200, 200] as [number, number, number],
  faint:     [230, 230, 230] as [number, number, number],
  white:     [255, 255, 255] as [number, number, number],
};

export function generatePdf(data: ReportData, fileName = 'dispensing-8d-report.pdf'): void {
  const doc  = new jsPDF({ unit: 'pt', format: 'a4' });
  const W    = doc.internal.pageSize.getWidth();   // 595
  const H    = doc.internal.pageSize.getHeight();  // 842
  const ML   = 40;
  const MR   = 40;
  const CW   = W - ML - MR;
  let y      = 0;
  let pageNo = 1;

  // ── Page chrome ─────────────────────────────────────────────────────────────
  const drawHeader = () => {
    // No background fill - plain white header with thin bottom rule
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...C.black);
    doc.text('DISPENSE.AI', ML, 22);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...C.mid);
    doc.text('8D Dispensing Defect Report', W - MR, 22, { align: 'right' });
    // Thin rule below header text
    doc.setDrawColor(...C.light);
    doc.setLineWidth(0.5);
    doc.line(ML, 28, W - MR, 28);
    y = 40;
  };

  const drawFooter = () => {
    doc.setDrawColor(...C.light);
    doc.setLineWidth(0.4);
    doc.line(ML, H - 26, W - MR, H - 26);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...C.mid);
    doc.text('DISPENSE.AI  -  AI Horizon Solution Challenge 2026  -  NSW Automation', ML, H - 14);
    doc.text(`Page ${pageNo}`, W - MR, H - 14, { align: 'right' });
  };

  const newPage = () => {
    drawFooter();
    doc.addPage();
    pageNo++;
    drawHeader();
  };

  const guard = (needed: number) => {
    if (y + needed > H - 44) newPage();
  };

  // ── Drawing helpers ─────────────────────────────────────────────────────────

  // Thin horizontal rule
  const rule = (weight = 0.4, color: [number,number,number] = C.light) => {
    doc.setDrawColor(...color);
    doc.setLineWidth(weight);
    doc.line(ML, y, ML + CW, y);
  };

  // Plain paragraph text
  const para = (
    text: string,
    opts: { size?: number; color?: [number,number,number]; indent?: number; bold?: boolean; gap?: number } = {},
  ) => {
    const { size = 9, color = C.dark, indent = 0, bold = false, gap = 4 } = opts;
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(text, CW - indent - 8);
    for (const line of lines) {
      guard(size + 3);
      doc.text(line, ML + indent + 4, y);
      y += size + 2;
    }
    y += gap;
  };

  // Key : Value in two columns - value capped to box right edge
  const kv = (key: string, value: string, indent = 0) => {
    guard(14);
    const keyX  = ML + indent + 6;
    const valX  = ML + indent + 110;
    const maxW  = CW - indent - 116; // remaining width to right box edge
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...C.mid);
    doc.text(key.toUpperCase() + ':', keyX, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...C.dark);
    // Split value if it would overflow the box
    const valLines = doc.splitTextToSize(value, maxW);
    doc.text(valLines[0], valX, y);
    if (valLines.length > 1) {
      y += 11;
      doc.text(valLines[1], valX, y);
    }
    y += 13;
  };

  // ── Section box ──────────────────────────────────────────────────────────────
  // Usage: call beginSection(), draw content, call endSection().
  // Guard with estimated height BEFORE beginSection() to avoid mid-section page breaks.
  let _boxStartY = 0;

  const beginSection = (label: string, tag: string) => {
    y += 8;
    _boxStartY = y;
    y += 12; // top inner pad

    // Tag (e.g. "D1") in mid-grey bold, then title in black bold on same baseline
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...C.mid);
    const tagW = doc.getTextWidth(tag);
    doc.text(tag, ML + 6, y);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...C.black);
    doc.text(label, ML + 6 + tagW + 5, y);

    y += 6;
    // Hair rule under title
    doc.setDrawColor(...C.light);
    doc.setLineWidth(0.3);
    doc.line(ML + 4, y, ML + CW - 4, y);
    y += 10;
  };

  const endSection = () => {
    y += 8; // bottom inner pad
    doc.setDrawColor(...C.black);
    doc.setLineWidth(0.5);
    doc.rect(ML, _boxStartY, CW, y - _boxStartY, 'S');
    y += 6; // gap between sections
  };

  // ── Verified text stamp (no color) ──────────────────────────────────────────
  const verifiedLine = (verified: boolean) => {
    guard(14);
    y += 2;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...C.mid);
    doc.text('STATUS:', ML + 4, y);
    doc.setTextColor(...C.dark);
    doc.text(verified ? 'VERIFIED' : 'PENDING VERIFICATION', ML + 52, y);
    y += 14;
  };

  // ── Action step (plain text, no colored badge) ───────────────────────────────
  const actionStep = (a: ActionStep) => {
    const detailLines = doc.splitTextToSize(a.detail, CW - 28);
    const stepH = 14 + detailLines.length * 11 + 4;
    guard(stepH);
    // Step number + title
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...C.dark);
    const titleLines = doc.splitTextToSize(`${a.order}.  ${a.title}`, CW - 16);
    doc.text(titleLines[0], ML + 6, y);
    y += 13;
    // Detail text indented
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...C.mid);
    for (const line of detailLines) {
      guard(11);
      doc.text(line, ML + 18, y);
      y += 11;
    }
    y += 4;
  };

  // ────────────────────────────────────────────────────────────────────────────
  // Build document
  // ────────────────────────────────────────────────────────────────────────────
  drawHeader();

  // ── Document title ──────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...C.black);
  doc.text('8D report', ML, y);
  y += 10;

  rule(0.8, C.black);
  y += 14;

  // ── Metadata header row - clean 2-column table, no overlapping badge ──────
  // Left column: keys at col1X, values at col1X + 110
  // Right column: keys at col2X, values at col2X + 110
  // Keep a gap of at least 20pt between the two columns' value areas.
  const colGap   = CW / 2;          // left half / right half split
  const col1X    = ML + 6;
  const col2X    = ML + colGap + 10;
  const colValOff = 110;             // key -> value offset (same for both cols)
  const col1ValMaxW = colGap - colValOff - 20;
  const col2ValMaxW = CW - colGap - colValOff - 10;

  const metaKv = (col: 1 | 2, key: string, value: string) => {
    const kx = col === 1 ? col1X : col2X;
    const vx = kx + colValOff;
    const maxW = col === 1 ? col1ValMaxW : col2ValMaxW;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...C.mid);
    doc.text(`${key}:`, kx, y);
    doc.setTextColor(...C.dark);
    // Clip long values to column width
    const vLines = doc.splitTextToSize(value, maxW);
    doc.text(vLines[0], vx, y);
  };

  metaKv(1, '8D report #',   data.reportId);
  metaKv(2, 'Status date',   new Date(data.diagnosis.timestamp).toLocaleDateString());
  y += 12;
  metaKv(1, 'Machine / Line', data.machineId || 'Not specified');
  metaKv(2, 'Report opened', new Date(data.diagnosis.timestamp).toLocaleString());
  y += 12;
  metaKv(1, 'Material',       data.diagnosis.material || 'Not specified');
  metaKv(2, 'Defect type',   data.diagnosis.defect.defectName);
  y += 12;
  metaKv(1, 'Affected units', data.affectedCount || 'Not specified');
  metaKv(2, 'NLU engine',    data.engineLabel);
  y += 12;
  metaKv(1, 'Confidence',    `${(data.diagnosis.defect.defectConfidence * 100).toFixed(0)}%`);
  y += 14;

  rule(0.8, C.black);
  y += 14;

  // ── D1 Individual ───────────────────────────────────────────────────────────
  guard(80);
  beginSection('Individual', 'D1');
  kv('Employee name', data.employeeName || '(not provided)');
  kv('Employee ID',   data.employeeId   || '(not provided)');
  endSection();

  // ── D2 Problem Description ──────────────────────────────────────────────────
  // Estimate height: header(40) + 5 kv rows(70) + description(50) + image(optional 200)
  const d2EstH = 40 + 70 + 60 + (data.imageUrl ? 220 : 0);
  guard(d2EstH);
  beginSection('Problem description', 'D2');
  kv('What',     data.diagnosis.defect.defectName);
  kv('Where',    data.machineId ? `Machine / Line: ${data.machineId}` : 'Machine / Line: not specified');
  kv('When',     new Date(data.diagnosis.timestamp).toLocaleString());
  kv('How many', data.affectedCount || 'Not specified');
  kv('How',      'Detected via AI-assisted on-device symptom analysis');
  y += 4;
  para(data.diagnosis.defect.defectDescription);

  // Inspection image - placed here in D2 Problem Description
  if (data.imageUrl) {
    y += 4;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...C.mid);
    doc.text('INSPECTION IMAGE:', ML + 4, y);
    y += 10;
    try {
      const imgW = Math.min(CW - 8, 280);
      const imgH = Math.round(imgW * 0.75);
      doc.setDrawColor(...C.light);
      doc.setLineWidth(0.3);
      doc.rect(ML + 4, y, imgW, imgH, 'S');
      doc.addImage(data.imageUrl, 'PNG', ML + 4, y, imgW, imgH);
      y += imgH + 6;
      if (data.imageLabel) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(...C.mid);
        doc.text(data.imageLabel, ML + 4, y);
        y += 12;
      }
    } catch {
      // Image embed failed silently - continue
    }
  }
  endSection();

  // ── D3 Immediate containment action ────────────────────────────────────────
  const containSteps = data.actions.slice(0, 2);
  const d3H = 40 + containSteps.length * 60 + 20;
  guard(d3H);
  beginSection('Immediate containment action', 'D3');
  for (const a of containSteps) actionStep(a);
  verifiedLine(data.containmentVerified);
  endSection();

  // ── D4 Root cause ───────────────────────────────────────────────────────────
  guard(50); // just guard for header; cause cards have individual guards below
  beginSection('Root cause', 'D4');

  // AI reasoning
  para(data.diagnosis.defect.reasoning, { size: 9 });
  y += 4;

  // Cause table header - 4 fixed columns within CW
  // Col positions (relative to ML): No=6, Cause=26, Category=240, Score=right
  const cCauseW = 200; // max width for cause name
  const cCatX  = ML + 240;
  const cCatW  = 130;
  const cPctX  = ML + CW - 6;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...C.mid);
  doc.text('NO.',        ML + 6,  y);
  doc.text('CAUSE',      ML + 26, y);
  doc.text('CATEGORY',   cCatX,   y);
  doc.text('LIKELIHOOD', cPctX,   y, { align: 'right' });
  y += 4;
  rule(0.3);
  y += 8;

  // Cause rows
  for (let i = 0; i < Math.min(data.diagnosis.defect.causes.length, 5); i++) {
    const c = data.diagnosis.defect.causes[i];
    guard(22);
    const pct = Math.round(c.score * 100);

    // Row 1: number + cause name (clipped) + category (clipped) + score
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...C.dark);
    doc.text(`${i + 1}`, ML + 10, y);

    doc.setFont('helvetica', 'normal');
    const nameClipped = doc.splitTextToSize(c.name, cCauseW)[0];
    doc.text(nameClipped, ML + 26, y);

    doc.setTextColor(...C.mid);
    const catClipped = doc.splitTextToSize(c.category, cCatW)[0];
    doc.text(catClipped, cCatX, y);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...C.dark);
    doc.text(`${pct}%`, cPctX, y, { align: 'right' });
    y += 12;

    // Row 2: brief description in grey, indented under cause name
    const descLine = doc.splitTextToSize(c.description, CW - 36)[0];
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...C.mid);
    doc.text(descLine, ML + 26, y);
    y += 14;
  }

  // Quality score (if available) - plain text
  if (data.quality) {
    y += 4;
    rule(0.3);
    y += 8;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...C.mid);
    doc.text('QUALITY SCORE:', ML + 4, y);
    doc.setTextColor(...C.dark);
    doc.text(`${data.quality.overall}/100`, ML + 90, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...C.mid);
    doc.text(
      `Shape ${data.quality.shape}/5  -  Size ${data.quality.size}/5  -  Position ${data.quality.position}/5  -  Defect risk ${data.quality.defectRisk}/5`,
      ML + 160, y,
    );
    y += 14;
  } else {
    y += 4;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...C.mid);
    doc.text(
      `Defect confidence: ${(data.diagnosis.defect.defectConfidence * 100).toFixed(0)}%  based on symptom profile`,
      ML + 4, y,
    );
    y += 14;
  }

  verifiedLine(data.rootCauseVerified);
  endSection();

  // ── D5 Planned permanent corrective action ──────────────────────────────────
  const correctiveSteps = data.actions.slice(2);
  const d5H = 40 + correctiveSteps.length * 60 + 10;
  guard(d5H);
  beginSection('Planned permanent corrective action', 'D5');
  for (const a of correctiveSteps) actionStep(a);
  endSection();

  // ── D6 Permanent corrective action (verification) ───────────────────────────
  guard(80);
  beginSection('Permanent corrective action', 'D6');
  para('Operator has reviewed the recommended corrective actions above and confirmed application.', { color: C.mid, size: 8.5 });
  verifiedLine(data.correctiveActionVerified);
  endSection();

  // ── D7 Process note / lessons learned ──────────────────────────────────────
  guard(100);
  beginSection('Process note / lessons learned', 'D7');
  para(
    data.engineerNotes ||
    'No process note recorded. Update SOP and process parameters as required based on the corrective actions applied.',
    { color: data.engineerNotes ? C.dark : C.mid, size: 9 },
  );
  endSection();

  // ── D8 Sign-off / Close ─────────────────────────────────────────────────────
  guard(70);
  beginSection('Close report', 'D8');
  const isClosed = !!(data.closedBy && data.closedDate);
  // Closed on / Closed by columns like reference image
  const closeY = y;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...C.mid);
  doc.text('CLOSED ON', ML + CW - 180, closeY);
  doc.text('CLOSED BY', ML + CW - 80, closeY);
  y += 12;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...C.dark);
  doc.text(
    isClosed && data.closedDate ? new Date(data.closedDate).toLocaleDateString() : '___________',
    ML + CW - 180, y,
  );
  doc.text(data.closedBy || '___________', ML + CW - 80, y);
  y += 14;
  // Status line
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...C.mid);
  doc.text('STATUS:', ML + 4, y);
  doc.setTextColor(...C.dark);
  doc.text(isClosed ? 'REPORT CLOSED' : 'OPEN - AWAITING SIGN-OFF', ML + 52, y);
  y += 8;
  endSection();

  // ── Final footer ─────────────────────────────────────────────────────────
  drawFooter();

  doc.save(fileName);
}
