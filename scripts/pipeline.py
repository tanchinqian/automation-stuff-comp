#!/usr/bin/env python3
"""End-to-end PCB solder defect pipeline (Stage 1 YOLO + Stage 2 classifier).

Stage 1 (YOLO) finds leg/pin boxes on a full board image.
Stage 2 (ONNX classifier) classifies each cropped leg as Less Paste / Bridging
/ Good. This module wires them together.

Two ways to use it:
  a. directly:  python scripts/pipeline.py --test
  b. imported :  from scripts.pipeline import analyze_board
                 result = analyze_board("path/to/image.jpg")

Config is loaded from pipeline_config.json (created on first direct run).
"""
import argparse
import json
import random
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image

# --- make imports work both when run directly and when imported as a package --
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))
try:
    from scripts.inference_preprocess import classify_crop
except ImportError:                                    # run directly
    from inference_preprocess import classify_crop

# ---------------------------------------------------------------------------
# Defaults (overridden by pipeline_config.json when present)
# ---------------------------------------------------------------------------
CONFIG_PATH = ROOT / "pipeline_config.json"
DEFAULTS = {
    "yolo_model": "runs/detect/leg_detector_v2-2/weights/best.pt",
    "classifier_model": "models/leg_classifier.onnx",
    "classifier_labels": "models/leg_classifier_labels.json",
    "crop_padding": 8,
    "sat_boost": 1.0,
    "confidence_threshold": 70,
    "version": "1.0",
}
YOLO_CONF = 0.25          # YOLO detection confidence (not in the config spec)
TEST_IMAGES_DIR = ROOT / "train_data/JPEGImages"
TEST_N = 5
SEED = 42
# ---------------------------------------------------------------------------


def load_config() -> dict:
    """Load pipeline_config.json if it exists, else use defaults."""
    if CONFIG_PATH.exists():
        cfg = dict(DEFAULTS)
        cfg.update(json.loads(CONFIG_PATH.read_text()))
        return cfg
    return dict(DEFAULTS)


CFG = load_config()

# paths resolved against the project root so imports work from anywhere
CFG["yolo_model"] = str((ROOT / CFG["yolo_model"]).resolve())
CFG["classifier_model"] = str((ROOT / CFG["classifier_model"]).resolve())
CFG["classifier_labels"] = str((ROOT / CFG["classifier_labels"]).resolve())

# module-level caches so the models load exactly once per process
_YOLO = None
_SESSION = None
_LABELS = None


def get_yolo():
    """Load the YOLO leg detector once (lazy)."""
    global _YOLO
    if _YOLO is None:
        from ultralytics import YOLO      # heavy import, deferred
        _YOLO = YOLO(CFG["yolo_model"])
    return _YOLO


def get_classifier():
    """Load the ONNX classifier session + label mapping once (lazy)."""
    global _SESSION, _LABELS
    if _SESSION is None:
        _SESSION = ort.InferenceSession(
            CFG["classifier_model"], providers=["CPUExecutionProvider"])
        _LABELS = json.loads(Path(CFG["classifier_labels"]).read_text())
    return _SESSION, _LABELS


def load_models():
    """STEP 1: load both models and print a confirmation."""
    yolo = get_yolo()
    session, labels = get_classifier()
    print("Models loaded:")
    print(f"  Stage 1 YOLO  : {CFG['yolo_model']}")
    print(f"  Stage 2 ONNX  : {CFG['classifier_model']}")
    print(f"  Labels        : {labels}")
    return yolo, session, labels


