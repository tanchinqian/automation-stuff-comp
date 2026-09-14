#!/usr/bin/env python3
"""Stage 2: train a 3-class leg crop classifier (Less Paste / Bridging / Good).

The dataset folders on disk use internal names:
    Bad_podu      -> "Less Paste"
    Bad_qiaojiao  -> "Bridging"
    good          -> "Good"
We READ folder names as-is, but everything we print/save (reports, ONNX
metadata) uses the display names.

Pipeline:
  STEP 1  Verify folders, print class counts + inverse-frequency weights.
  STEP 2  Fine-tune MobileNetV2 (last 3 feature blocks + new 3-way head),
          weighted CrossEntropy, Adam lr=1e-4, 30 epochs. Checkpoint on the
          best VALIDATION macro-F1.
  STEP 3  Evaluate the best checkpoint on the untouched test set (display
          names, per-class P/R/F1, 3x3 confusion matrix, macro F1).
  STEP 4  Export to ONNX (opset 12, dynamic batch) + label sidecar + checker.
  STEP 5  Load the ONNX model and sanity-check 5 random test crops.

Run as:
  python scripts/train_classifier.py
"""
import argparse
import json
import random
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from PIL import Image
from sklearn.metrics import (classification_report, confusion_matrix,
                             f1_score, precision_recall_fscore_support)
from sklearn.model_selection import train_test_split
from torch.utils.data import DataLoader, Dataset, Subset
from torchvision import transforms
from torchvision.models import MobileNet_V2_Weights, mobilenet_v2

# ---------------------------------------------------------------------------
# CONFIG
# ---------------------------------------------------------------------------
DATA_DIR = Path("output")          # contains train/ and test/ with class folders
CHECKPOINT_DIR = Path("checkpoints")
RESULTS_DIR = Path("results")
MODEL_DIR = Path("models")
BEST_CKPT = CHECKPOINT_DIR / "leg_classifier_best.pt"
ONNX_PATH = MODEL_DIR / "leg_classifier.onnx"
LABELS_JSON = MODEL_DIR / "leg_classifier_labels.json"
REPORT_PATH = RESULTS_DIR / "classifier_results.txt"

IMG_SIZE = 128
BATCH_SIZE = 32
EPOCHS = 30
LR = 1e-4
VAL_FRACTION = 0.15                # stratified split carved out of train/
SEED = 42

CLASS_FOLDERS = ["Bad_podu", "Bad_qiaojiao", "good"]   # sorted = index order
DISPLAY = {"Bad_podu": "Less Paste", "Bad_qiaojiao": "Bridging", "good": "Good"}

IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD = [0.229, 0.224, 0.225]

BRIDGING_RECALL_FLOOR = 0.5        # flag if Bridging recall is below this
# ---------------------------------------------------------------------------

# pick GPU when available
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")


def set_seeds(seed=SEED):
    """Make runs reproducible as far as practical."""
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)


class LegCrops(Dataset):
    """Loads all crops from data_split/<class>/*.(jpg|jpeg|png).

    Class index follows CLASS_FOLDERS order (Bad_podu=0, Bad_qiaojiao=1,
    good=2), which matches sorted folder order.
    """

    def __init__(self, root: Path, transform):
        self.transform = transform
        self.samples = []      # (path, label_index)
        for idx, cls in enumerate(CLASS_FOLDERS):
            folder = root / cls
            for p in sorted(folder.glob("*")):
                if p.suffix.lower() in (".jpg", ".jpeg", ".png"):
                    self.samples.append((p, idx))

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, i):
        path, label = self.samples[i]
        img = Image.open(path).convert("RGB")
        return self.transform(img), label


def build_transforms():
    """Resize to 128x128 and normalize with ImageNet stats."""
    tf = transforms.Compose([
        transforms.Resize((IMG_SIZE, IMG_SIZE)),
        transforms.ToTensor(),
        transforms.Normalize(mean=IMAGENET_MEAN, std=IMAGENET_STD),
    ])
    return tf


