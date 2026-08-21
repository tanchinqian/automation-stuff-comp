#!/usr/bin/env node
/**
 * Generates placeholder PCB pad-board images + boards.json for the demo.
 *
 * These are schematic stand-ins so the classical per-pad CV pipeline and the
 * dataset gallery run end-to-end offline BEFORE real PCB-AoI images are
 * bundled. To switch to the real dataset later, run:
 *
 *   node scripts/build-boards.mjs --data <path-to-pcb-aoi>
 *
 * which overwrites public/boards/ with real images + parsed annotations.
 *
 * Each board: dark PCB, an array of rectangular copper pads, solder-paste
 * blobs printed on them, plus a simulated defect (less paste / missing /
 * bridging / misalignment / good). ground-truth class is recorded in boards.json.
 */
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT_DIR = 'public/boards';
const W = 720;
const H = 480;
const COLS = 6;
const ROWS = 4;
const PAD_W = 88;
const PAD_H = 34;
const GAP_X = 26;
const GAP_Y = 30;
const MARGIN = 40;

const BOARD_BG = [20, 26, 22]; // dark green PCB
const PAD_COLOR = [170, 150, 90]; // bare copper
const PASTE_COLOR = [120, 125, 135]; // solder paste (grey)
const TRACK = [30, 40, 36];

function padPos(r, c) {
  const x = MARGIN + c * (PAD_W + GAP_X);
  const y = MARGIN + r * (PAD_H + GAP_Y);
  return { x, y };
}

function buildPixels(scene) {
  // start with board background + fine trace grid
  const px = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const o = i * 4;
    px[o] = BOARD_BG[0];
    px[o + 1] = BOARD_BG[1];
    px[o + 2] = BOARD_BG[2];
    px[o + 3] = 255;
  }
  // faint vertical/horizontal board traces
  for (let y = 0; y < H; y += 2) {
    for (let x = 0; x < W; x += 2) {
      if (x % 90 < 3 || y % 70 < 3) {
        const o = (y * W + x) * 4;
        px[o] = TRACK[0];
        px[o + 1] = TRACK[1];
        px[o + 2] = TRACK[2];
      }
    }
  }

  const setRect = (x, y, w, h, color) => {
    for (let yy = Math.max(0, y); yy < Math.min(H, y + h); yy++) {
      for (let xx = Math.max(0, x); xx < Math.min(W, x + w); xx++) {
        const o = (yy * W + xx) * 4;
        px[o] = color[0];
        px[o + 1] = color[1];
        px[o + 2] = color[2];
      }
    }
  };
  const setBlob = (cx, cy, rx, ry) => {
    for (let yy = Math.max(0, cy - ry); yy < Math.min(H, cy + ry); yy++) {
      for (let xx = Math.max(0, cx - rx); xx < Math.min(W, cx + rx); xx++) {
        const dx = (xx - cx) / rx;
        const dy = (yy - cy) / ry;
        if (dx * dx + dy * dy <= 1) {
          const o = (yy * W + xx) * 4;
          px[o] = PASTE_COLOR[0];
          px[o + 1] = PASTE_COLOR[1];
          px[o + 2] = PASTE_COLOR[2];
        }
      }
    }
  };

  const padRois = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const { x, y } = padPos(r, c);
      setRect(x, y, PAD_W, PAD_H, PAD_COLOR);
      padRois.push({ x, y, w: PAD_W, h: PAD_H });
    }
  }

  // Which board is defective? pick a pattern per scene
  const defectIndex = scene === 'good' ? -1 : 2; // defect at pad index 2
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const { x, y } = padPos(r, c);
      const idx = r * COLS + c;
      const cx = x + PAD_W / 2;
      const cy = y + PAD_H / 2;
      const isDefect = idx === defectIndex;
      switch (scene) {
        case 'good':
          setBlob(cx, cy, PAD_W * 0.4, PAD_H * 0.6);
          break;
        case 'less-paste':
          if (isDefect) setBlob(cx, cy, PAD_W * 0.16, PAD_H * 0.28);
          else setBlob(cx, cy, PAD_W * 0.4, PAD_H * 0.6);
          break;
        case 'missing':
          if (isDefect) { /* no paste */ }
          else setBlob(cx, cy, PAD_W * 0.4, PAD_H * 0.6);
          break;
        case 'bridging':
          if (isDefect) {
            // blob spans across to the right neighbor pad
            setBlob(cx + PAD_W * 0.4, cy, PAD_W * 0.7, PAD_H * 0.45);
          } else setBlob(cx, cy, PAD_W * 0.4, PAD_H * 0.6);
          break;
        case 'misalignment':
          if (isDefect) setBlob(cx + PAD_W * 0.28, cy, PAD_W * 0.4, PAD_H * 0.6);
          else setBlob(cx, cy, PAD_W * 0.4, PAD_H * 0.6);
          break;
      }
    }
  }

  return { px, padRois };
}

const scenes = ['good', 'good', 'good', 'less-paste', 'less-paste', 'missing', 'missing', 'bridging', 'bridging', 'misalignment', 'misalignment', 'good', 'less-paste', 'missing', 'bridging'];

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const boards = [];
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const id = `ph-${String(i + 1).padStart(2, '0')}-${scene}`;
    const { px, padRois } = buildPixels(scene);
    await sharp(px, { raw: { width: W, height: H, channels: 4 } })
      .jpeg({ quality: 85 })
      .toFile(join(OUT_DIR, `${id}.jpeg`));
    boards.push({
      id,
      file: `${id}.jpeg`,
      label: `Placeholder board ${i + 1} (${scene})`,
      class: scene,
      padRois: padRois.map((r) => ({ x: r.x / W, y: r.y / H, w: r.w / W, h: r.h / H })),
    });
  }
  const manifest = {
    dataset: 'pcb-aoi-placeholder',
    attribution:
      'Placeholder schematic boards for demo. Replace by running: node scripts/build-boards.mjs --data <pcb-aoi-dataset>. Real data (PCB-AoI) credited to KubeEdge-Ianvs; China Telecom Research Institute and Raisecom Technology.',
    boards,
  };
  writeFileSync(join(OUT_DIR, 'boards.json'), JSON.stringify(manifest, null, 2));
  console.log(`Wrote ${boards.length} placeholder boards to ${OUT_DIR}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
