#!/usr/bin/env python3
"""Train a single-class "leg" YOLO detector (stage 1 of the defect pipeline).

Run as a file (not -c) so accelerator/worker processes work on Windows:
  python scripts/train_leg_detector.py

What it does:
  STEP 1  Verify the dataset (yaml exists, image/label counts match, spot-check
          a few label files are valid normalized YOLO format) and print go/no-go.
  STEP 2  Train with `yolo detect train ...` (streamed live).
  STEP 3  Locate the newest best.pt and run `yolo detect val ...` (streamed),
          then print a one-line metric summary and whether targets were met.
"""
import random
import re
import subprocess
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# CONFIG
# ---------------------------------------------------------------------------
DATASET_DIR = "dataset_leg_detection_v2"
YAML_NAME = "leg_detection_v2.yaml"
RUN_NAME = "leg_detector_v2"
RUNS_DIR = Path("runs/detect")
SPOT_CHECK_N = 5          # how many label files to validate in STEP 1
SEED = 42                 # seed for the spot-check sample

# Training hyper-parameters (passed straight to the yolo CLI)
TRAIN_ARGS = [
    "model=yolov8n.pt",
    "epochs=50",
    "imgsz=640",
    f"name={RUN_NAME}",
    "patience=10",
    "hsv_h=0.015",
    "hsv_s=0.3",
    "hsv_v=0.3",
    "fliplr=0.5",
    "flipud=0.0",
    "degrees=10",
    "mosaic=0.5",
]

# Target metrics to aim for
TARGET_PRECISION = 0.70
TARGET_RECALL = 0.70
TARGET_MAP50 = 0.65
# ---------------------------------------------------------------------------


def find_yaml():
    """Locate leg_detection_v2.yaml (repo root or inside the dataset folder)."""
    for candidate in (Path(YAML_NAME), Path(DATASET_DIR) / YAML_NAME):
        if candidate.exists():
            return candidate.resolve()
    return None


def count_files(folder: Path):
    """Count image/label files, ignoring subfolders and non-matching suffixes."""
    if not folder.exists():
        return 0
    exts = {".jpg", ".jpeg", ".png", ".txt"}
    return sum(1 for p in folder.iterdir()
               if p.is_file() and p.suffix.lower() in exts)


def check_label_file(path: Path):
    """Validate one YOLO label file. Returns (ok, problem_message)."""
    # an empty label file is technically valid (image with no legs), but the
    # blob generator writes an empty line for those, so accept empty content
    text = path.read_text().strip()
    if not text:
        return True, ""
    for lineno, line in enumerate(text.splitlines(), start=1):
        parts = line.split()
        if len(parts) != 5:
            return False, f"{path.name}:{lineno} has {len(parts)} values, expected 5"
        try:
            cls = int(float(parts[0]))
            vals = [float(v) for v in parts[1:]]
        except ValueError:
            return False, f"{path.name}:{lineno} has non-numeric values"
        if cls != 0:
            return False, f"{path.name}:{lineno} class_id is {cls}, expected 0"
        if any(v < 0.0 or v > 1.0 for v in vals):
            return False, f"{path.name}:{lineno} has a value outside 0-1"
    return True, ""


def step1_verify():
    """Return the resolved yaml Path on success, or None on a failed check."""
    print("=" * 60)
    print("STEP 1 - Verify dataset")
    print("=" * 60)

    yaml_path = find_yaml()
    if yaml_path is None:
        print(f"NO-GO: {YAML_NAME} not found in the repo root or {DATASET_DIR}/.")
        print("Run scripts/generate_leg_labels_blobs.py first.")
        return None
    print(f"yaml                 : {yaml_path}")

    # image/label counts for each split
    counts = {}
    for split in ("train", "val"):
        n_img = count_files(Path(DATASET_DIR) / "images" / split)
        n_lbl = count_files(Path(DATASET_DIR) / "labels" / split)
        counts[split] = (n_img, n_lbl)
        print(f"{split:6s} images/labels  : {n_img} / {n_lbl}")

    # must have images and a label file for every image
    problems = []
    for split, (n_img, n_lbl) in counts.items():
        if n_img == 0:
            problems.append(f"{split} has no images")
        if n_img != n_lbl:
            problems.append(f"{split} image/label count mismatch ({n_img} vs {n_lbl})")

    # spot-check random label files for valid normalized YOLO format
    rng = random.Random(SEED)
    all_labels = []
    for split in ("train", "val"):
        all_labels.extend(sorted((Path(DATASET_DIR) / "labels" / split).glob("*.txt")))
    sample = rng.sample(all_labels, min(SPOT_CHECK_N, len(all_labels))) if all_labels else []
    print(f"\nSpot-checking {len(sample)} random label files:")
    for lbl in sample:
        ok, msg = check_label_file(lbl)
        status = "OK" if ok else "FAIL"
        print(f"  [{status}] {lbl.name}" + (f"  -> {msg}" if msg else ""))
        if not ok:
            problems.append(msg)

    if problems:
        print("\nNO-GO - fix these before training:")
        for p in problems:
            print(f"  - {p}")
        return None

    print("\nGO - dataset looks valid, proceeding to training.\n")
    return yaml_path


