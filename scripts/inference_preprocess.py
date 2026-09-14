#!/usr/bin/env python3
"""Inference-time preprocessing for the stage-2 leg crop classifier.

This is an INFERENCE-ONLY helper (it will be imported by the app later). It
does NOT touch any saved model, and it does NOT modify training code or the
dataset folders.

The idea: "Less Paste" crops look too similar to "Good" ones because the SPI
height-map colour differences are subtle. So at inference time (only) we can
boost the saturation of the crop before feeding it to the model, to make the
colour signature more pronounced.

Public API:
    preprocess_crop(image)              -> np.ndarray (1, 3, 128, 128) float32
    classify_crop(session, image, labels) -> (display_label, confidence_pct)

Run the comparison test:
    python scripts/inference_preprocess.py --test
"""
import argparse
import json
import random
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image

# ---------------------------------------------------------------------------
# CONFIG
# ---------------------------------------------------------------------------
SAT_BOOST = 1.4          # saturation multiplier applied at inference time
IMG_SIZE = 128
ONNX_PATH = Path("models/leg_classifier.onnx")
LABELS_PATH = Path("models/leg_classifier_labels.json")
TEST_DIR = Path("output/test")                  # read-only
PREVIEW_DIR = Path("inspect/sat_boost_preview")  # saved preview images

IMAGENET_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
IMAGENET_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)

# class folder -> display name (folders are read-only here)
FOLDER_TO_DISPLAY = {
    "Bad_podu": "Less Paste",
    "Bad_qiaojiao": "Bridging",
    "good": "Good",
}
N_TEST_SAMPLES = 10
SEED = 42
# ---------------------------------------------------------------------------


def boost_saturation(rgb_image: Image.Image, factor: float) -> Image.Image:
    """Multiply the HSV saturation channel by `factor` and return an RGB image.

    HSV in PIL stores each channel as 0-255, so we scale S and clip to keep it
    in range. factor=1.0 leaves the image unchanged (baseline).
    """
    if factor == 1.0:
        return rgb_image

    hsv = rgb_image.convert("HSV")
    arr = np.asarray(hsv, dtype=np.float32)
    arr[:, :, 1] = np.clip(arr[:, :, 1] * factor, 0.0, 255.0)  # S channel
    boosted = Image.fromarray(arr.astype(np.uint8), mode="HSV")
    return boosted.convert("RGB")


def preprocess_crop(image: Image.Image, sat_boost: float = SAT_BOOST) -> np.ndarray:
    """Resize -> saturation boost -> ImageNet normalize -> NCHW float32.

    Returns an array of shape (1, 3, 128, 128) ready for onnxruntime input.
    """
    # a) resize to 128x128 with high-quality LANCZOS resampling
    img = image.convert("RGB").resize((IMG_SIZE, IMG_SIZE), Image.LANCZOS)

    # b) boost saturation in HSV space
    img = boost_saturation(img, sat_boost)

    # c) ImageNet normalization: (pixel/255 - mean) / std, per channel
    arr = np.asarray(img, dtype=np.float32) / 255.0        # HWC, 0..1
    arr = (arr - IMAGENET_MEAN) / IMAGENET_STD             # broadcast over H,W

    # d) HWC -> CHW and add the batch dimension
    arr = np.transpose(arr, (2, 0, 1))                     # CHW
    return np.expand_dims(arr, 0).astype(np.float32)       # (1, 3, H, W)


def _softmax(logits: np.ndarray) -> np.ndarray:
    exp = np.exp(logits - logits.max())
    return exp / exp.sum()


def classify_crop(session, image: Image.Image, labels: dict,
                  sat_boost: float = SAT_BOOST):
    """Run the ONNX classifier on one crop.

    Returns (predicted_display_label, confidence_percentage).
    """
    tensor = preprocess_crop(image, sat_boost=sat_boost)
    input_name = session.get_inputs()[0].name
    logits = session.run(None, {input_name: tensor})[0][0]
    probs = _softmax(logits)
    idx = int(probs.argmax())
    return labels[str(idx)], float(probs[idx] * 100.0)


