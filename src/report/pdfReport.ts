import { jsPDF } from 'jspdf';
import type { DiagnosticReport } from '../engine/scorer';
import type { ActionStep } from '../engine/actions';
import type { QualityBreakdown } from '../vision/qualityScore';
import { registerPdfFonts, type PdfFontData } from './pdfFonts';
import { isLowConfidence } from '../ui/confidence';

export interface ReportData {
  diagnosis: DiagnosticReport;
  actions: ActionStep[];
  quality?: QualityBreakdown;
  imageLabel?: string;
  imageUrl?: string;
  /** image encoding for addImage: canvas captures are PNG, case thumbnails JPEG */
  imageFormat?: 'PNG' | 'JPEG';
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

  // ── Enrichment fields ─────────────────────────────────────────────────────
  /** raw vision pipeline result (leg counts, verdict, etc.) */
  visionAnalysis?: {
    board_verdict: string;
    defect_summary: { 'Less Paste': number; Bridging: number; Good: number };
    total_legs_detected: number;
    flagged_legs: number;
    low_confidence_count: number;
  };
  /** similar historical cases for this defect type */
  similarCases?: {
    total: number;
    most_common_cause: string | null;
    message: string;
  };
  /** cause the engineer confirmed as the fix */
  confirmedCause?: string;

