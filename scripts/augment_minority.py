#!/usr/bin/env python3
"""Augment the minority classes and build a balanced training folder.

The stage-2 classifier dataset is heavily imbalanced:
    good         2475
    Bad_podu      224
    Bad_qiaojiao   69
This script writes a complete, augmented copy of the TRAIN split to
output/train_augmented/<class>/ containing the real images PLUS synthetic
variants for the minority classes, so retraining sees a more balanced set.

  - Bad_podu     : 224 real -> 600 total
  - Bad_qiaojiao :  69 real -> 400 total
  - good         : 2475 real -> copied unchanged (no augmentation)

The TEST split is NEVER touched or augmented.

Each synthetic image randomly combines 2-3 of these transforms:
    flip, rotate(-15..15), brightness/contrast jitter, gaussian noise,
    random crop + resize.

Run as:
  python scripts/augment_minority.py
  python scripts/augment_minority.py --src output/train --dst output/train_augmented
"""
import argparse
import random
import shutil
from pathlib import Path

import numpy as np
from PIL import Image, ImageEnhance

# ---------------------------------------------------------------------------
# CONFIG
# ---------------------------------------------------------------------------
SRC_DIR = Path("output/train")            # original training split
DST_DIR = Path("output/train_augmented")  # output (never touches output/test)

# target TOTAL images per class after copying real + adding augmented variants.
# Classes not listed are copied as-is with no augmentation.
TARGET_TOTALS = {
    "Bad_podu": 600,
    "Bad_qiaojiao": 400,
}

SEED = 42
JPEG_QUALITY = 95
# ---------------------------------------------------------------------------


def load_rgb(path: Path) -> Image.Image:
    return Image.open(path).convert("RGB")


# ---------------------------------------------------------------------------
# The five individual transforms. Each takes a PIL image, returns a PIL image.
# ---------------------------------------------------------------------------
def t_flip(img):
    """Mirror left-right (legs can appear mirrored)."""
    return img.transpose(Image.FLIP_LEFT_RIGHT)


def t_rotate(img, rng):
    """Rotate by a random angle in -15..+15 degrees."""
    angle = rng.uniform(-15, 15)
    # fill the exposed corners with the image's top-left pixel (usually board)
    fill = img.getpixel((0, 0))
    return img.rotate(angle, resample=Image.BILINEAR, expand=False, fillcolor=fill)


def t_color(img, rng):
    """Random brightness AND contrast factor, each in 0.7..1.3."""
    bright = rng.uniform(0.7, 1.3)
    contrast = rng.uniform(0.7, 1.3)
    img = ImageEnhance.Brightness(img).enhance(bright)
    img = ImageEnhance.Contrast(img).enhance(contrast)
    return img


def t_noise(img, rng):
    """Add small gaussian noise (std 5..10 pixel values)."""
    arr = np.asarray(img, dtype=np.float32)
    std = rng.uniform(5.0, 10.0)
    noise = np.random.normal(0.0, std, arr.shape)
    arr = np.clip(arr + noise, 0, 255).astype(np.uint8)
    return Image.fromarray(arr)


def t_crop_resize(img, rng):
    """Crop 85-100% of the image, then resize back to the original size."""
    w, h = img.size
    scale = rng.uniform(0.85, 1.0)
    cw, ch = int(w * scale), int(h * scale)
    x = rng.randint(0, w - cw)
    y = rng.randint(0, h - ch)
    crop = img.crop((x, y, x + cw, y + ch))
    return crop.resize((w, h), resample=Image.BILINEAR)


# name -> function (functions that need randomness take (img, rng))
TRANSFORMS = {
    "flip": t_flip,
    "rotate": t_rotate,
    "color": t_color,
    "noise": t_noise,
    "crop": t_crop_resize,
}


def augment_once(img, rng):
    """Apply a random subset of 2-3 transforms, in random order."""
    k = rng.randint(2, 3)                      # how many transforms this time
    names = rng.sample(list(TRANSFORMS), k)    # which ones (random subset)
    rng.shuffle(names)                         # and in what order
    out = img
    for name in names:
        fn = TRANSFORMS[name]
        # flip takes only the image; the rest also take the rng
        out = fn(out) if name == "flip" else fn(out, rng)
    return out


def image_files(folder: Path):
    return sorted(p for p in folder.glob("*")
                  if p.suffix.lower() in (".jpg", ".jpeg", ".png"))


def main():
    parser = argparse.ArgumentParser(description="Augment minority classes.")
    parser.add_argument("--src", default=str(SRC_DIR),
                        help="original training split (default: output/train)")
    parser.add_argument("--dst", default=str(DST_DIR),
                        help="output folder (default: output/train_augmented)")
    args = parser.parse_args()

    src = Path(args.src)
    dst = Path(args.dst)
    rng = random.Random(SEED)
    np.random.seed(SEED)

    if not src.exists():
        raise SystemExit(f"source folder not found: {src}")

    print(f"Source      : {src}")
    print(f"Destination : {dst}\n")

    final_counts = {}
    for class_dir in sorted(p for p in src.iterdir() if p.is_dir()):
        cls = class_dir.name
        files = image_files(class_dir)
        if not files:
            print(f"{cls}: no images, skipping")
            continue

        out_dir = dst / cls
        out_dir.mkdir(parents=True, exist_ok=True)

        # 1) copy the real images across
        for f in files:
            shutil.copy2(f, out_dir / f.name)

        n_real = len(files)
        target = TARGET_TOTALS.get(cls, n_real)
        n_aug = max(0, target - n_real)

        # 2) generate augmented variants by sampling WITH replacement, so a
        #    class with few real images still reaches the target count
        for i in range(1, n_aug + 1):
            src_file = rng.choice(files)
            img = load_rgb(src_file)
            aug = augment_once(img, rng)
            out_name = f"{src_file.stem}_aug{i:03d}.jpg"
            aug.save(out_dir / out_name, quality=JPEG_QUALITY)

        final_counts[cls] = n_real + n_aug
        print(f"{cls:13s}: {n_real} real + {n_aug} augmented = "
              f"{n_real + n_aug} total")

    print("\nFinal counts:")
    for cls, n in sorted(final_counts.items()):
        print(f"  {cls:13s}: {n}")
    print(f"\nDone. Retrain with:  python scripts/train_classifier.py "
          f"--train-dir {dst.as_posix()}")
    print("Test split untouched (never augmented).")


if __name__ == "__main__":
    main()