def step1_verify(train_dir):
    """Check folders, print counts and class weights. Returns counts or None."""
    print("=" * 64)
    print("STEP 1 - Verify dataset")
    print("=" * 64)

    roots = {"train": Path(train_dir), "test": DATA_DIR / "test"}
    counts = {"train": {}, "test": {}}
    problems = []
    for split in ("train", "test"):
        for cls in CLASS_FOLDERS:
            folder = roots[split] / cls
            if not folder.exists():
                problems.append(f"missing folder: {folder}")
                counts[split][cls] = 0
                continue
            n = sum(1 for p in folder.glob("*")
                    if p.suffix.lower() in (".jpg", ".jpeg", ".png"))
            counts[split][cls] = n
            if n == 0:
                problems.append(f"no images in: {folder}")

    print(f"train dir: {roots['train']}")
    print(f"test  dir: {roots['test']}")
    for split in ("train", "test"):
        print(f"\n{split.upper()}:")
        for cls in CLASS_FOLDERS:
            print(f"  {DISPLAY[cls]:11s} ({cls:13s}): {counts[split][cls]:5d}")

    # inverse-frequency class weights from the TRAIN counts:
    #   w_c = N_total / (n_classes * n_c)   (sklearn "balanced" style)
    if counts["train"] and all(counts["train"][c] > 0 for c in CLASS_FOLDERS):
        n_classes = len(CLASS_FOLDERS)
        n_total = sum(counts["train"].values())
        weights = [n_total / (n_classes * counts["train"][c]) for c in CLASS_FOLDERS]
        print("\nInverse-frequency class weights (train):")
        for cls, w in zip(CLASS_FOLDERS, weights):
            print(f"  {DISPLAY[cls]:11s}: {w:.4f}")

    if problems:
        print("\nNO-GO - fix these before training:")
        for p in problems:
            print(f"  - {p}")
        return None
    print("\nGO - dataset looks valid, proceeding to training.")
    return counts


def build_model():
    """MobileNetV2 with a fresh 3-way head; freeze all but the last 3 blocks."""
    # modern torchvision API (pretrained=True is deprecated)
    model = mobilenet_v2(weights=MobileNet_V2_Weights.IMAGENET1K_V1)

    # replace the 1000-class head with a 3-class head
    in_features = model.classifier[1].in_features   # 1280
    model.classifier[1] = nn.Linear(in_features, len(CLASS_FOLDERS))

    # 1) freeze every parameter
    for p in model.parameters():
        p.requires_grad = False

    # 2) unfreeze the last 3 feature blocks (features[16], [17], [18])
    for block in model.features[16:]:
        for p in block.parameters():
            p.requires_grad = True

    # 3) unfreeze the new classifier head
    for p in model.classifier.parameters():
        p.requires_grad = True

    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    total = sum(p.numel() for p in model.parameters())
    print(f"Trainable params: {trainable:,} / {total:,} "
          f"({100 * trainable / total:.1f}%)")
    return model.to(DEVICE)


@torch.no_grad()
def evaluate_loader(model, loader, criterion):
    """Return (loss, accuracy, macro_f1, all_preds, all_labels) for a loader."""
    model.eval()
    total_loss, n = 0.0, 0
    preds, labels = [], []
    for imgs, y in loader:
        imgs, y = imgs.to(DEVICE), y.to(DEVICE)
        logits = model(imgs)
        loss = criterion(logits, y)
        total_loss += loss.item() * y.size(0)
        n += y.size(0)
        preds.extend(logits.argmax(1).cpu().numpy().tolist())
        labels.extend(y.cpu().numpy().tolist())
    acc = float(np.mean(np.array(preds) == np.array(labels))) if n else 0.0
    f1 = f1_score(labels, preds, average="macro", labels=[0, 1, 2],
                  zero_division=0)
    return total_loss / max(1, n), acc, f1, preds, labels


