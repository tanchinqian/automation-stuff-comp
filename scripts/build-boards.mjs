#!/usr/bin/env node
/**
 * Build-time converter for a VOC-annotated PCB/SPI inspection dataset.
 *
 * Reads raw images + Pascal-VOC XML annotations and emits
 * public/boards/boards.json plus downscaled JPEGs under public/boards/.
 * Only the JSON + images ship in the repo; the raw XML does not.
 *
 * Designed for the PCB-AoI dataset (KubeEdge-Ianvs), but works for any
 * VOC layout with a `JPEGImages/` + `Annotations/` pair.
 *
 * Usage:
 *   node scripts/build-boards.mjs --data <path> [options]
 *
 * Options:
 *   --data <path>        dataset root (scans for JPEGImages/ + Annotations/)
 *   --limit <n>          max boards to bundle (default 15); balanced by class
 *   --max-width <px>     downscale width (default 600)
 *   --dataset <id>       dataset id in boards.json (default pcb-aoi)
 *   --no-augmented       skip *_augmentation subfolders (default true)
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync, copyFileSync, existsSync, statSync } from 'node:fs';
import { join, basename, extname, dirname } from 'node:path';

const OUT_DIR = 'public/boards';
const args = process.argv.slice(2);
const dataDir = args[args.indexOf('--data') + 1];
const maxWidth = Number(args[args.indexOf('--max-width') + 1] ?? 600);
const limit = Number(args[args.indexOf('--limit') + 1] ?? 15);
const datasetId = args[args.indexOf('--dataset') + 1] ?? 'pcb-aoi';
const noAugmented = !(args.includes('--no-augmented') ? false : true);

if (!dataDir) {
  console.error('Usage: node scripts/build-boards.mjs --data <path> [--limit 15] [--max-width 600] [--dataset pcb-aoi]');
  process.exit(1);
}

/** Recursively find every JPEGImages/Annotations directory pair under a root. */
function findVocPairs(root) {
  const pairs = [];
  const walk = (dir) => {
    let jpeg = null;
    let ann = null;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        const name = e.name.toLowerCase();
        if (name === 'jpegimages' || name === 'images' || name === 'jpgs') jpeg = join(dir, e.name);
        else if (name === 'annotations' || name === 'annotation' || name === 'xml') ann = join(dir, e.name);
      }
    }
    if (jpeg && ann) pairs.push({ jpeg, ann, root: dir });
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith('.')) walk(join(dir, e.name));
    }
  };
  walk(dataDir);
  return pairs;
}

function parseVOC(xml) {
  const rois = [];
  const defects = [];
  const sizeRe = /<size>[\s\S]*?<width>([^<]+)<\/width>[\s\S]*?<height>([^<]+)<\/height>/;
  const sizeMatch = xml.match(sizeRe);
  const iw = Number(sizeMatch?.[1] ?? 1);
  const ih = Number(sizeMatch?.[2] ?? 1);
  const norm = (v, dim) => Math.min(1, Math.max(0, v / Math.max(1, dim)));
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
    if (name) defects.push({ class: name, rect });
    else rois.push(rect);
  }
  return { rois, defects };
}

/** Map a raw annotation/name string to the canonical board defect class. */
function mapClass(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('good') || n.includes('ok') || n.includes('normal')) return 'good';
  if (n.includes('less') || n.includes('under') || n.includes('insufficient') || n.includes('tin') || n.includes('slope')) return 'less-paste';
  if (n.includes('miss') || n.includes('empty') || n.includes('hole')) return 'missing';
  if (n.includes('bridge') || n.includes('short') || n.includes('extra')) return 'bridging';
  if (n.includes('align') || n.includes('offset')) return 'misalignment';
  return 'unknown';
}

function collectAll(pairs) {
  const boards = [];
  for (const pair of pairs) {
    const { jpeg, ann } = pair;
    let files;
    try {
      files = readdirSync(jpeg).filter((f) => /\.(jpe?g|png)$/i.test(f));
    } catch {
      continue;
    }
    for (const f of files) {
      const id = basename(f, extname(f));
      const xmlPath = join(ann, `${id}.xml`);
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
        id: `${datasetId}-${id}`,
        file: `${datasetId}-${id}.jpeg`,
        srcJpeg: join(jpeg, f),
        label: id,
        class: cls,
        padRois: rois.length ? rois : undefined,
        defects: defects.map((d) => ({ class: mapClass(d.class), rect: d.rect })),
      });
    }
  }
  return boards;
}

/** Pick a balanced, diverse subset: prefer unique classes, then distinct boards. */
function selectBalanced(boards, limit) {
  if (boards.length <= limit) return boards;
  const byClass = new Map();
  for (const b of boards) {
    if (!byClass.has(b.class)) byClass.set(b.class, []);
    byClass.get(b.class).push(b);
  }
  // Interleave across classes so the gallery shows variety (no repeats of one class).
  const result = [];
  const iters = byClass.values().map((arr) => arr[Symbol.iterator]());
  while (result.length < limit) {
    let added = false;
    for (const it of iters) {
      const n = it.next();
      if (!n.done) {
        result.push(n.value);
        added = true;
        if (result.length >= limit) break;
      }
    }
    if (!added) break;
  }
  return result;
}

async function emit() {
  mkdirSync(OUT_DIR, { recursive: true });
  const pairs = findVocPairs(dataDir);
  // Exclude augmentation dirs if requested (they duplicate boards).
  const filtered = noAugmented
    ? pairs.filter((p) => !p.root.toLowerCase().includes('augment'))
    : pairs;
  if (!filtered.length) {
    console.error('No JPEGImages/Annotations pairs found under', dataDir);
    process.exit(1);
  }
  const all = collectAll(filtered);
  const boards = selectBalanced(all, limit);

  const manifest = {
    dataset: datasetId,
    attribution:
      'PCB-AoI dataset, KubeEdge-Ianvs project; released by China Telecom Research Institute and Raisecom Technology.',
    boards: boards.map((b) => ({
      id: b.id,
      file: b.file,
      label: b.label,
      class: b.class,
      padRois: b.padRois,
      defects: b.defects,
    })),
  };
  writeFileSync(join(OUT_DIR, 'boards.json'), JSON.stringify(manifest, null, 2));

  let sharp = null;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    sharp = null;
  }
  for (const b of boards) {
    const dst = join(OUT_DIR, b.file);
    if (!existsSync(b.srcJpeg)) continue;
    if (sharp) {
      await sharp(b.srcJpeg).resize({ width: maxWidth, withoutEnlargement: true }).jpeg({ quality: 82 }).toFile(dst);
    } else {
      copyFileSync(b.srcJpeg, dst);
    }
  }
  if (!sharp) console.warn('sharp not installed: images copied at original size. Run: npm i -D sharp');
  const classCount = boards.reduce((acc, b) => ((acc[b.class] = (acc[b.class] ?? 0) + 1), acc), {});
  console.log(`Wrote ${OUT_DIR}/boards.json with ${boards.length} boards (dataset: ${datasetId}).`);
  console.log('Class distribution:', JSON.stringify(classCount));
}

emit().catch((e) => {
  console.error(e);
  process.exit(1);
});
