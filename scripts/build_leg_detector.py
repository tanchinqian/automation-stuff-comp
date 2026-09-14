#!/usr/bin/env python3
"""Build a single-class "leg" detector end to end.

Pipeline (run with:  python scripts/build_leg_detector.py):

  STEP 1  Generate leg-detection labels.
            - Reads every image in train_data/JPEGImages (and test_data/
              JPEGImages) - all 600x600 boards.
            - Tries each zone TEMPLATE from scripts/leg_zones.py and keeps the
              one whose boxes land on actual pins (measured by pixel colour/
              variance inside the box vs. the dark background). Pins carry the
              colourful SPI height-map signature; background is dark/flat.
            - Converts each matched zone rectangle to a YOLO label line
              "0 xc yc w h" (normalized 0-1), class id always 0 ("leg").
            - Writes labels into dataset_leg_detection/labels/<split>/ and
              copies the images into dataset_leg_detection/images/<split>/.
            - Splits into train/val 80/20, keeping images that share the same
              original board stem in the same split (no cross-split leakage).
            - Writes leg_detection.yaml and prints a summary.

  STEP 2  Safety check. If more than 10% of images had zero legs found, stop
          and refuse to train (unless --skip-check).

  STEP 3  Train. Runs `yolo detect train` via subprocess, streaming live.

  STEP 4  Validate. Runs `yolo detect val` via subprocess, streaming, then
          prints a one-line summary (precision / recall / mAP50 / best.pt).

Usage:
  python scripts/build_leg_detector.py            # full pipeline
  python scripts/build_leg_detector.py --skip-check   # force training anyway
  python scripts/build_leg_detector.py --labels-only  # stop after STEP 1/2
"""
import argparse
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

from leg_zones import TEMPLATES

# ---------------------------------------------------------------------------
# CONFIG - tweak freely
# ---------------------------------------------------------------------------
DATA_ROOTS = ["train_data", "test_data"]   # folders with JPEGImages/
OUT_DIR = "dataset_leg_detection"          # where images/labels/data.yaml go
LEG_CLASS_ID = 0                           # YOLO class id for "leg"
VAL_RATIO = 0.2                            # fraction of groups held out for val
MAX_ZERO_RATIO = 0.10                      # safety: abort if this fraction of
                                           # images have no legs found
# How a box is judged to contain a real pin (STEP 1 scoring).
LEG_VARIANCE_MIN = 60.0      # pixel-intensity variance inside the box
LEG_SCORE_MIN = 0.5          # min fraction of boxes that must look like pins
# ---------------------------------------------------------------------------


def find_images(root: Path):
    """Every image in <root>/JPEGImages (handles .jpeg/.jpg/.png)."""
    files = []
    for pattern in ("*.jpeg", "*.jpg", "*.png", "*.JPG", "*.JPEG"):
        files.extend((root / "JPEGImages").glob(pattern))
    return sorted(set(files))


def box_leg_score(image, box):
    """Score how much one rectangle looks like a pin.

    Pins have the colourful SPI height-map signature (high pixel variance and
    saturated colour); the background is dark and flat. We return a variance
    measure of the box region, so a "good" pin scores high.
    """
    x1, y1, x2, y2 = box
    x1, y2 = max(0, int(x1)), min(image.width, int(x2))
    y1, y2 = max(0, int(y1)), min(image.height, int(y2))
    if x2 <= x1 or y2 <= y1:
        return 0.0
    region = image.crop((x1, y1, x2, y2)).convert("RGB")
    arr = np.asarray(region, dtype=np.float32)  # (h, w, 3)
    # variance across the whole box (all channels averaged) is a good pin signal
    return float(arr.var())


def choose_template(image, template_box_list):
    """Return the (name, [boxes]) whose boxes look most like pins, or None.

    A template "matches" when enough of its boxes exceed the variance
    threshold. The best match is the one with the highest mean box score.
    """
    best = None
    best_mean = -1.0
    for template in template_box_list:
        scores = [box_leg_score(image, z["box"]) for z in template["zones"]]
        mean = float(np.mean(scores))
        n_ok = sum(1 for s in scores if s >= LEG_VARIANCE_MIN)
        if n_ok / len(scores) >= LEG_SCORE_MIN and mean > best_mean:
            best = (template["name"], template["zones"])
            best_mean = mean
    return best


