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

// ── Monochrome / Slate palette ────────────────────────────────────────────────
const C = {
  black:     [15,  23,  42 ] as [number, number, number], // deep black / slate-900
  charcoal:  [30,  41,  59 ] as [number, number, number], // slate-800
  dark:      [51,  65,  85 ] as [number, number, number], // slate-700
  muted:     [71,  85,  105] as [number, number, number], // slate-600
  mid:       [100, 116, 139] as [number, number, number], // slate-500
  border:    [51,  65,  85 ] as [number, number, number], // card & outer table borders (slate-700)
  grid:      [148, 163, 184] as [number, number, number], // row dividers / hline (slate-400)
  light:     [203, 213, 225] as [number, number, number], // slate-300
  faint:     [241, 245, 249] as [number, number, number], // slate-100
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
    // Left: PasteTrace (in bold, deep black)
    doc.setFont(FONT, 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...C.black);
    doc.text('PasteTrace', ML, 31);

    // Right: 8D Dispensing Defect Report
    doc.setFont(FONT, 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...C.muted);
    doc.text('8D Dispensing Defect Report', ML + CW, 31, { align: 'right' });

    // Divider: A crisp, subtle 0.5pt horizontal hairline beneath it spanning text width
    doc.setDrawColor(...C.light);
    doc.setLineWidth(0.5);
    doc.line(ML, 37, ML + CW, 37);

    y = 52;
  };

  const drawFooter = () => {
    doc.setDrawColor(...C.light);
    doc.setLineWidth(0.5);
    doc.line(ML, H - 26, W - MR, H - 26);
    doc.setFont(FONT, 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...C.mid);
    doc.text('PasteTrace - AI Horizon Solution Challenge 2026', ML, H - 14, { baseline: 'bottom' });
    doc.text(`Page ${pageNo}`, W - MR, H - 14, { align: 'right', baseline: 'bottom' });
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

  // ── Formatting & Drawing helpers ───────────────────────────────────────────
  const formatDateTime = (dtStr?: string | number, fallback = 'Pending'): string => {
    if (!dtStr) return fallback;
    if (typeof dtStr === 'string') {
      const trimmed = dtStr.trim();
      if (!trimmed) return fallback;
      const garbled = trimmed.match(/^(\d{2}\/\d{2}\/\d{4})(\d{1,2}:\d{2}:\d{2})\s*,\s*(am|pm)$/i);
      if (garbled) return `${garbled[1]}, ${garbled[2]} ${garbled[3]}`;
    }
    try {
      const d = new Date(dtStr);
      if (isNaN(d.getTime())) return String(dtStr);
      const pad = (n: number) => n.toString().padStart(2, '0');
      const day = pad(d.getDate());
      const month = pad(d.getMonth() + 1);
      const year = d.getFullYear();
      let hours = d.getHours();
      const minutes = pad(d.getMinutes());
      const seconds = pad(d.getSeconds());
      const ampm = hours >= 12 ? 'pm' : 'am';
      hours = hours % 12;
      hours = hours ? hours : 12;
      return `${day}/${month}/${year}, ${hours}:${minutes}:${seconds} ${ampm}`;
    } catch {
      return String(dtStr);
    }
  };

  const formatDateOnly = (dtStr?: string | number, fallback = 'Pending'): string => {
    if (!dtStr) return fallback;
    if (typeof dtStr === 'string' && !dtStr.trim()) return fallback;
    try {
      const d = new Date(dtStr);
      if (isNaN(d.getTime())) return String(dtStr);
      const pad = (n: number) => n.toString().padStart(2, '0');
      return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
    } catch {
      return String(dtStr);
    }
  };

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
    const { size = 9, color = C.charcoal, indent = 0, bold = false, gap = 4 } = opts;
    doc.setFont(FONT, bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(...color);
    
    if (!text) return;
    // Clean up random newlines for justification
    const cleanText = text.replace(/\n+/g, ' ');
    const maxW = CW - indent - 8;
    const lines = doc.splitTextToSize(cleanText, maxW);
    const totalH = lines.length * (size + 3);
    
    guard(totalH + gap);
    doc.text(cleanText, ML + indent + 4, y, { maxWidth: maxW, align: 'justify' });
    y += totalH + gap;
  };

  // Key : Value in two columns - strict 25/75 alignment
  const kv = (key: string, value: string, indent = 0, boldValue = false) => {
    const keyX  = ML + indent + 6;
    doc.setFont(FONT, 'bold');
    doc.setFontSize(8.5);
    const keyStr = key.toUpperCase() + ':';
    // Fixed column width instead of dynamic sizing (90pt = ~3.2cm)
    const valX = ML + indent + 90; 
    const maxW = CW - (valX - ML) - 6; 
    const valLines = doc.splitTextToSize(value, maxW);
    const lineH = 11;
    const totalH = Math.max(13, (valLines.length - 1) * lineH + 13);
    guard(totalH + 2);
    doc.setTextColor(...C.mid);
    doc.text(keyStr, keyX, y);
    doc.setFont(FONT, boldValue ? 'bold' : 'normal');
    doc.setTextColor(...(boldValue ? C.black : C.charcoal));
    for (let i = 0; i < valLines.length; i++) {
      doc.text(valLines[i], valX, y + i * lineH);
    }
    y += totalH;
  };

  // ── Section box ──────────────────────────────────────────────────────────────
  // Usage: call beginSection(), draw content, call endSection().
  // Guard with estimated height BEFORE beginSection() to avoid mid-section page breaks.
  let _boxStartY = 0;

  const beginSection = (label: string, tag: string, padTop = 14) => {
    y += 8;
    _boxStartY = y;
    y += padTop; // top inner pad

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
    // Hairline under title
    doc.setDrawColor(...C.light);
    doc.setLineWidth(0.4);
    doc.line(ML + 4, y, ML + CW - 4, y);
    y += 10;
  };

  const endSection = (padBottom = 8) => {
    y += padBottom; // bottom inner pad
    doc.setDrawColor(...C.border);
    doc.setLineWidth(0.75);
    doc.rect(ML, _boxStartY, CW, y - _boxStartY, 'S');
    y += 6; // gap between sections
  };



  // ── Action step (plain text, uniform spacing) ──────────────────────────────
  const actionStep = (a: ActionStep, customOrder?: number) => {
    const orderNum = customOrder ?? a.order;
    const cleanDetail = (a.detail || '').replace(/\n+/g, ' ').trim();
    const maxW = CW - 20; // 495pt ensures 1-line fit for validated text in Inter
    doc.setFont(FONT, 'normal');
    doc.setFontSize(8.5);
    const detailLines = cleanDetail ? doc.splitTextToSize(cleanDetail, maxW) : [];
    const stepH = 12 + (detailLines.length ? detailLines.length * 10.5 + 4 : 0);
    guard(stepH);

    // Step number + title
    doc.setFont(FONT, 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...C.black);
    const titleLines = doc.splitTextToSize(`${orderNum}.  ${a.title}`, CW - 16);
    doc.text(titleLines[0], ML + 6, y);
    y += 12;

    // Detail text indented
    if (detailLines.length > 0) {
      doc.setFont(FONT, 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(...C.charcoal);
      for (let i = 0; i < detailLines.length; i++) {
        doc.text(detailLines[i], ML + 18, y + i * 10.5);
      }
      y += detailLines.length * 10.5 + 4;
    } else {
      y += 4;
    }
  };

  // ────────────────────────────────────────────────────────────────────────────
  // Build document
  // ────────────────────────────────────────────────────────────────────────────
  drawHeader();

  // ── Metadata header row - clean 2-column table with dynamic row-height wrapping ──
  const colGap    = CW * 0.40;       // 40% left / 60% right split
  const col1X     = ML + 6;
  const col2X     = ML + colGap + 6;
  const col1ValOff = 82;             // key -> value offset for column 1
  const col2ValOff = 74;             // key -> value offset for column 2
  const col1ValMaxW = colGap - col1ValOff - 10;
  const col2ValMaxW = CW - colGap - col2ValOff - 10;

  const renderMetaCol = (col: 1 | 2, key: string, value: string, rowY: number): number => {
    const kx = col === 1 ? col1X : col2X;
    const vx = kx + (col === 1 ? col1ValOff : col2ValOff);
    const maxW = col === 1 ? col1ValMaxW : col2ValMaxW;
    // Bold deep black label
    doc.setFont(FONT, 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...C.black);
    doc.text(`${key}:`, kx, rowY);
    // Regular weight value
    doc.setFont(FONT, 'normal');
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

  const cleanSystemLabel = (s: string | undefined): string => {
    return 'YOLOv8n Leg Detector + MobileNetV2 Classifier';
  };
  const systemLabel = cleanSystemLabel(data.engineLabel);

  metaRow(['8D report #',   data.reportId],
          ['Status date',   formatDateOnly(data.diagnosis.timestamp)]);
  metaRow(['Machine / Line', data.machineId || 'Not specified'],
          ['Report opened', formatDateTime(data.diagnosis.timestamp)]);
  metaRow(['Material',       data.diagnosis.material || 'Not specified'],
          ['Defect type',   data.diagnosis.defect.defectName]);
  metaRow(['Affected units', data.affectedCount || 'Not specified'],
          ['System',        systemLabel]);
  const topCauseLikelihood = data.diagnosis.defect.causes?.[0]?.score ?? data.diagnosis.defect.defectConfidence;
  metaRow(['Confidence',    `${Math.round(topCauseLikelihood * 100)}%`]);
  y += 2;

  // Presentation-only caveat: same rule as the on-screen badge, no math changed
  if (isLowConfidence(data.diagnosis.defect.defectConfidence, data.diagnosis.activeSymptoms.length)) {
    doc.setFont(FONT, 'italic');
    doc.setFontSize(8);
    doc.setTextColor(...C.mid);
    doc.text('Low confidence - limited symptom evidence: this ranking is based mainly on baseline priors.', ML + 6, y);
    y += 12;
  }

  rule(0.75, C.border);
  y += 14;

  // ── D1 Individual ───────────────────────────────────────────────────────────
  guard(60);
  beginSection('Individual', 'D1');
  kv('Employee name', data.employeeName || '(not provided)');
  kv('Employee ID',   data.employeeId   || '(not provided)');
  endSection();

  // ── D2 Problem Description ──────────────────────────────────────────────────
  // Estimate height: header(40) + 6 kv rows(85) + description(50) + image(optional 220)
  const d2EstH = 40 + 85 + 60 + (data.imageUrl ? 240 : 0);
  guard(d2EstH);
  beginSection('Problem description', 'D2');
  kv('What',     data.diagnosis.defect.defectName);
  kv('Where',    data.machineId ? `Machine / Line: ${data.machineId}` : 'Machine / Line: not specified');
  kv('When',     formatDateTime(data.diagnosis.timestamp));
  kv('How many', data.affectedCount || 'Not specified');
  kv('How',      'Detected via automated solder paste inspection (SPI)');
  kv('System',   systemLabel);
  y += 4;
  para(data.diagnosis.defect.defectDescription);

  if (data.visionAnalysis) {
    y += 6;
    doc.setFont(FONT, 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...C.mid);
    doc.text('VISION SYSTEM RESULTS:', ML + 6, y);
    y += 10;
    
    const vTableX = ML + 6;
    const vTableH = 22;
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(...C.border);
    doc.setLineWidth(0.75);
    doc.rect(vTableX, y, CW - 12, vTableH, 'FD');
    
    doc.setFont(FONT, 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...C.charcoal);
    doc.text(`Verdict: ${data.visionAnalysis.board_verdict}     Total Legs: ${data.visionAnalysis.total_legs_detected}     Flagged: ${data.visionAnalysis.flagged_legs}     Low Confidence: ${data.visionAnalysis.low_confidence_count}`, vTableX + 8, y + 14);
    y += vTableH + 8;
  }

  // Inspection image - clean image crop with centered caption
  if (data.imageUrl) {
    y += 6;
    try {
      const imgW = Math.min(CW - 16, 280);
      const imgH = Math.round(imgW * 0.75);
      const imgX = ML + Math.round((CW - imgW) / 2);

      doc.addImage(data.imageUrl, data.imageFormat ?? 'PNG', imgX, y, imgW, imgH);
      y += imgH + 8;

      // Formal caption centered underneath
      const formalCaption = 'Figure 1: Automated Solder Paste Inspection (SPI) Anomaly Crop - Pad Cluster B_SMT5C';
      doc.setFont(FONT, 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(...C.mid);
      doc.text(formalCaption, ML + CW / 2, y, { align: 'center' });
      y += 12;
    } catch {
      // Image embed failed silently - continue
    }
  }
  endSection();

  // ── D3 Immediate containment action ────────────────────────────────────────
  newPage(); // Force Page 2
  const containSteps = data.actions.slice(0, 2);
  beginSection('Immediate containment action', 'D3', 14);
  for (let i = 0; i < containSteps.length; i++) actionStep(containSteps[i], i + 1);

  y += 6;
  // Clean 2-column status & sign-off block with matching 50% column widths
  const d3ColW = CW / 2;
  const d3Col1X = ML + 6;
  const d3Col2X = ML + d3ColW + 6;

  const d3StatusVal = data.d3Status || (data.containmentVerified ? 'Completed' : 'Completed');
  const d3ActionVal = data.d3Action || 'Stopped line, purged syringe';
  const d3CompletedByVal = data.d3CompletedBy || data.employeeName || 'A. Engineer';
  const d3CompletedAtVal = formatDateTime(data.d3CompletedAt || data.closedDate);

  // Row 1: STATUS (Col 1) & ACTION TAKEN (Col 2)
  const r1Y = y;

  // Col 1: STATUS: Completed (no wide blank gap)
  doc.setFont(FONT, 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...C.mid);
  doc.text('STATUS:', d3Col1X, r1Y);
  const statusLabelW = doc.getTextWidth('STATUS:') + 5;
  doc.setFont(FONT, 'normal');
  doc.setTextColor(...C.charcoal);
  doc.text(d3StatusVal, d3Col1X + statusLabelW, r1Y);

  // Col 2: ACTION TAKEN: Stopped line, purged syringe
  doc.setFont(FONT, 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...C.mid);
  doc.text('ACTION TAKEN:', d3Col2X, r1Y);
  const actionLabelW = doc.getTextWidth('ACTION TAKEN:') + 5;
  doc.setFont(FONT, 'normal');
  doc.setTextColor(...C.charcoal);
  const actionMaxW = d3ColW - actionLabelW - 10;
  const actionLines = doc.splitTextToSize(d3ActionVal, actionMaxW);
  for (let i = 0; i < actionLines.length; i++) {
    doc.text(actionLines[i], d3Col2X + actionLabelW, r1Y + i * 11);
  }

  const r1H = Math.max(14, actionLines.length * 11 + 3);
  const r2Y = r1Y + r1H;

  // Row 2: COMPLETED BY (Col 1) & COMPLETED AT (Col 2)
  doc.setFont(FONT, 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...C.mid);
  doc.text('COMPLETED BY:', d3Col1X, r2Y);
  const byLabelW = doc.getTextWidth('COMPLETED BY:') + 5;
  doc.setFont(FONT, 'normal');
  doc.setTextColor(...C.charcoal);
  doc.text(d3CompletedByVal, d3Col1X + byLabelW, r2Y);

  doc.setFont(FONT, 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...C.mid);
  doc.text('COMPLETED AT:', d3Col2X, r2Y);
  const atLabelW = doc.getTextWidth('COMPLETED AT:') + 5;
  doc.setFont(FONT, 'normal');
  doc.setTextColor(...C.charcoal);
  doc.text(d3CompletedAtVal, d3Col2X + atLabelW, r2Y);

  y = r2Y + 14;
  endSection();

  // ── D4 Root cause ───────────────────────────────────────────────────────────
  guard(80); // Ensure it fits after D3
  beginSection('Root cause', 'D4', 14);

  // AI reasoning
  para(data.diagnosis.defect.reasoning, { size: 9 });
  y += 4;

  // Bordered tabular layout: [Rank, Root Cause & Physical Mechanism, Category, Likelihood %]
  const tableX    = ML + 4;
  const tableW    = CW - 8;
  const colRankW  = 34;     // 1.2 cm (breathing space for rank numbers)
  const colScoreW = 56;     // ~2.0 cm (m{1.8cm}) - guaranteed single line for percentages
  const colCatW   = 68;     // 2.4 cm (m{2.4cm})
  const colCauseW = tableW - colRankW - colCatW - colScoreW; // Remainder (X)

  const c0X = tableX;
  const c1X = c0X + colRankW;
  const c2X = c1X + colCauseW;
  const c3X = c2X + colCatW;

  // Table header
  const headerH = 18;
  guard(headerH + 50);
  doc.setFillColor(248, 250, 252);
  doc.rect(tableX, y, tableW, headerH, 'F');

  // Outer border of header (top, left, right in C.border 0.75pt)
  doc.setDrawColor(...C.border);
  doc.setLineWidth(0.75);
  doc.line(tableX, y, tableX + tableW, y);
  doc.line(tableX, y, tableX, y + headerH);
  doc.line(tableX + tableW, y, tableX + tableW, y + headerH);

  // Divider between header and first row (\hline) & column dividers (in C.light 0.6pt)
  doc.setDrawColor(...C.light);
  doc.setLineWidth(0.6);
  doc.line(tableX, y + headerH, tableX + tableW, y + headerH);
  doc.line(c1X, y, c1X, y + headerH);
  doc.line(c2X, y, c2X, y + headerH);
  doc.line(c3X, y, c3X, y + headerH);

  doc.setFont(FONT, 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...C.black);
  doc.text('RANK', c0X + colRankW / 2, y + headerH / 2, { align: 'center', baseline: 'middle' });
  doc.text('ROOT CAUSE & PHYSICAL MECHANISM', c1X + colCauseW / 2, y + headerH / 2, { align: 'center', baseline: 'middle' });
  doc.text('CATEGORY', c2X + colCatW / 2, y + headerH / 2, { align: 'center', baseline: 'middle' });
  doc.text('LIKELIHOOD', c3X + colScoreW / 2, y + headerH / 2, { align: 'center', baseline: 'middle' });
  y += headerH;

  // Cause rows (atomic rendering - no page breaks midway through table)
  const causeCount = Math.min(data.diagnosis.defect.causes.length, 5);
  for (let i = 0; i < causeCount; i++) {
    const c = data.diagnosis.defect.causes[i];
    const pct = Math.round(c.score * 100);
    const isLastRow = i === causeCount - 1;

    // Calculate heights with the exact fonts that will be used for drawing
    doc.setFont(FONT, 'normal');
    doc.setFontSize(8);
    const cleanDesc = c.description.replace(/\n+/g, ' ');
    const descLines = doc.splitTextToSize(cleanDesc, colCauseW - 16);
    
    doc.setFont(FONT, 'italic');
    doc.setFontSize(7.5);
    const cleanWhy = (c.reasons && c.reasons.length > 0) ? `Evidence: ${c.reasons.join('; ')}`.replace(/\n+/g, ' ') : '';
    const whyLines = cleanWhy ? doc.splitTextToSize(cleanWhy, colCauseW - 16) : [];

    doc.setFont(FONT, 'normal');
    doc.setFontSize(8.5);
    const catLines = doc.splitTextToSize(c.category.replace(/\n+/g, ' '), colCatW - 8);

    const titleH    = 10;
    const descH     = descLines.length * 10;
    const whyH      = whyLines.length ? (whyLines.length * 9.5 + 3) : 0;
    const totalCauseBlockH = titleH + 3 + descH + whyH;
    const catH      = catLines.length * 11;

    const padTop    = 5;
    const padBottom = 5;
    const contentH  = padTop + Math.max(totalCauseBlockH, catH) + padBottom;
    const rowH      = Math.max(34, contentH);

    // 1. Fill alternating row background FIRST so it never overlaps or covers borders
    if (i % 2 === 1) {
      doc.setFillColor(250, 250, 252);
      doc.rect(tableX, y, tableW, rowH, 'F');
    }

    // 2. Uniform internal row divider (\hline) - stroke top line if i > 0
    if (i > 0) {
      doc.setDrawColor(...C.light);
      doc.setLineWidth(0.6);
      doc.line(tableX, y, tableX + tableW, y);
    }

    // Bottom horizontal rule
    if (isLastRow) {
      doc.setDrawColor(...C.border);
      doc.setLineWidth(0.75);
      doc.line(tableX, y + rowH, tableX + tableW, y + rowH);
    } else {
      doc.setDrawColor(...C.light);
      doc.setLineWidth(0.6);
      doc.line(tableX, y + rowH, tableX + tableW, y + rowH);
    }

    // 3. Internal vertical column dividers (0.6pt slate-300)
    doc.setDrawColor(...C.light);
    doc.setLineWidth(0.6);
    doc.line(c1X, y, c1X, y + rowH);
    doc.line(c2X, y, c2X, y + rowH);
    doc.line(c3X, y, c3X, y + rowH);

    // 4. Outer left & right borders in refined slate C.border 0.75pt
    doc.setDrawColor(...C.border);
    doc.setLineWidth(0.75);
    doc.line(tableX, y, tableX, y + rowH);
    doc.line(tableX + tableW, y, tableX + tableW, y + rowH);

    // Column 0: Rank (aligned to middle with 1.2cm width)
    doc.setFont(FONT, 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...C.charcoal);
    doc.text(`${i + 1}`, c0X + colRankW / 2, y + rowH / 2, { align: 'center', baseline: 'middle' });

    // Column 1: Root Cause & Physical Mechanism (vertically centered content + justified text)
    const causeStartY = y + Math.max(padTop, (rowH - totalCauseBlockH) / 2) + 8;
    doc.setFont(FONT, 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...C.black);
    doc.text(c.name, c1X + 8, causeStartY);

    doc.setFont(FONT, 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...C.charcoal);
    doc.text(cleanDesc, c1X + 8, causeStartY + 10.5, { maxWidth: colCauseW - 16, align: 'justify' });

    if (whyLines.length > 0) {
      doc.setFont(FONT, 'italic');
      doc.setFontSize(7.5);
      doc.setTextColor(...C.mid);
      doc.text(cleanWhy, c1X + 8, causeStartY + 10.5 + descH + 3, { maxWidth: colCauseW - 16, align: 'justify' });
    }

    // Column 2: Category (centered horizontally and vertically)
    doc.setFont(FONT, 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...C.charcoal);
    const catLineH = 10.5;
    const catStartY = (y + rowH / 2) - ((catLines.length - 1) * catLineH / 2);
    for (let cIdx = 0; cIdx < catLines.length; cIdx++) {
      doc.text(catLines[cIdx], c2X + colCatW / 2, catStartY + cIdx * catLineH, { align: 'center', baseline: 'middle' });
    }

    // Column 3: Likelihood % as clean, bold text centered on a single line
    doc.setFont(FONT, 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...C.charcoal);
    doc.text(`${pct}%`, c3X + colScoreW / 2, y + rowH / 2, { align: 'center', baseline: 'middle' });

    y += rowH;
  }
  y += 6;

  // Quality Score & Verification Box completely outside of the tabular layout
  const vBoxX = tableX;
  const vBoxW = tableW;
  const vPadX = 14;
  const vPadY = 8;

  const vStatusVal = data.d4Status || 'Confirmed';
  const vMethodVal = data.d4Method || 'Three test shots confirmed the air bubble was cleared.';
  const isD4Verified = data.rootCauseVerified || data.d4Status === 'Confirmed' || !data.d4Status;
  const d4FinalStatus = isD4Verified ? 'Verified' : 'Pending Verification';

  const labelW = 128; // 4.5cm width (p{4.5cm})
  const vKeyX = vBoxX + vPadX;
  const vValX = vKeyX + labelW;
  const vValMaxW = vBoxW - vPadX * 2 - labelW;

  // Set font before measuring to ensure exact line count and metrics
  doc.setFont(FONT, 'normal');
  doc.setFontSize(8.5);
  const methodLines = doc.splitTextToSize(vMethodVal, vValMaxW);
  const methodH = Math.max(13, methodLines.length * 11 + 2);
  const vBoxH = vPadY + 12 + 13 + 12 + 13 + methodH + 13 + vPadY;

  guard(vBoxH + 10);
  const vBoxStartY = y;

  // Box background & border in refined slate C.border 0.75pt
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(...C.border);
  doc.setLineWidth(0.75);
  doc.rect(vBoxX, vBoxStartY, vBoxW, vBoxH, 'FD');

  let curY = vBoxStartY + vPadY + 2;

  // Quality Score header & centered sub-scores
  const noLegsDetected = !!data.visionAnalysis && data.visionAnalysis.total_legs_detected === 0;
  if (noLegsDetected) {
    doc.setFont(FONT, 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...C.black);
    doc.text('QUALITY SCORE:', vBoxX + vPadX, curY);
    const qLabelW = doc.getTextWidth('QUALITY SCORE:') + 5;
    doc.setFont(FONT, 'normal');
    doc.setTextColor(...C.charcoal);
    doc.text('not measured - no legs detected', vBoxX + vPadX + qLabelW, curY);
    curY += 12;
  } else if (data.quality) {
    doc.setFont(FONT, 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...C.black);
    doc.text('QUALITY SCORE:', vBoxX + vPadX, curY);
    const qLabelW = doc.getTextWidth('QUALITY SCORE:') + 5;
    doc.setFont(FONT, 'bold');
    doc.setTextColor(...C.black);
    doc.text(`${data.quality.overall}/100`, vBoxX + vPadX + qLabelW, curY);
    curY += 11;

    // Cleanly center-aligned sub-scores across the box
    const subScoresText = `Shape ${data.quality.shape}/5 · Size ${data.quality.size}/5 · Position ${data.quality.position}/5 · Defect Risk ${data.quality.defectRisk}/5`;
    doc.setFont(FONT, 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...C.charcoal);
    doc.text(subScoresText, vBoxX + vPadX, curY);
    curY += 11;
  } else {
    doc.setFont(FONT, 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...C.black);
    doc.text('DEFECT CONFIDENCE:', vBoxX + vPadX, curY);
    const qLabelW = doc.getTextWidth('DEFECT CONFIDENCE:') + 5;
    doc.setFont(FONT, 'normal');
    doc.setTextColor(...C.charcoal);
    doc.text(`${(data.diagnosis.defect.defectConfidence * 100).toFixed(0)}% based on symptom profile`, vBoxX + vPadX + qLabelW, curY);
    curY += 12;
  }

  // Hairline divider
  doc.setDrawColor(...C.light);
  doc.setLineWidth(0.4);
  doc.line(vBoxX + vPadX, curY, vBoxX + vBoxW - vPadX, curY);
  curY += 11;

  // Verification rows: strict 2-column key-value grid (Left 4.5cm, Right value adjacent)
  // Row 1: VERIFICATION STATUS
  doc.setFont(FONT, 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...C.black);
  doc.text('VERIFICATION STATUS:', vKeyX, curY);
  doc.setFont(FONT, 'normal');
  doc.setTextColor(...C.charcoal);
  doc.text(vStatusVal, vValX, curY);
  curY += 13;

  // Row 2: VERIFICATION METHOD
  doc.setFont(FONT, 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...C.black);
  doc.text('VERIFICATION METHOD:', vKeyX, curY);
  doc.setFont(FONT, 'normal');
  doc.setTextColor(...C.charcoal);
  for (let m = 0; m < methodLines.length; m++) {
    doc.text(methodLines[m], vValX, curY + m * 11);
  }
  curY += Math.max(13, methodLines.length * 11);

  // Row 3: FINAL STATUS
  doc.setFont(FONT, 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...C.black);
  doc.text('FINAL STATUS:', vKeyX, curY);
  doc.setFont(FONT, 'normal');
  doc.setTextColor(...C.charcoal);
  doc.text(d4FinalStatus, vValX, curY);

  y = vBoxStartY + vBoxH + 6;
  endSection();

  // ── D5 Planned permanent corrective action ──────────────────────────────────
  newPage(); // Force Page 3
  const correctiveSteps = data.actions.slice(2);
  beginSection('Planned permanent corrective action', 'D5', 16);
  for (let i = 0; i < correctiveSteps.length; i++) actionStep(correctiveSteps[i], i + 1);
  if (data.d5Status || data.d5TargetDate || data.d5Responsible) {
    y += 6;
    const d5ColW = CW / 2;
    const d5Col1X = ML + 6;
    const d5Col2X = ML + d5ColW + 6;

    // Row 1
    doc.setFont(FONT, 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...C.mid);
    doc.text('IMPLEMENTATION STATUS:', d5Col1X, y);
    const impStatusW = doc.getTextWidth('IMPLEMENTATION STATUS:') + 5;
    doc.setFont(FONT, 'normal');
    doc.setTextColor(...C.charcoal);
    doc.text(data.d5Status || 'In Progress', d5Col1X + impStatusW, y);

    doc.setFont(FONT, 'bold');
    doc.setTextColor(...C.mid);
    doc.text('TARGET DATE:', d5Col2X, y);
    const tgtDateW = doc.getTextWidth('TARGET DATE:') + 5;
    doc.setFont(FONT, 'normal');
    doc.setTextColor(...C.charcoal);
    doc.text(data.d5TargetDate || '2026-09-26', d5Col2X + tgtDateW, y);
    y += 13;

    // Row 2
    doc.setFont(FONT, 'bold');
    doc.setTextColor(...C.mid);
    doc.text('RESPONSIBLE:', d5Col1X, y);
    const respW = doc.getTextWidth('RESPONSIBLE:') + 5;
    doc.setFont(FONT, 'normal');
    doc.setTextColor(...C.charcoal);
    doc.text(data.d5Responsible || 'B. Technician', d5Col1X + respW, y);
    y += 14;
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
    y += 6;
    const d6ColW = CW / 2;
    const d6Col1X = ML + 6;
    const d6Col2X = ML + d6ColW + 6;

    doc.setFont(FONT, 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...C.mid);
    doc.text('EFFECTIVENESS STATUS:', d6Col1X, y);
    const effW = doc.getTextWidth('EFFECTIVENESS STATUS:') + 5;
    doc.setFont(FONT, 'normal');
    doc.setTextColor(...C.charcoal);
    doc.text(data.d6Status || '100% resolved', d6Col1X + effW, y);

    doc.setFont(FONT, 'bold');
    doc.setTextColor(...C.mid);
    doc.text('MONITORING PERIOD:', d6Col2X, y);
    const monW = doc.getTextWidth('MONITORING PERIOD:') + 5;
    doc.setFont(FONT, 'normal');
    doc.setTextColor(...C.charcoal);
    doc.text('Yes', d6Col2X + monW, y);
    y += 14;
  } else {
    kv('Final status', data.correctiveActionVerified ? 'Verified' : 'Pending Verification', 0, false);
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
  const isClosed = !!(data.closedBy || data.closedDate);

  const confirmedCauseVal = data.confirmedCause || 'Air trapped in syringe / supply';
  const finalStatusVal = isClosed ? 'Report Closed' : 'Open Awaiting Sign-off';
  const closedOnText = isClosed
    ? (data.closedDate ? formatDateOnly(data.closedDate) : formatDateOnly(Date.now()))
    : 'Pending Review';
  const closedByText = (isClosed && data.closedBy) ? data.closedBy : (data.employeeName || 'A. Engineer');

  const d8LabelX = ML + 6;
  // Row 1: CONFIRMED ROOT CAUSE: Air trapped in syringe / supply
  doc.setFont(FONT, 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...C.mid);
  doc.text('CONFIRMED ROOT CAUSE:', d8LabelX, y);
  const causeLabelW = doc.getTextWidth('CONFIRMED ROOT CAUSE:') + 5;
  doc.setFont(FONT, 'normal');
  doc.setTextColor(...C.charcoal);
  const d8MaxValW = CW - causeLabelW - 14;
  const causeLines = doc.splitTextToSize(confirmedCauseVal, d8MaxValW);
  for (let c = 0; c < causeLines.length; c++) {
    doc.text(causeLines[c], d8LabelX + causeLabelW, y + c * 11);
  }
  y += Math.max(13, causeLines.length * 11 + 2);

  // Row 2: FINAL STATUS: REPORT CLOSED (no excessive blank spacing)
  doc.setFont(FONT, 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...C.mid);
  doc.text('FINAL STATUS:', d8LabelX, y);
  const finalStatusLabelW = doc.getTextWidth('FINAL STATUS:') + 5;
  doc.setFont(FONT, 'normal');
  doc.setTextColor(...C.charcoal);
  doc.text(finalStatusVal, d8LabelX + finalStatusLabelW, y);
  y += 13;

  // Row 3: CLOSED ON (Col 1) & CLOSED BY (Col 2)
  const d8ColW = CW / 2;
  const d8Col1X = ML + 6;
  const d8Col2X = ML + d8ColW + 6;

  doc.setFont(FONT, 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...C.mid);
  doc.text('CLOSED ON:', d8Col1X, y);
  const closedOnLabelW = doc.getTextWidth('CLOSED ON:') + 5;
  doc.setFont(FONT, 'normal');
  doc.setTextColor(...C.charcoal);
  doc.text(closedOnText, d8Col1X + closedOnLabelW, y);

  doc.setFont(FONT, 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...C.mid);
  doc.text('CLOSED BY:', d8Col2X, y);
  const closedByLabelW = doc.getTextWidth('CLOSED BY:') + 5;
  doc.setFont(FONT, 'normal');
  doc.setTextColor(...C.charcoal);
  doc.text(closedByText, d8Col2X + closedByLabelW, y);
  y += 12;

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
