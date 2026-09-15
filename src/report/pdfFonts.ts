import type { jsPDF } from 'jspdf';

/**
 * Inter faces for PDF embedding. jsPDF cannot use webfonts the way CSS does,
 * so the TTFs in `public/fonts/` are fetched once, base64-encoded, and
 * registered on the document. Everything degrades to jsPDF's built-in
 * Helvetica when the fonts are unavailable.
 */
export interface PdfFontData {
  regular: string;
  bold: string;
}

let cached: PdfFontData | null | undefined;

const fontUrl = (file: string): string => `${import.meta.env.BASE_URL}fonts/${file}`;

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function fetchFont(file: string): Promise<string> {
  // cap the wait so a hung request degrades to Helvetica instead of blocking
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(fontUrl(file), { signal: controller.signal });
    if (!res.ok) throw new Error(`font fetch failed: ${res.status}`);
    return toBase64(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

/** Load the bundled font data (cached). Returns null when unavailable. */
export async function getPdfFonts(): Promise<PdfFontData | null> {
  if (cached !== undefined) return cached;
  try {
    const [regular, bold] = await Promise.all([
      fetchFont('Inter-Regular.ttf'),
      fetchFont('Inter-Bold.ttf'),
    ]);
    cached = { regular, bold };
  } catch {
    cached = null;
  }
  return cached;
}

/**
 * Register the embedded faces on a document and return the family to use.
 * Inter has no bundled italic, so italic styles reuse the closest static face.
 * Returns 'helvetica' when no font data is available.
 */
export function registerPdfFonts(doc: jsPDF, fonts: PdfFontData | null): string {
  if (!fonts) return 'helvetica';
  try {
    doc.addFileToVFS('Inter-Regular.ttf', fonts.regular);
    doc.addFileToVFS('Inter-Bold.ttf', fonts.bold);
    doc.addFont('Inter-Regular.ttf', 'Inter', 'normal');
    doc.addFont('Inter-Bold.ttf', 'Inter', 'bold');
    doc.addFont('Inter-Regular.ttf', 'Inter', 'italic');
    doc.addFont('Inter-Bold.ttf', 'Inter', 'bolditalic');
    return 'Inter';
  } catch {
    return 'helvetica';
  }
}