def to_yolo_line(box, w, h):
    """One normalized YOLO label line for a leg rectangle."""
    x1, y1, x2, y2 = box
    x1, y1 = min(x1, x2), min(y1, y2)
    x2, y2 = max(x1, x2), max(y1, y2)
    x1, y1 = max(0, min(w, x1)), max(0, min(h, y1))
    x2, y2 = max(0, min(w, x2)), max(0, min(h, y2))
    if x2 <= x1 or y2 <= y1:
        return None
    xc = ((x1 + x2) / 2) / w
    yc = ((y1 + y2) / 2) / h
    bw = (x2 - x1) / w
    bh = (y2 - y1) / h
    return f"{LEG_CLASS_ID} {xc:.6f} {yc:.6f} {bw:.6f} {bh:.6f}"


def make_labels(image_paths, out_dir):
    """Label every image: returns (labeled, skipped, summary dict)."""
    labeled = []   # (image_path, boxes)
    skipped = []   # image_paths with no matched template

    for img_path in image_paths:
        image = Image.open(img_path).convert("RGB")
        w, h = image.size
        match = choose_template(image, TEMPLATES)
        if match is None:
            skipped.append(img_path)
            continue

        tname, zones = match
        lines = [to_yolo_line(z["box"], w, h) for z in zones]
        lines = [ln for ln in lines if ln is not None]
        if not lines:
            skipped.append(img_path)
            continue

        labeled.append((img_path, tname, lines))

    return labeled, skipped


def group_by_board(entries):
    """Group image stems that share the same original board name.

    With no augmentation file, group by the first token of the stem (everything
    before "-SPI-AOI"), so copies of one board stay together.
    """
    groups = {}
    for entry in entries:
        img_path = entry[0]
        stem = img_path.stem
        # board key = stem up to the first "-SPI-AOI" marker (keeps all copies)
        key = stem.split("-SPI-AOI")[0]
        groups.setdefault(key, []).append(entry)
    return list(groups.values())


