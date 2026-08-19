import { jsPDF } from 'jspdf';
import type { DiagnosticReport } from '../engine/scorer';
import type { ActionStep } from '../engine/actions';
import type { QualityBreakdown } from '../vision/qualityScore';

export interface ReportData {
  diagnosis: DiagnosticReport;
  actions: ActionStep[];
  quality?: QualityBreakdown;
  imageLabel?: string;
  engineerNotes?: string;
  engineLabel: string;
}

const COL = { accent: [0, 200, 160] as [number, number, number], dark: [20, 22, 30] as [number, number, number], grey: [120, 126, 140] as [number, number, number] };

export function generatePdf(data: ReportData, fileName = 'dispensing-troubleshooting-report.pdf'): void {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const M = 48;
  let y = 56;

  const header = () => {
    doc.setFillColor(...COL.dark);
    doc.rect(0, 0, W, 40, 'F');
    doc.setFillColor(...COL.accent);
    doc.rect(0, 40, W, 2, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('DISPENSE.AI', M, 24);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text('Dispensing Troubleshooting Report', W - M, 24, { align: 'right' });
  };
  header();

  const title = () => {
    doc.setTextColor(...COL.dark);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(17);
    doc.text('AI Dispensing Defect Detective', M, y);
    y += 18;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(...COL.grey);
    doc.text(
      `Generated ${new Date(data.diagnosis.timestamp).toLocaleString()}  |  NLU engine: ${data.engineLabel}  |  Material: ${data.diagnosis.material || '—'}`,
      M,
      y,
    );
    y += 26;
  };
  title();

  const section = (label: string) => {
    if (y > 720) {
      doc.addPage();
      header();
      y = 56;
    }
    doc.setFillColor(...COL.accent);
    doc.rect(M, y, 5, 11, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...COL.dark);
    doc.text(label, M + 12, y + 10);
    y += 20;
  };

  const para = (text: string, size = 9.5) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(size);
    doc.setTextColor(45, 48, 58);
    const lines = doc.splitTextToSize(text, W - M * 2);
    for (const line of lines) {
      if (y > 780) {
        doc.addPage();
        header();
        y = 56;
      }
      doc.text(line, M, y);
      y += size + 3.5;
    }
  };

  // 1. Problem
  section('1. Problem Description');
  para(data.diagnosis.material
    ? `Operator reported a dispensing defect while dispensing ${data.diagnosis.material}.`
    : 'Operator reported a dispensing defect.');

  // 2. Defect
  section('2. Identified Dispensing Defect');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...COL.dark);
  doc.text(`${data.diagnosis.defect.defectName}`, M, y);
  y += 16;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(45, 48, 58);
  doc.text(`Confidence: ${(data.diagnosis.defect.defectConfidence * 100).toFixed(0)}%`, M, y);
  y += 15;
  para(data.diagnosis.defect.defectDescription);

  // 3. AI Analysis
  section('3. AI Analysis');
  para(`Symptom profile: ${data.diagnosis.activeSymptoms.length ? data.diagnosis.activeSymptoms.join(', ') : 'none provided (image-driven)'}.`);
  para(data.diagnosis.defect.reasoning);

  // 4. Possible causes
  section('4. Possible Causes & Likelihood');
  const topCauses = data.diagnosis.defect.causes.slice(0, 5);
  for (const c of topCauses) {
    doc.setFillColor(225, 232, 228);
    doc.rect(M, y - 10, W - M * 2, 26, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...COL.dark);
    doc.text(c.name, M + 6, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(...COL.grey);
    doc.text(`${(c.score * 100).toFixed(0)}%`, W - M - 6, y, { align: 'right' });
    y += 16;
    para(c.description, 8.5);
    y += 4;
  }

  // 5. Confidence score
  if (data.quality) {
    section('5. Dispensing Quality Score');
    doc.setFontSize(24);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...COL.accent);
    doc.text(`${data.quality.overall} / 100`, M, y);
    y += 22;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(...COL.dark);
    doc.text(`Shape ${data.quality.shape}/5   Size ${data.quality.size}/5   Position ${data.quality.position}/5   Defect risk ${data.quality.defectRisk}/5`, M, y);
    y += 20;
  } else {
    section('5. Confidence Score');
    para(`Overall defect confidence: ${(data.diagnosis.defect.defectConfidence * 100).toFixed(0)}% based on the identified symptom profile.`);
  }

  // 6. Actions
  section('6. Recommended Troubleshooting Sequence');
  for (const a of data.actions) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...COL.dark);
    doc.text(`Step ${a.order}`, M, y);
    doc.text(a.title, M + 55, y);
    y += 12;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(70, 74, 84);
    const lines = doc.splitTextToSize(a.detail, W - M * 2 - 55);
    for (const line of lines) {
      if (y > 770) {
        doc.addPage();
        header();
        y = 56;
      }
      doc.text(line, M + 55, y);
      y += 11;
    }
    y += 6;
  }

  // 7. Engineer notes
  section('7. Engineer Notes');
  para(data.engineerNotes || 'No engineer notes recorded for this session.');

  doc.save(fileName);
}