def step2_train(train_counts, train_dir):
    """Fine-tune the model; save the best-on-val-macro-F1 checkpoint."""
    print("\n" + "=" * 64)
    print("STEP 2 - Train MobileNetV2 classifier")
    print("=" * 64)

    tf = build_transforms()

    # Whole train/ folder, then carve a stratified validation split out of it.
    full_train = LegCrops(Path(train_dir), tf)
    labels = [label for _, label in full_train.samples]

    indices = list(range(len(full_train)))
    train_idx, val_idx = train_test_split(
        indices, test_size=VAL_FRACTION, random_state=SEED, stratify=labels)
    train_ds = Subset(full_train, train_idx)
    val_ds = Subset(full_train, val_idx)
    print(f"Train/val split: {len(train_ds)} train, {len(val_ds)} val "
          f"(test held out untouched)")

    train_loader = DataLoader(train_ds, batch_size=BATCH_SIZE, shuffle=True,
                              num_workers=0)
    val_loader = DataLoader(val_ds, batch_size=BATCH_SIZE, shuffle=False,
                            num_workers=0)

    # class weights from the ACTUAL training subset
    sub_labels = [full_train.samples[i][1] for i in train_idx]
    counts = np.bincount(sub_labels, minlength=len(CLASS_FOLDERS))
    weights = torch.tensor(
        [len(sub_labels) / (len(CLASS_FOLDERS) * max(1, c)) for c in counts],
        dtype=torch.float32, device=DEVICE)
    print("Class weights used:", [round(w, 3) for w in weights.tolist()])

    model = build_model()
    criterion = nn.CrossEntropyLoss(weight=weights)
    optimizer = torch.optim.Adam(
        [p for p in model.parameters() if p.requires_grad], lr=LR)

    CHECKPOINT_DIR.mkdir(parents=True, exist_ok=True)
    best_f1 = -1.0
    for epoch in range(1, EPOCHS + 1):
        model.train()
        running, seen = 0.0, 0
        for imgs, y in train_loader:
            imgs, y = imgs.to(DEVICE), y.to(DEVICE)
            optimizer.zero_grad()
            logits = model(imgs)
            loss = criterion(logits, y)
            loss.backward()
            optimizer.step()
            running += loss.item() * y.size(0)
            seen += y.size(0)

        val_loss, val_acc, val_f1, _, _ = evaluate_loader(model, val_loader,
                                                          criterion)
        star = ""
        # checkpoint on VALIDATION macro F1, not accuracy (imbalanced classes)
        if val_f1 > best_f1:
            best_f1 = val_f1
            torch.save({
                "model_state": model.state_dict(),
                "class_folders": CLASS_FOLDERS,
                "display_names": DISPLAY,
                "epoch": epoch,
                "val_macro_f1": best_f1,
            }, BEST_CKPT)
            star = "  <- best"
        print(f"Epoch {epoch:2d}/{EPOCHS}  train_loss={running / seen:.4f}  "
              f"val_loss={val_loss:.4f}  val_acc={val_acc:.4f}  "
              f"val_macroF1={val_f1:.4f}{star}")

    print(f"\nBest val macro-F1: {best_f1:.4f}  (saved to {BEST_CKPT})")
    return best_f1


def step3_evaluate():
    """Load best checkpoint, evaluate on the held-out test set."""
    print("\n" + "=" * 64)
    print("STEP 3 - Evaluate on test set")
    print("=" * 64)

    tf = build_transforms()
    test_ds = LegCrops(DATA_DIR / "test", tf)
    test_loader = DataLoader(test_ds, batch_size=BATCH_SIZE, shuffle=False,
                             num_workers=0)

    model = build_model()
    ckpt = torch.load(BEST_CKPT, map_location=DEVICE, weights_only=False)
    model.load_state_dict(ckpt["model_state"])
    model.eval()

    criterion = nn.CrossEntropyLoss()
    _, acc, _, preds, labels = evaluate_loader(model, test_loader, criterion)

    display_labels = [DISPLAY[c] for c in CLASS_FOLDERS]

    # per-class precision / recall / F1
    p, r, f1, support = precision_recall_fscore_support(
        labels, preds, labels=[0, 1, 2], zero_division=0)
    macro_f1 = f1_score(labels, preds, average="macro",
                        labels=[0, 1, 2], zero_division=0)
    cm = confusion_matrix(labels, preds, labels=[0, 1, 2])
    report = classification_report(labels, preds, labels=[0, 1, 2],
                                   target_names=display_labels,
                                   zero_division=0)

    lines = []
    lines.append("STAGE 2 LEG CLASSIFIER - TEST RESULTS")
    lines.append("=" * 44)
    lines.append(f"Overall accuracy : {acc:.4f}")
    lines.append(f"Macro F1         : {macro_f1:.4f}  (primary metric)")
    lines.append("")
    lines.append("Per-class metrics (display names):")
    lines.append(f"  {'class':12s} {'precision':>9s} {'recall':>8s} "
                 f"{'f1':>8s} {'support':>8s}")
    for i, name in enumerate(display_labels):
        lines.append(f"  {name:12s} {p[i]:9.3f} {r[i]:8.3f} "
                     f"{f1[i]:8.3f} {support[i]:8d}")
    lines.append("")
    lines.append("Confusion matrix (rows = true, cols = predicted):")
    header = "  " + " " * 12 + "".join(f"{n:>12s}" for n in display_labels)
    lines.append(header)
    for i, name in enumerate(display_labels):
        row = "".join(f"{cm[i][j]:12d}" for j in range(len(display_labels)))
        lines.append(f"  {name:12s}{row}")
    lines.append("")
    lines.append(report)

    # flag weak Bridging recall explicitly (only 14 test examples)
    bridging_idx = CLASS_FOLDERS.index("Bad_qiaojiao")
    bridging_recall = r[bridging_idx]
    if bridging_recall < BRIDGING_RECALL_FLOOR:
        lines.append("")
        lines.append(f"WARNING: Bridging recall is {bridging_recall:.3f} "
                     f"(< {BRIDGING_RECALL_FLOOR}). Only "
                     f"{support[bridging_idx]} test examples - expected to be "
                     "weak; do not hide this.")

    report_text = "\n".join(lines)
    print(report_text)
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(report_text)
    print(f"\nSaved report to {REPORT_PATH}")
    return macro_f1