def split_groups(groups, val_ratio):
    """Deterministic 80/20 split of whole board-groups into train/val."""
    groups = sorted(groups, key=lambda g: sorted(p[0].name for p in g)[0])
    n_val = max(1, int(round(len(groups) * val_ratio)))
    val_groups = set()
    for i in range(0, len(groups), max(1, len(groups) // n_val)):
        val_groups.add(i)
        if len(val_groups) >= n_val:
            break
    train, val = [], []
    for i, g in enumerate(groups):
        (val if i in val_groups else train).extend(g)
    return train, val


def write_dataset(labeled, val_ratio, out_dir):
    """Write images/labels for train and val, plus the yaml. Returns summary."""
    out = Path(out_dir)
    train_lbl = out / "labels" / "train"
    val_lbl = out / "labels" / "val"
    train_img = out / "images" / "train"
    val_img = out / "images" / "val"
    for d in (train_lbl, val_lbl, train_img, val_img):
        d.mkdir(parents=True, exist_ok=True)

    # split on board groups, keeping whole groups on one side
    train_entries, val_entries = split_groups(group_by_board(labeled), val_ratio)

    n_train = n_val = 0
    for entries, lbl_dir, img_dir in (
        (train_entries, train_lbl, train_img),
        (val_entries, val_lbl, val_img),
    ):
        for img_path, tname, lines in entries:
            shutil.copy2(img_path, img_dir / img_path.name)
            (lbl_dir / f"{img_path.stem}.txt").write_text("\n".join(lines) + "\n")
            n_train += 1 if lbl_dir is train_lbl else 0
            n_val += 1 if lbl_dir is val_lbl else 0

    # yaml
    yaml_path = out / "leg_detection.yaml"
    (out / "leg_detection.yaml").write_text(
        f"path: {out.resolve().as_posix()}\n"
        "train: images/train\n"
        "val: images/val\n"
        "names:\n"
        "  0: leg\n"
    )
    return n_train, n_val, yaml_path


def run_subprocess(args):
    """Run a command, streaming stdout/stderr live to the terminal."""
    print(f"\n$ {' '.join(args)}\n")
    proc = subprocess.Popen(
        args,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        # errors="replace" so a stray non-UTF8 byte never crashes live output
        errors="replace",
        bufsize=1,
    )
    for line in iter(proc.stdout.readline, ""):
        print(line, end="", flush=True)
    proc.stdout.close()
    code = proc.wait()
    if code != 0:
        raise SystemExit(f"command failed with exit code {code}: {args}")
    return code


def main():
    parser = argparse.ArgumentParser(description="Build a single-class leg detector.")
    parser.add_argument("--skip-check", action="store_true",
                        help="force training even if >10% of images have no legs")
    parser.add_argument("--labels-only", action="store_true",
                        help="stop after generating labels (no training)")
    parser.add_argument("--dataset", nargs="*", default=DATA_ROOTS,
                        help="folders with JPEGImages (default: train_data test_data)")
    args = parser.parse_args()

    # ---- STEP 1: gather images and label them ----------------------------
    all_images = []
    for root_name in args.dataset:
        all_images.extend(find_images(Path(root_name)))
    if not all_images:
        raise SystemExit("No images found in the dataset folders.")

    labeled, skipped = make_labels(all_images, OUT_DIR)
    n_train, n_val, yaml_path = write_dataset(labeled, VAL_RATIO, OUT_DIR)

    print("\n===== STEP 1 SUMMARY =====")
    print(f"images labeled : {len(labeled)}  (train {n_train} / val {n_val})")
    print(f"images skipped : {len(skipped)}  (no legs found)")
    if skipped:
        print("skipped files (zero legs found):")
        for p in sorted(skipped):
            print(f"  {p}")
    print(f"yaml           : {yaml_path}")

    # ---- STEP 2: safety check ---------------------------------------------
    total = len(labeled) + len(skipped)
    zero_ratio = len(skipped) / total if total else 0.0
    print(f"\n===== STEP 2 SAFETY CHECK =====")
    print(f"zero-legs ratio: {zero_ratio:.1%}  (limit {MAX_ZERO_RATIO:.0%})")
    if zero_ratio > MAX_ZERO_RATIO and not args.skip_check:
        print(f"ABORT: {len(skipped)} images had zero legs found ({zero_ratio:.1%} > "
              f"{MAX_ZERO_RATIO:.0%}). The templates likely need fixing.")
        print("Fix scripts/leg_zones.py TEMPLATES, then re-run. Use --skip-check "
              "to override this guard.")
        raise SystemExit(1)

    print("Labels look good, proceeding to training...")

    if args.labels_only:
        print("\n--labels-only set: stopping after label generation.")
        return

    # ---- STEP 3: train -----------------------------------------------------
    run_subprocess([
        "yolo", "detect", "train",
        f"data={yaml_path}",
        "model=yolov8n.pt",
        "epochs=30",
        "imgsz=640",
        "name=leg_detector",
    ])

    # ---- STEP 4: validate ---------------------------------------------------
    best_pt = Path("runs/detect/leg_detector/weights/best.pt")
    if not best_pt.exists():
        raise SystemExit(f"best.pt not found at {best_pt}")
    run_subprocess([
        "yolo", "detect", "val",
        f"model={best_pt}",
        f"data={yaml_path}",
    ])

    # final summary: read the authoritative numbers from the val results dir
    p = r = m = None
    results_path = Path("runs/detect/leg_detector/val")
    if results_path.exists():
        # ultralytics writes results.csv with rows per class; grab the last row
        import csv
        csv_path = results_path / "results.csv"
        if csv_path.exists():
            rows = list(csv.DictReader(open(csv_path)))
            if rows:
                last = rows[-1]
                try:
                    p = float(last.get("metrics/precision(B)", 0))
                    r = float(last.get("metrics/recall(B)", 0))
                    m = float(last.get("metrics/mAP50(B)", 0))
                except ValueError:
                    pass
    print("\n===== FINAL RESULT =====")
    print(f"precision: {p if p is not None else 'n/a'}")
    print(f"recall   : {r if r is not None else 'n/a'}")
    print(f"mAP50    : {m if m is not None else 'n/a'}")
    print(f"best.pt  : {best_pt}")


if __name__ == "__main__":
    main()