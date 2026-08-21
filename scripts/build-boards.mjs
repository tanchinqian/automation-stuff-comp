#!/usr/bin/env node
/**
 * Build-time converter for the PCB-AoI dataset.
 *
 * Reads raw PCB-AoI images + Pascal-VOC XML annotations and emits
 * public/boards/boards.json plus downscaled JPEGs under public/boards/.
 * Only the JSON + images ship in the repo; the raw XML does not.
 *
 * Expected input layout (point DATA_DIR at the downloaded PCB-AoI dataset):
 *   DATA_DIR/JPEGImages/<id>.jpeg
 *   DATA_DIR/Annotations/<id>.xml
 *
 * Usage:
 *   node scripts/build-boards.mjs --data <path-to-pcb-aoi> [--max-width 600]
 *
 * If the optional 'sharp' is installed it downscales images; otherwise it
 * copies them as-is and prints a warning.
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join, basename, extname } from 'node:path';

const OUT_DIR = 'public/boards';
const args = process.argv.slice(2);
const dataDir = args[args.indexOf('--data') + 1];
const maxWidth = Number(args[args.indexOf('--max-width') + 1] ?? 600);
const datasetId = args[args.indexOf('--dataset') + 1] ?? 'pcb-aoi';

if (!dataDir) {
  console.error('Usage: node scripts/build-boards.mjs --data <path> [--max-width 600] [--dataset pcb-aoi]');
  process.exit(1);
}

function parseVOC(xml) {
  const rois = [];
  const defects = [];
  const sizeRe = /<size>[\s\S]*?<width>([^<]+)<\/width>[\s\S]*?<height>([^<]+)<\/height>/;
  const sizeMatch = xml.match(sizeRe);
  const iw = Number(sizeMatch?.[1] ?? 1);
  const ih = Number(sizeMatch?.[2] ?? 1);
  const norm = (v, dim) => Math.min(1, Math.max(0, v / Math.max(1, dim)));
  // object -> name + bndbox
  const objRe = /<object>[\s\S]*?<\/object>/g;
  const m = xml.match(objRe) || [];
  for (const obj of m) {
    const name = (obj.match(/<name>([^<]+)<\/name>/) || [])[1]?.trim() || '';
    const bx = (obj.match(/<xmin>([^<]+)<\/xmin>/) || [])[1];
    const by = (obj.match(/<ymin>([^<]+)<\/ymin>/) || [])[1];
    const bw = (obj.match(/<xmax>([^<]+)<\/xmax>/) || [])[1];
    const bh = (obj.match(/<ymax>([^<]+)<\/ymax>/) || [])[1];
    if (!bx) continue;
    const rect = {
      x: norm(Number(bx), iw),
      y: norm(Number(by), ih),
      w: norm(Number(bw) - Number(bx), iw),
      h: norm(Number(bh) - Number(by), ih),
    };
    if (name) {
      defects.push({ class: name, rect });
    } else {
      rois.push(rect);
    }
  }
  return { rois, defects };
}

function mapClass(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('good') || n.includes('ok')) return 'good';
  if (n.includes('less') || n.includes('under') || n.includes('insufficient') || n.includes('tin')) return 'less-paste';
  if (n.includes('miss')) return 'missing';
  if (n.includes('bridge') || n.includes('short')) return 'bridging';
  if (n.includes('align') || n.includes('offset')) return 'misalignment';
  return 'unknown';
}

function collect() {
  const jpegDir = join(dataDir, 'JPEGImages');
  const annDir = join(dataDir, 'Annotations');
  const files = existsSync(jpegDir) ? readdirSync(jpegDir).filter((f) => /\.(jpe?g|png)$/i.test(f)) : [];
  const boards = [];
  for (const f of files) {
    const id = basename(f, extname(f));
    const xmlPath = join(annDir, `${id}.xml`);
    let rois = [];
    let defects = [];
    let cls = 'unknown';
    if (existsSync(xmlPath)) {
      const xml = readFileSync(xmlPath, 'utf8');
      const parsed = parseVOC(xml);
      rois = parsed.rois;
      defects = parsed.defects;
      cls = defects.length ? mapClass(defects[0].class) : 'good';
    }
    boards.push({
      id,
      file: `${id}.jpeg`,
      label: id,
      class: cls,
      padRois: rois.length ? rois : undefined,
      defects: defects.map((d) => ({ class: mapClass(d.class), rect: d.rect })),
    });
  }
  return boards;
}

function emit() {
  mkdirSync(OUT_DIR, { recursive: true });
  const jpegDir = join(dataDir, 'JPEGImages');
  const boards = collect();
  const manifest = {
    dataset: datasetId,
    attribution:
      'PCB-AoI dataset, KubeEdge-Ianvs project; released by China Telecom Research Institute and Raisecom Technology.',
    boards,
  };
  writeFileSync(join(OUT_DIR, 'boards.json'), JSON.stringify(manifest, null, 2));
  // copy images (downscale only if sharp available)
  let sharp = null;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    sharp = null;
  }
  for (const b of boards) {
    const src = join(jpegDir, `${b.id}.jpeg`);
    const dst = join(OUT_DIR, `${b.id}.jpeg`);
    if (!existsSync(src)) {
      const alt = join(jpegDir, `${b.id}.jpg`);
      if (existsSync(alt)) copyFileSync(alt, join(OUT_DIR, `${b.id}.jpeg`));
      continue;
    }
    if (sharp) {
      sharp(src).resize({ width: maxWidth, withoutEnlargement: true }).jpeg({ quality: 82 }).toFile(dst);
    } else {
      copyFileSync(src, dst);
    }
  }
  if (!sharp) {
    console.warn('sharp not installed: images copied at original size. Run: npm i -D sharp');
  }
  console.log(`Wrote ${OUT_DIR}/boards.json with ${boards.length} boards (dataset: ${datasetId}).`);
}

emit();
