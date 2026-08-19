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
  engineerNotes?: string;
  engineLabel: string;
}

// ── Palette ──────────────────────────────────────────────────────────────────
const C = {
  accent:    [0, 200, 160]   as [number, number, number],
  accentDim: [0, 140, 110]   as [number, number, number],
  dark:      [20, 22, 30]    as [number, number, number],
  body:      [45, 50, 62]    as [number, number, number],
  grey:      [110, 118, 135] as [number, number, number],
  light:     [235, 238, 244] as [number, number, number],
  white:     [255, 255, 255] as [number, number, number],
  bar:       [220, 230, 224] as [number, number, number],
};

export function generatePdf(data: ReportData, fileName = 'dispensing-troubleshooting-report.pdf'): void {
  const doc  = new jsPDF({ unit: 'pt', format: 'a4' });
  const W    = doc.internal.pageSize.getWidth();   // 595
  const H    = doc.internal.pageSize.getHeight();  // 842
  const ML   = 48;   // left margin
  const MR   = 48;   // right margin
  const CW   = W - ML - MR;  // content width
  let y      = 0;
  let pageNo = 1;

  // ── Page chrome ─────────────────────────────────────────────────────────────
  const drawHeader = () => {
    doc.setFillColor(...C.dark);
    doc.rect(0, 0, W, 36, 'F');
    doc.setFillColor(...C.accent);
    doc.rect(0, 36, W, 2.5, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(...C.white);
    doc.text('DISPENSE.AI', ML, 23);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...C.accent);
    doc.text('Dispensing Troubleshooting Report', W - MR, 23, { align: 'right' });

    y = 56;
  };

  const drawFooter = () => {
    doc.setFillColor(...C.light);
    doc.rect(0, H - 28, W, 28, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...C.grey);
    doc.text('DISPENSE.AI  ·  AI Horizon Solution Challenge 2026  ·  NSW Automation', ML, H - 11);
    doc.text(`Page ${pageNo}`, W - MR, H - 11, { align: 'right' });
  };

  const newPage = () => {
    drawFooter();
    doc.addPage();
    pageNo++;
    drawHeader();
  };

  // ── Guard: if less than `needed` pt remain on the page, break ──────────────
  const guard = (needed: number) => {
    if (y + needed > H - 40) newPage();
  };

  // ── Section heading ─────────────────────────────────────────────────────────
  const section = (label: string, prePad = 18) => {
    guard(36);
    y += prePad;
    // Accent bar
    doc.setFillColor(...C.accent);
    doc.rect(ML, y, 4, 12, 'F');
    // Label
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11.5);
    doc.setTextColor(...C.dark);
    doc.text(label, ML + 12, y + 10);
    y += 22;
  };

  // ── Body paragraph ──────────────────────────────────────────────────────────
  const para = (text: string, opts: { size?: number; color?: [number,number,number]; indent?: number; gap?: number } = {}) => {
    const { size = 9.5, color = C.body, indent = 0, gap = 5 } = opts;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(text, CW - indent);
    for (const line of lines) {
      guard(size + 4);
      doc.text(line, ML + indent, y);
      y += size + 3;
    }
    y += gap;
  };

  // ── Key-value row ───────────────────────────────────────────────────────────
  const kv = (key: string, value: string) => {
    guard(16);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...C.grey);
    doc.text(key.toUpperCase(), ML, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...C.body);
    doc.text(value, ML + 130, y);
    y += 15;
  };

  // ── Cause card with bar ─────────────────────────────────────────────────────
  const causeCard = (name: string, category: string, score: number, description: string) => {
    const descLines = doc.splitTextToSize(description, CW - 12);
    const cardH = 14 + 12 + descLines.length * 12 + 16;
    guard(cardH);

    // Card background
    doc.setFillColor(...C.light);
    doc.roundedRect(ML, y, CW, cardH, 4, 4, 'F');

    const cx = ML + 10;
    const pct = Math.round(score * 100);

    // Name
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...C.dark);
    doc.text(name, cx, y + 14);

    // Category tag
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...C.grey);
    doc.text(category, cx, y + 26);

    // Percentage on right
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(...C.accentDim);
    doc.text(`${pct}%`, ML + CW - 12, y + 20, { align: 'right' });

    // Likelihood bar background
    const barX = cx;
    const barW = CW - 22 - 38;  // leave room for percentage
    const barY = y + 33;
    doc.setFillColor(...C.bar);
    doc.roundedRect(barX, barY, barW, 6, 3, 3, 'F');

    // Likelihood bar fill — colour-coded by score
    const fill = barW * score;
    const fillColor: [number,number,number] =
      score >= 0.75 ? [255, 155, 60] :
      score >= 0.5  ? [0, 200, 160]  :
                     [90, 160, 210];
    doc.setFillColor(...fillColor);
    doc.roundedRect(barX, barY, Math.max(6, fill), 6, 3, 3, 'F');

    // Description
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...C.body);
    let dy = y + 48;
    for (const line of descLines) {
      doc.text(line, cx, dy);
      dy += 12;
    }

    y += cardH + 8;
  };

  // ────────────────────────────────────────────────────────────────────────────
  // Begin document
  // ────────────────────────────────────────────────────────────────────────────
  drawHeader();

  // ── Title block ─────────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(19);
  doc.setTextColor(...C.dark);
  doc.text('AI Dispensing Defect Detective', ML, y);
  y += 20;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...C.grey);
  doc.text(
    `Generated ${new Date(data.diagnosis.timestamp).toLocaleString()}   ·   NLU engine: ${data.engineLabel}`,
    ML, y,
  );
  y += 22;

  // Thin divider
  doc.setFillColor(...C.light);
  doc.rect(ML, y, CW, 1, 'F');
  y += 14;

  // Section counter — auto-increments so optional sections never break numbering
  let sn = 1;

  // ── 1. Problem Description ──────────────────────────────────────────────
  section(`${sn++}. Problem Description`, 0);
  kv('Material', data.diagnosis.material || 'Not specified');
  para(
    data.diagnosis.material
      ? `Operator reported a dispensing defect while working with ${data.diagnosis.material}.`
      : 'Operator reported a dispensing defect. No material type was specified.',
  );

  // ── 2. Identified Defect ──────────────────────────────────────────────
  section(`${sn++}. Identified Dispensing Defect`);
  kv('Defect type',  data.diagnosis.defect.defectName);
  kv('Confidence',   `${(data.diagnosis.defect.defectConfidence * 100).toFixed(0)}%`);
  para(data.diagnosis.defect.defectDescription);

  // ── 3. Image Inspection (optional) ─────────────────────────────────────────
  if (data.imageUrl) {
    section(`${sn++}. Image Inspection`);
    try {
      // Max display width is content width; scale height proportionally
      const imgW = Math.min(CW, 320);
      const imgH = Math.round(imgW * 0.75); // assume ~4:3 canvas
      guard(imgH + 20);
      // Draw a light border rect behind the image
      doc.setFillColor(...C.light);
      doc.roundedRect(ML, y, imgW, imgH, 4, 4, 'F');
      doc.addImage(data.imageUrl, 'PNG', ML, y, imgW, imgH);
      y += imgH + 6;
      if (data.imageLabel) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(...C.grey);
        doc.text(data.imageLabel, ML, y);
        y += 14;
      }
    } catch {
      // Image embed failed silently — continue without it
    }
  }

  // ── AI Analysis ────────────────────────────────────────────────────
  section(`${sn++}. AI Analysis`);
  if (data.diagnosis.activeSymptoms.length) {
    para(`Symptom profile (${data.diagnosis.activeSymptoms.length} indicators):`, { color: C.grey, size: 8.5, gap: 2 });
    para(data.diagnosis.activeSymptoms.join('  ·  '), { size: 8.5, color: C.body });
  }
  para(data.diagnosis.defect.reasoning);

  // ── Possible Causes ────────────────────────────────────────────────────────
  section(`${sn++}. Possible Causes & Likelihood`);
  for (const c of data.diagnosis.defect.causes.slice(0, 5)) {
    causeCard(c.name, c.category, c.score, c.description);
  }

  // ── Quality / Confidence Score ────────────────────────────────────────────
  if (data.quality) {
    section(`${sn++}. Dispensing Quality Score`);
    guard(70);

    // Big score
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(36);
    doc.setTextColor(...C.accent);
    doc.text(`${data.quality.overall}`, ML, y + 30);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(...C.grey);
    doc.text('/ 100', ML + 48, y + 30);
    y += 44;

    // Sub-scores as 4 mini cards in a row
    const dims: [string, number][] = [
      ['Shape',       data.quality.shape],
      ['Size',        data.quality.size],
      ['Position',    data.quality.position],
      ['Defect Risk', data.quality.defectRisk],
    ];
    const cardW = (CW - 12) / 4;
    dims.forEach(([label, val], i) => {
      const cx2 = ML + i * (cardW + 4);
      doc.setFillColor(...C.light);
      doc.roundedRect(cx2, y, cardW, 36, 3, 3, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.setTextColor(...C.dark);
      doc.text(`${val}/5`, cx2 + cardW / 2, y + 18, { align: 'center' });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(...C.grey);
      doc.text(label.toUpperCase(), cx2 + cardW / 2, y + 30, { align: 'center' });
    });
    y += 48;
  } else {
    section(`${sn++}. Confidence Score`);
    para(`Overall defect confidence: ${(data.diagnosis.defect.defectConfidence * 100).toFixed(0)}% — based on the identified symptom profile.`);
  }

  // ── Troubleshooting Sequence ──────────────────────────────────────────────────
  section(`${sn++}. Recommended Troubleshooting Sequence`);

  for (const a of data.actions) {
    const detailLines = doc.splitTextToSize(a.detail, CW - 70);
    const stepH = 14 + detailLines.length * 11 + 12;
    guard(stepH);

    // Step number badge
    doc.setFillColor(...C.accent);
    doc.circle(ML + 10, y + 8, 9, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...C.white);
    doc.text(`${a.order}`, ML + 10, y + 11.5, { align: 'center' });

    // Step title
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...C.dark);
    doc.text(a.title, ML + 26, y + 11);

    y += 20;

    // Step detail
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...C.body);
    for (const line of detailLines) {
      guard(12);
      doc.text(line, ML + 26, y);
      y += 11;
    }
    y += 8;
  }

  // ── Engineer Notes ─────────────────────────────────────────────────────────────
  section(`${sn++}. Engineer Notes`);
  para(data.engineerNotes || 'No engineer notes recorded for this session.', { color: C.grey });

  // ── Final footer ─────────────────────────────────────────────────────────────
  drawFooter();

  doc.save(fileName);
}