def load_session_and_labels():
    """Load the ONNX session and the index->display-name sidecar."""
    if not ONNX_PATH.exists():
        raise SystemExit(f"missing model: {ONNX_PATH}")
    if not LABELS_PATH.exists():
        raise SystemExit(f"missing labels: {LABELS_PATH}")
    session = ort.InferenceSession(str(ONNX_PATH),
                                   providers=["CPUExecutionProvider"])
    labels = json.loads(LABELS_PATH.read_text())
    return session, labels


def sample_test_crops(n=N_TEST_SAMPLES, seed=SEED):
    """Pick a mix of crops across the three test classes.

    Returns a list of (path, true_display_label). We bias the sample to
    include the rare Bridging class while keeping 10 total.
    """
    rng = random.Random(seed)
    per_class = [("Bad_podu", 3), ("Bad_qiaojiao", 3), ("good", n - 6)]
    picks = []
    for cls, count in per_class:
        folder = TEST_DIR / cls
        files = sorted(p for p in folder.glob("*")
                       if p.suffix.lower() in (".jpg", ".jpeg", ".png"))
        take = min(count, len(files))
        picks.extend((p, FOLDER_TO_DISPLAY[cls]) for p in rng.sample(files, take))
    return picks


def run_table(picks, session, labels, sat_boost):
    """Classify the sampled crops at one SAT_BOOST value; return rows + acc."""
    rows = []
    correct = 0
    for path, true_label in picks:
        img = Image.open(path).convert("RGB")
        pred, conf = classify_crop(session, img, labels, sat_boost=sat_boost)
        ok = pred == true_label
        correct += int(ok)
        rows.append((path.name, true_label, pred, conf, ok))
    acc = correct / len(rows) * 100.0 if rows else 0.0
    return rows, acc


def print_table(title, rows, acc, sat_boost):
    print(f"\n{title}  (SAT_BOOST={sat_boost})")
    print("-" * 86)
    print(f"{'filename':38s} {'true':>11s} {'pred':>11s} {'conf%':>7s}  correct")
    print("-" * 86)
    for name, true_label, pred, conf, ok in rows:
        print(f"{name:38s} {true_label:>11s} {pred:>11s} {conf:6.1f}%"
              f"  {'yes' if ok else 'NO'}")
    print("-" * 86)
    print(f"accuracy on these {len(rows)} samples: {acc:.1f}%")


def save_previews(picks, sat_boost):
    """Save the resized + saturation-boosted crops so they can be eyeballed."""
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    for path, _ in picks:
        img = Image.open(path).convert("RGB")
        resized = img.resize((IMG_SIZE, IMG_SIZE), Image.LANCZOS)
        boosted = boost_saturation(resized, sat_boost)   # before normalization
        out = PREVIEW_DIR / f"{path.stem}_sat{sat_boost}.jpg"
        boosted.save(out, quality=95)
    print(f"\nSaved {len(picks)} SAT_BOOST={sat_boost} previews to {PREVIEW_DIR}/")


def main():
    parser = argparse.ArgumentParser(description="Inference preprocessing utility.")
    parser.add_argument("--test", action="store_true",
                        help="run the SAT_BOOST comparison on 10 random test crops")
    args = parser.parse_args()

    if not args.test:
        print("Nothing to do. Run with --test to compare SAT_BOOST values.")
        return

    session, labels = load_session_and_labels()
    picks = sample_test_crops()
    print(f"Model : {ONNX_PATH}")
    print(f"Labels: {labels}")
    print(f"Sampled {len(picks)} crops from {TEST_DIR} "
          f"(3 Less Paste / 3 Bridging / 4 Good)")

    # run once without boost (baseline) and once with the boost
    rows_base, acc_base = run_table(picks, session, labels, sat_boost=1.0)
    rows_boost, acc_boost = run_table(picks, session, labels, sat_boost=SAT_BOOST)

    print_table("BASELINE", rows_base, acc_base, 1.0)
    print_table("BOOSTED", rows_boost, acc_boost, SAT_BOOST)

    # quick verdict
    print("\n" + "=" * 40)
    print(f"baseline accuracy: {acc_base:.1f}%")
    print(f"boosted  accuracy: {acc_boost:.1f}%")
    if acc_boost > acc_base:
        print("SAT_BOOST helped on these samples.")
    elif acc_boost < acc_base:
        print("SAT_BOOST hurt on these samples.")
    else:
        print("SAT_BOOST made no difference on these samples.")

    save_previews(picks, SAT_BOOST)


if __name__ == "__main__":
    main()