def analyze_board(image_path: str) -> dict:
    """Run the full pipeline on one board image. See module docstring."""
    yolo = get_yolo()
    session, labels = get_classifier()
    pad = int(CFG["crop_padding"])
    sat_boost = float(CFG["sat_boost"])
    conf_thr = float(CFG["confidence_threshold"])

    img = Image.open(image_path).convert("RGB")
    width, height = img.size

    # --- Stage 1: detect legs ------------------------------------------------
    results = yolo.predict(source=str(image_path), conf=YOLO_CONF, verbose=False)
    boxes = results[0].boxes

    counts = {"Less Paste": 0, "Bridging": 0, "Good": 0}
    legs = []

    if boxes is not None and len(boxes) > 0:
        xyxy = boxes.xyxy.cpu().numpy()
        for i, (x1, y1, x2, y2) in enumerate(xyxy, start=1):
            # --- Stage 2a: crop with padding (clamped to the image) ----------
            px1 = max(0, int(x1) - pad)
            py1 = max(0, int(y1) - pad)
            px2 = min(width, int(x2) + pad)
            py2 = min(height, int(y2) + pad)
            crop = img.crop((px1, py1, px2, py2))

            # --- Stage 2b: classify the crop --------------------------------
            label, conf = classify_crop(session, crop, labels,
                                        sat_boost=sat_boost)
            flag = (label != "Good") or (conf < conf_thr)
            counts[label] = counts.get(label, 0) + 1
            legs.append({
                "leg_id": i,
                "bbox": [int(x1), int(y1), int(x2), int(y2)],  # tight bbox
                "label": label,
                "confidence": round(float(conf), 2),
                "flag": bool(flag),
            })

    total = len(legs)
    flagged = sum(1 for l in legs if l["flag"])
    low_conf = sum(1 for l in legs if l["confidence"] < conf_thr)

    # --- board verdict -------------------------------------------------------
    if total == 0:
        verdict = "ERROR - no legs found"
    elif any(l["label"] != "Good" for l in legs):
        verdict = "FAIL"
    else:
        verdict = "PASS"

    return {
        "image_path": str(image_path),
        "board_verdict": verdict,
        "defect_summary": counts,
        "total_legs_detected": total,
        "legs": legs,
        "flagged_legs": flagged,
        "low_confidence_count": low_conf,
    }


def print_report(result: dict):
    """Pretty-print one analyze_board() result (STEP 4 format)."""
    edge = "=" * 32
    print(edge)
    print(f"Image: {Path(result['image_path']).name}")
    print(f"Board verdict: {result['board_verdict']}")
    print(f"Legs detected: {result['total_legs_detected']}")
    ds = result["defect_summary"]
    print(f"Defects found: Less Paste x{ds['Less Paste']}, "
          f"Bridging x{ds['Bridging']}, Good x{ds['Good']}")
    print(f"Flagged legs: {result['flagged_legs']}")
    print(f"Low confidence: {result['low_confidence_count']}")
    print("\nLeg details:")
    for leg in result["legs"]:
        x1, y1, x2, y2 = leg["bbox"]
        bbox = f"[{x1:4d},{y1:4d},{x2:4d},{y2:4d}]"
        line = f"#{leg['leg_id']:<3d} {bbox}  {leg['label']:<11s} " \
               f"{leg['confidence']:5.1f}%"
        if leg["flag"]:
            line += "  \u26a0 FLAGGED"
        print(line)
    print(edge)


def run_test():
    """STEP 4: analyze N random training images and print reports."""
    load_models()
    files = sorted(p for p in TEST_IMAGES_DIR.glob("*")
                   if p.suffix.lower() in (".jpg", ".jpeg", ".png"))
    if not files:
        raise SystemExit(f"no images in {TEST_IMAGES_DIR}")
    rng = random.Random(SEED)
    picks = rng.sample(files, min(TEST_N, len(files)))

    for path in picks:
        result = analyze_board(str(path))
        print()
        print_report(result)


def write_config():
    """STEP 6: create pipeline_config.json from the defaults if missing."""
    if not CONFIG_PATH.exists():
        CONFIG_PATH.write_text(json.dumps(DEFAULTS, indent=2))
        print(f"Wrote {CONFIG_PATH}")
    else:
        print(f"Using existing {CONFIG_PATH}")


def main():
    # make unicode (e.g. the warning symbol) print safely on Windows consoles
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:      # noqa: BLE001
        pass

    parser = argparse.ArgumentParser(description="PCB defect pipeline")
    parser.add_argument("--test", action="store_true",
                        help="analyze 5 random training images")
    args = parser.parse_args()

    write_config()
    if args.test:
        run_test()
    else:
        # load models so the user sees they work even without --test
        load_models()


if __name__ == "__main__":
    main()