def step4_export():
    """Export the best model to ONNX and write the label sidecar."""
    print("\n" + "=" * 64)
    print("STEP 4 - Export to ONNX")
    print("=" * 64)

    model = build_model()
    ckpt = torch.load(BEST_CKPT, map_location="cpu", weights_only=False)
    model.load_state_dict(ckpt["model_state"])
    model.eval()
    model.to("cpu")   # export on CPU for portability

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    dummy = torch.randn(1, 3, IMG_SIZE, IMG_SIZE)
    export_kwargs = dict(
        input_names=["input"],
        output_names=["output"],
        opset_version=12,
        dynamic_axes={"input": {0: "batch"}, "output": {0: "batch"}},
    )
    try:
        # dynamo=False keeps the stable TorchScript-based exporter
        torch.onnx.export(model, dummy, str(ONNX_PATH), dynamo=False,
                          **export_kwargs)
    except TypeError:
        # older/newer torch without the dynamo kwarg
        torch.onnx.export(model, dummy, str(ONNX_PATH), **export_kwargs)

    # sidecar metadata mapping index -> display name
    labels = {str(i): DISPLAY[c] for i, c in enumerate(CLASS_FOLDERS)}
    LABELS_JSON.write_text(json.dumps(labels, indent=2))

    # verify with the ONNX checker
    import onnx
    ok = True
    try:
        onnx.checker.check_model(str(ONNX_PATH))
    except Exception as e:      # noqa: BLE001
        ok = False
        print(f"ONNX checker error: {e}")
    print(f"ONNX checker: {'PASS' if ok else 'FAIL'}")
    print(f"ONNX model : {ONNX_PATH}")
    print(f"Labels     : {LABELS_JSON} -> {labels}")
    return ok


def step5_sanity():
    """Load the exported ONNX and classify 5 random test crops."""
    print("\n" + "=" * 64)
    print("STEP 5 - ONNX sanity check")
    print("=" * 64)

    import onnxruntime as ort

    tf = build_transforms()
    test_ds = LegCrops(DATA_DIR / "test", tf)
    rng = random.Random(SEED)
    picks = rng.sample(range(len(test_ds)), min(5, len(test_ds)))

    session = ort.InferenceSession(str(ONNX_PATH),
                                   providers=["CPUExecutionProvider"])
    input_name = session.get_inputs()[0].name

    print(f"{'filename':45s} {'true':>11s} {'pred':>11s} {'conf%':>7s}")
    for i in picks:
        img_tensor, label = test_ds[i]
        arr = img_tensor.unsqueeze(0).numpy().astype(np.float32)
        logits = session.run(None, {input_name: arr})[0][0]
        # softmax for a confidence percentage
        exp = np.exp(logits - logits.max())
        probs = exp / exp.sum()
        pred = int(probs.argmax())
        true_name = DISPLAY[CLASS_FOLDERS[label]]
        pred_name = DISPLAY[CLASS_FOLDERS[pred]]
        fname = test_ds.samples[i][0].name
        print(f"{fname:45s} {true_name:>11s} {pred_name:>11s} "
              f"{100 * probs[pred]:6.1f}%")


def main():
    parser = argparse.ArgumentParser(description="Train the stage-2 leg classifier.")
    parser.add_argument("--train-dir", default=str(DATA_DIR / "train"),
                        help="training split folder (default: output/train). "
                             "Use output/train_augmented for the balanced set.")
    args = parser.parse_args()

    set_seeds()
    print(f"Device: {DEVICE}")
    counts = step1_verify(args.train_dir)
    if counts is None:
        raise SystemExit(1)
    step2_train(counts, args.train_dir)
    step3_evaluate()
    step4_export()
    step5_sanity()
    print("\nDone. Stage 2 classifier is trained, evaluated and exported.")


if __name__ == "__main__":
    main()