def run_subprocess(args):
    """Run a command, stream stdout/stderr live, return the captured text.

    Reads as UTF-8 with errors='replace' so Ultralytics' box-drawing characters
    never crash the reader on Windows (default cp1252).
    """
    print(f"\n$ {' '.join(args)}\n")
    proc = subprocess.Popen(
        args,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
    )
    lines = []
    for line in iter(proc.stdout.readline, ""):
        print(line, end="", flush=True)
        lines.append(line)
    proc.stdout.close()
    code = proc.wait()
    if code != 0:
        raise SystemExit(f"command failed with exit code {code}: {args}")
    return "".join(lines)


def find_best_pt(prefix=RUN_NAME):
    """Newest runs/detect/<prefix>* folder that actually contains best.pt.

    Handles Ultralytics auto-incrementing names (leg_detector_v2,
    leg_detector_v22, leg_detector_v23, ...).
    """
    candidates = [d for d in RUNS_DIR.glob(f"{prefix}*") if d.is_dir()]
    # newest first by modification time
    candidates.sort(key=lambda d: d.stat().st_mtime, reverse=True)
    for d in candidates:
        best = d / "weights" / "best.pt"
        if best.exists():
            return best.resolve(), d
    return None, None


def parse_metrics(text):
    """Pull the 'all' row metrics from the streamed val output.

    Ultralytics prints something like:
      Class  Images  Instances  Box(P  R  mAP50  mAP50-95)
      all      173       3800     0.65  0.60  0.62  0.40
    Returns (precision, recall, map50, map50_95) or Nones.
    """
    pattern = re.compile(
        r"\ball\b\s+(\d+)\s+(\d+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)")
    for line in text.splitlines():
        m = pattern.search(line)
        if m:
            try:
                return (float(m.group(3)), float(m.group(4)),
                        float(m.group(5)), float(m.group(6)))
            except ValueError:
                continue
    return None, None, None, None


def step2_train(yaml_path: Path):
    """Run the training subprocess (streamed live)."""
    print("=" * 60)
    print("STEP 2 - Train")
    print("=" * 60)
    run_subprocess([
        "yolo", "detect", "train",
        f"data={yaml_path}",
        *TRAIN_ARGS,
    ])
    print("\nTraining finished.")


def step3_validate(yaml_path: Path):
    """Locate best.pt, validate, print metrics + target check."""
    print("\n" + "=" * 60)
    print("STEP 3 - Validate")
    print("=" * 60)

    best_pt, run_dir = find_best_pt()
    if best_pt is None:
        print(f"NO best.pt found under {RUNS_DIR}/{RUN_NAME}*/weights/.")
        return
    print(f"Using weights: {best_pt}")

    text = run_subprocess([
        "yolo", "detect", "val",
        f"model={best_pt}",
        f"data={yaml_path}",
    ])

    p, r, m50, m5095 = parse_metrics(text)
    if p is None:
        print("\nCould not parse metrics from the val output.")
        print(f"Model saved at: {best_pt}")
        return

    def fmt(v):
        return f"{v:.3f}" if v is not None else "n/a"

    print("\n" + "=" * 60)
    print("FINAL SUMMARY")
    print("=" * 60)
    print(f"Precision: {fmt(p)}  Recall: {fmt(r)}  "
          f"mAP50: {fmt(m50)}  mAP50-95: {fmt(m5095)}")
    print(f"Model saved at: {best_pt}")

    # target achievement
    checks = [
        ("Precision > 0.7", p > TARGET_PRECISION),
        ("Recall    > 0.7", r > TARGET_RECALL),
        ("mAP50     > 0.65", m50 > TARGET_MAP50),
    ]
    print("\nTargets:")
    for label, passed in checks:
        print(f"  [{'PASS' if passed else 'FAIL'}] {label}")
    if all(ok for _, ok in checks):
        print("\nAll targets met. Ready for stage 2 (leg crop classifier).")
    else:
        print("\nSome targets missed - consider more epochs, more data, or "
              "looser augmentation.")


def main():
    yaml_path = step1_verify()
    if yaml_path is None:
        sys.exit(1)
    step2_train(yaml_path)
    step3_validate(yaml_path)


if __name__ == "__main__":
    main()