  // ── Richer D3/D4/D5/D6 capture (all optional; degrade gracefully) ─────────
  /** D3 containment status: Completed | In Progress | Not Required */
  d3Status?: string;
  d3Action?: string;
  d3CompletedBy?: string;
  d3CompletedAt?: string;
  /** D4 root-cause verification status: Confirmed | Under Investigation | Disputed */
  d4Status?: string;
  d4Method?: string;
  /** D5 corrective-action implementation: Scheduled | In Progress | Completed */
  d5Status?: string;
  d5TargetDate?: string;
  d5Responsible?: string;
  /** D6 permanent action: Implemented | Pending | Not Required */
  d6Action?: string;
  d6Status?: string;
  d6Verified?: string;
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

export function buildReportPdf(data: ReportData, fonts: PdfFontData | null = null): jsPDF {
  const doc  = new jsPDF({ unit: 'pt', format: 'a4' });
  // embedded Inter when available, otherwise jsPDF's built-in Helvetica
  const FONT = registerPdfFonts(doc, fonts);
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
    doc.setFont(FONT, 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...C.black);
    doc.text('PasteTrace', ML, 22);
    doc.setFont(FONT, 'normal');
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
    doc.setFont(FONT, 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...C.mid);
    doc.text('PasteTrace  -  AI Horizon Solution Challenge 2026  -  NSW Automation', ML, H - 14);
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
    doc.setFont(FONT, bold ? 'bold' : 'normal');
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

  // Key : Value in two columns - value wraps across lines without clipping
  const kv = (key: string, value: string, indent = 0) => {
    const keyX  = ML + indent + 6;
    const valX  = ML + indent + 110;
    const maxW  = CW - indent - 116; // remaining width to right box edge
    const valLines = doc.splitTextToSize(value, maxW);
    const lineH = 11;
    const totalH = Math.max(13, (valLines.length - 1) * lineH + 13);
    guard(totalH + 2);
    doc.setFont(FONT, 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...C.mid);
    doc.text(key.toUpperCase() + ':', keyX, y);
    doc.setFont(FONT, 'normal');
    doc.setTextColor(...C.dark);
    for (let i = 0; i < valLines.length; i++) {
      doc.text(valLines[i], valX, y + i * lineH);
    }
    y += totalH;
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
    doc.setFont(FONT, 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...C.mid);
    const tagW = doc.getTextWidth(tag);
    doc.text(tag, ML + 6, y);

    doc.setFont(FONT, 'bold');
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
    doc.setFont(FONT, 'bold');
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
    doc.setFont(FONT, 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...C.dark);
    const titleLines = doc.splitTextToSize(`${a.order}.  ${a.title}`, CW - 16);
    doc.text(titleLines[0], ML + 6, y);
    y += 13;
    // Detail text indented
    doc.setFont(FONT, 'normal');
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

  // ── Metadata header row - clean 2-column table with dynamic row-height wrapping ──
  const colGap    = CW / 2;          // left half / right half split
  const col1X     = ML + 6;
  const col2X     = ML + colGap + 6;
  const col1ValOff = 82;             // key -> value offset for column 1
  const col2ValOff = 68;             // key -> value offset for column 2
  const col1ValMaxW = colGap - col1ValOff - 15;
  const col2ValMaxW = CW - colGap - col2ValOff - 10;

  const renderMetaCol = (col: 1 | 2, key: string, value: string, rowY: number): number => {
    const kx = col === 1 ? col1X : col2X;
    const vx = kx + (col === 1 ? col1ValOff : col2ValOff);
    const maxW = col === 1 ? col1ValMaxW : col2ValMaxW;
    doc.setFont(FONT, 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...C.mid);
    doc.text(`${key}:`, kx, rowY);
    doc.setTextColor(...C.dark);
    // Wrap value cleanly without clipping
    const vLines = doc.splitTextToSize(value, maxW);
    for (let i = 0; i < vLines.length; i++) {
      doc.text(vLines[i], vx, rowY + i * 10);
    }
    return vLines.length;
  };

  const metaRow = (c1?: [string, string], c2?: [string, string]) => {
    let lines1 = 0;
    let lines2 = 0;
    if (c1) lines1 = renderMetaCol(1, c1[0], c1[1], y);
    if (c2) lines2 = renderMetaCol(2, c2[0], c2[1], y);
    const maxLines = Math.max(1, lines1, lines2);
    y += Math.max(12, (maxLines - 1) * 10 + 12);
  };

  metaRow(['8D report #',   data.reportId],
          ['Status date',   new Date(data.diagnosis.timestamp).toLocaleDateString()]);
  metaRow(['Machine / Line', data.machineId || 'Not specified'],
          ['Report opened', new Date(data.diagnosis.timestamp).toLocaleString()]);
  metaRow(['Material',       data.diagnosis.material || 'Not specified'],
          ['Defect type',   data.diagnosis.defect.defectName]);
  metaRow(['Affected units', data.affectedCount || 'Not specified'],
          ['System',        data.engineLabel]);
  metaRow(['Confidence',    `${(data.diagnosis.defect.defectConfidence * 100).toFixed(0)}%`]);
  y += 2;

  // Presentation-only caveat: same rule as the on-screen badge, no math changed
  if (isLowConfidence(data.diagnosis.defect.defectConfidence, data.diagnosis.activeSymptoms.length)) {
    doc.setFont(FONT, 'italic');
    doc.setFontSize(8);
    doc.setTextColor(...C.mid);
    doc.text('Low confidence - limited symptom evidence: this ranking is based mainly on baseline priors.', ML + 6, y);
    y += 12;
  }

  rule(0.8, C.black);
  y += 14;

  // ── D1 Individual ───────────────────────────────────────────────────────────
  guard(80);
  beginSection('Individual', 'D1');
  kv('Employee name', data.employeeName || '(not provided)');
  kv('Employee ID',   data.employeeId   || '(not provided)');
  endSection();

  // ── D2 Problem Description ──────────────────────────────────────────────────
  // Estimate height: header(40) + 6 kv rows(85) + description(50) + image(optional 200)
  const d2EstH = 40 + 85 + 60 + (data.imageUrl ? 220 : 0);
  guard(d2EstH);
  beginSection('Problem description', 'D2');
  kv('What',     data.diagnosis.defect.defectName);
  kv('Where',    data.machineId ? `Machine / Line: ${data.machineId}` : 'Machine / Line: not specified');
  kv('When',     new Date(data.diagnosis.timestamp).toLocaleString());
  kv('How many', data.affectedCount || 'Not specified');
  kv('How',      'Detected via automated solder paste inspection (SPI)');
  kv('System',   data.engineLabel);
  y += 4;
  para(data.diagnosis.defect.defectDescription);

  // ── AI vision system results (compact table, only when available) ──────────
  if (data.visionAnalysis) {
    const va = data.visionAnalysis;
    y += 4;
    doc.setFont(FONT, 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...C.mid);
    doc.text('Vision system results:', ML + 4, y);
    y += 10;

    const vaRows: [string, string][] = [
      ['Board Verdict', va.board_verdict],
      ['Less Paste Legs', `${va.defect_summary['Less Paste']}`],
      ['Bridging Legs', `${va.defect_summary.Bridging}`],
      ['Good Legs', `${va.defect_summary.Good}`],
      ['Total Detected', `${va.total_legs_detected} legs`],
      ['Flagged', `${va.flagged_legs} legs`],
      ['Detection Models', 'YOLOv8n Leg Detector + MobileNetV2 Classifier'],
    ];
    const vaKeyX = ML + 8;
    const vaValX = ML + 120;
    for (const [k, v] of vaRows) {
      guard(13);
      const isVerdict = k === 'Board Verdict';
      doc.setFont(FONT, 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(...C.mid);
      doc.text(`${k}:`, vaKeyX, y);
      doc.setFont(FONT, isVerdict ? 'bold' : 'normal');
      doc.setTextColor(...C.dark);
      doc.text(v, vaValX, y);
      y += 13;
    }
    y += 2;
  }

  // Inspection image - placed here in D2 Problem Description
  if (data.imageUrl) {
    y += 4;
    doc.setFont(FONT, 'bold');
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
      doc.addImage(data.imageUrl, data.imageFormat ?? 'PNG', ML + 4, y, imgW, imgH);
      y += imgH + 6;
      if (data.imageLabel) {
        doc.setFont(FONT, 'normal');
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
  if (data.d3Status || data.d3Action || data.d3CompletedBy || data.d3CompletedAt) {
    y += 2;
    if (data.d3Status) kv('Status', data.d3Status);
    if (data.d3Action) para(`Action taken: ${data.d3Action}`, { size: 8.5 });
    if (data.d3CompletedBy) kv('Completed by', data.d3CompletedBy);
    if (data.d3CompletedAt) kv('Completed at', new Date(data.d3CompletedAt).toLocaleString());
  } else {
    verifiedLine(data.containmentVerified);
  }
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

  doc.setFont(FONT, 'bold');
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
    doc.setFont(FONT, 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...C.dark);
    doc.text(`${i + 1}`, ML + 10, y);

    doc.setFont(FONT, 'normal');
    const nameClipped = doc.splitTextToSize(c.name, cCauseW)[0];
    doc.text(nameClipped, ML + 26, y);

    doc.setTextColor(...C.mid);
    const catClipped = doc.splitTextToSize(c.category, cCatW)[0];
    doc.text(catClipped, cCatX, y);

    doc.setFont(FONT, 'bold');
    doc.setTextColor(...C.dark);
    doc.text(`${pct}%`, cPctX, y, { align: 'right' });
    y += 12;

    // Row 2: brief description in grey, indented under cause name
    const descLine = doc.splitTextToSize(c.description, CW - 36)[0];
    doc.setFont(FONT, 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...C.mid);
    doc.text(descLine, ML + 26, y);
    y += 14;

    // Row 3: WHY reasons (lighter, smaller, italic) - only when present
    if (c.reasons && c.reasons.length > 0) {
      doc.setFont(FONT, 'italic');
      doc.setFontSize(7);
      doc.setTextColor(...C.mid);
      const whyLines = doc.splitTextToSize(`Why: ${c.reasons.join('; ')}`, CW - 36);
      for (const line of whyLines) {
        guard(9);
        doc.text(line, ML + 26, y);
        y += 9;
      }
      y += 3;
    }
  }

  // Quality score (if available) - plain text
  const noLegsDetected = !!data.visionAnalysis && data.visionAnalysis.total_legs_detected === 0;
  if (noLegsDetected) {
    // matches the on-screen "not measured" state - no numbers are meaningful here
    y += 4;
    rule(0.3);
    y += 8;
    doc.setFont(FONT, 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...C.mid);
    doc.text('QUALITY SCORE:', ML + 4, y);
    doc.setTextColor(...C.dark);
    doc.text('not measured - no legs detected', ML + 90, y);
    y += 14;
  } else if (data.quality) {
    y += 4;
    rule(0.3);
    y += 8;
    doc.setFont(FONT, 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...C.mid);
    doc.text('QUALITY SCORE:', ML + 4, y);
    doc.setTextColor(...C.dark);
    doc.text(`${data.quality.overall}/100`, ML + 90, y);
    doc.setFont(FONT, 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...C.mid);
    doc.text(
      `Shape ${data.quality.shape}/5  -  Size ${data.quality.size}/5  -  Position ${data.quality.position}/5  -  Defect risk ${data.quality.defectRisk}/5`,
      ML + 160, y,
    );
    y += 14;
  } else {
    y += 4;
    doc.setFont(FONT, 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...C.mid);
    doc.text(
      `Defect confidence: ${(data.diagnosis.defect.defectConfidence * 100).toFixed(0)}%  based on symptom profile`,
      ML + 4, y,
    );
    y += 14;
  }

  if (data.d4Status || data.d4Method) {
    y += 4;
    rule(0.3);
    y += 8;
    if (data.d4Status) kv('Verification status', data.d4Status);
    if (data.d4Method) para(`Verification method: ${data.d4Method}`, { size: 8.5 });
  }
  verifiedLine(data.rootCauseVerified || data.d4Status === 'Confirmed');
  endSection();

  // ── D5 Planned permanent corrective action ──────────────────────────────────
  const correctiveSteps = data.actions.slice(2);
  const d5H = 40 + correctiveSteps.length * 60 + 10;
  guard(d5H);
  beginSection('Planned permanent corrective action', 'D5');
  for (const a of correctiveSteps) actionStep(a);
  if (data.d5Status || data.d5TargetDate || data.d5Responsible) {
    y += 2;
    if (data.d5Status) kv('Implementation status', data.d5Status);
    if (data.d5TargetDate) kv('Target date', data.d5TargetDate);
    if (data.d5Responsible) kv('Responsible', data.d5Responsible);
  }
  endSection();

  // ── D6 Permanent corrective action (verification) ───────────────────────────
  guard(90);
  beginSection('Permanent corrective action', 'D6');
  if (data.d6Action) {
    para(`Action description: ${data.d6Action}`, { color: C.dark, size: 9 });
  } else {
    para('Operator has reviewed the recommended corrective actions above and confirmed application.', { color: C.mid, size: 8.5 });
  }
  if (data.d6Status || data.d6Verified) {
    y += 2;
    if (data.d6Status) kv('Status', data.d6Status);
    if (data.d6Verified) kv('Verified effective', data.d6Verified);
  } else {
    verifiedLine(data.correctiveActionVerified);
  }
  endSection();

  // ── D7 Process note / lessons learned ──────────────────────────────────────
  guard(150);
  beginSection('Process note / lessons learned', 'D7');

  // Historical context from the learning database (only when cases exist)
  if (data.similarCases && data.similarCases.total > 0) {
    doc.setFont(FONT, 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...C.mid);
    doc.text('HISTORICAL CASE REFERENCE:', ML + 4, y);
    y += 11;
    para(data.similarCases.message, { color: C.dark, size: 9, gap: 8 });
  }

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
  doc.setFont(FONT, 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...C.mid);
  doc.text('CLOSED ON', ML + CW - 180, closeY);
  doc.text('CLOSED BY', ML + CW - 80, closeY);
  y += 12;
  doc.setFont(FONT, 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...C.dark);
  doc.text(
    isClosed && data.closedDate ? new Date(data.closedDate).toLocaleDateString() : '___________',
    ML + CW - 180, y,
  );
  doc.text(data.closedBy || '___________', ML + CW - 80, y);
  y += 14;

  // Confirmed root cause (challenge: successful solution logged)
  doc.setFont(FONT, 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...C.mid);
  doc.text('CONFIRMED ROOT CAUSE:', ML + 4, y);
  doc.setFont(FONT, 'normal');
  doc.setTextColor(...C.dark);
  const confirmedLines = doc.splitTextToSize(
    data.confirmedCause || '(Awaiting engineer confirmation)',
    CW - 160,
  );
  for (const line of confirmedLines) {
    doc.text(line, ML + 130, y);
    y += 12;
  }
  y += 2;

  // Status line
  doc.setFont(FONT, 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...C.mid);
  doc.text('STATUS:', ML + 4, y);
  doc.setTextColor(...C.dark);
  doc.text(isClosed ? 'REPORT CLOSED' : 'OPEN - AWAITING SIGN-OFF', ML + 52, y);
  y += 8;
  endSection();

  // ── Final footer ─────────────────────────────────────────────────────────
  drawFooter();

  return doc;
}

/** Build the report and download it directly. */
export function generatePdf(data: ReportData, fileName = 'dispensing-8d-report.pdf', fonts: PdfFontData | null = null): void {
  buildReportPdf(data, fonts).save(fileName);
}

/**
 * Build the report and return an object URL for in-app preview.
 * Call the returned revoke() when the preview is closed to release memory.
 */
export function previewPdfUrl(data: ReportData, fonts: PdfFontData | null = null): { url: string; revoke: () => void } {
  const doc = buildReportPdf(data, fonts);
  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  let revoked = false;
  const revoke = () => {
    if (revoked) return;
    revoked = true;
    URL.revokeObjectURL(url);
  };
  return { url, revoke };
}
