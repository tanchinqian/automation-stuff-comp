#!/usr/bin/env python3
"""Draw the YOLO leg boxes back onto the images for visual inspection.

Loops through every image in dataset_leg_detection/images/, finds the
matching YOLO .txt label in dataset_leg_detection/labels/, and draws a
green rectangle for every box (converting normalized 0-1 coordinates back
to pixels using the image's actual size). The box count is printed in the
top-left corner. Output goes to inspect/leg_labels/.

Also prints a summary with average / min / max boxes per image and flags any
images whose box count is suspiciously low (0, or less than half the average).

Usage:
  python scripts/visualize_leg_labels.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# ---------------------------------------------------------------------------
# CONFIG - tweak freely
# ---------------------------------------------------------------------------
DATA_DIR = "dataset_leg_detection"
OUT_DIR = "inspect/leg_labels"
LOW_FACTOR = 0.5          # flag images with < LOW_FACTOR * average boxes
# ---------------------------------------------------------------------------


def load_font(size: int):
    """Readable TrueType font, falling back to Pillow's bitmap font."""
    for name in ("C:/Windows/Fonts/arial.ttf",
                 "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
                 "arial.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def read_labels(txt_path: Path):
    """Return list of (x1, y1, x2, y2) pixel rects from a YOLO label file."""
    rects = []
    for line in txt_path.read_text().splitlines():
        parts = line.split()
        if len(parts) < 5:
            continue  # malformed line - skip it
        # parts = [class, x_center, y_center, width, height] all normalized 0-1
        xc, yc, w, h = (float(parts[1]), float(parts[2]),
                        float(parts[3]), float(parts[4]))
        rects.append((xc, yc, w, h))
    return rects


def to_pixels(rects, img_w, img_h):
    """Convert normalized rects into pixel (x1, y1, x2, y2) tuples."""
    pixels = []
    for xc, yc, w, h in rects:
        x1 = int((xc - w / 2) * img_w)
        y1 = int((yc - h / 2) * img_h)
        x2 = int((xc + w / 2) * img_w)
        y2 = int((yc + h / 2) * img_h)
        pixels.append((x1, y1, x2, y2))
    return pixels


def main():
    data = Path(DATA_DIR)
    img_dir = data / "images"
    lbl_dir = data / "labels"
    out_dir = Path(OUT_DIR)
    out_dir.mkdir(parents=True, exist_ok=True)

    font = load_font(20)
    counts = {}          # filename -> number of boxes drawn
    total_boxes = 0
    processed = 0

    # 1. walk every image; labels live under the same split subfolder name
    for img_path in sorted(img_dir.rglob("*")):
        if img_path.suffix.lower() not in (".jpg", ".jpeg", ".png"):
            continue
        # find the matching label file in the sibling labels/ dir
        rel = img_path.relative_to(img_dir)          # e.g. train/foo.jpg
        lbl_path = lbl_dir / rel.with_suffix(".txt") # e.g. labels/train/foo.txt
        if not lbl_path.exists():
            continue

        img = Image.open(img_path).convert("RGB")
        w, h = img.size
        draw = ImageDraw.Draw(img)

        rects = read_labels(lbl_path)
        for (x1, y1, x2, y2) in to_pixels(rects, w, h):
            draw.rectangle([x1, y1, x2, y2], outline=(46, 255, 120), width=2)

        # box count text in the top-left corner
        draw.text((8, 8), f"{len(rects)}", font=font, fill=(255, 255, 255))

        out_path = out_dir / img_path.name
        img.save(out_path, quality=92)

        counts[img_path.name] = len(rects)
        total_boxes += len(rects)
        processed += 1

    # ---- summary ----------------------------------------------------------
    if processed == 0:
        raise SystemExit("No images with matching labels found.")

    avg = total_boxes / processed
    lo = min(counts.values())
    hi = max(counts.values())
    low_threshold = avg * LOW_FACTOR

    print(f"Images processed       : {processed}")
    print(f"Average boxes / image  : {avg:.2f}")
    print(f"Min boxes on an image  : {lo}")
    print(f"Max boxes on an image  : {hi}")

    flagged = sorted(name for name, n in counts.items() if n < low_threshold)
    if flagged:
        print(f"\nSuspiciously low box counts (< {low_threshold:.2f}):")
        for name in flagged:
            print(f"  {name}  ({counts[name]} boxes)")
    else:
        print("\nNo images with suspiciously low box counts.")

    print(f"\nAnnotated images saved to {out_dir}/")


if __name__ == "__main__":
    main()