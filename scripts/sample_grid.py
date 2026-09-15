#!/usr/bin/env python3
"""Sample random dataset images and draw a coordinate grid over them.

Goal: let a human look at a handful of images and read off the approximate
pixel coordinates of each IC leg (the "leg zones") we will later crop.

For every sampled image we draw:
  - a coordinate grid (light line every GRID_STEP px, heavy line every
    HEAVY_STEP px) with the pixel number printed along the top and left edges
  - the existing defect boxes from the matching VOC XML in red, so you can see
    where the real defects sit relative to the grid

Output goes to the INSPECT_DIR folder (default: inspect/).

Usage:
  python scripts/sample_grid.py
  python scripts/sample_grid.py --n 25 --seed 7 --dataset train_data
"""
import argparse
import random
import xml.etree.ElementTree as ET
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# ---------------------------------------------------------------------------
# CONFIG - tweak these freely
# ---------------------------------------------------------------------------
DATASET_DIR = "train_data"   # folder containing JPEGImages/ and Annotations/
INSPECT_DIR = "inspect"      # where the annotated samples are written
N_SAMPLES = 20               # how many random images to draw
SEED = 42                    # fixed seed so the same images are picked each run
GRID_STEP = 50               # light grid line spacing, in pixels
HEAVY_STEP = 100             # heavy grid line spacing, in pixels
# ---------------------------------------------------------------------------

IMAGE_EXTS = ("*.jpeg", "*.jpg", "*.png", "*.JPG", "*.JPEG")


def load_font(size: int):
    """Return a readable TrueType font, falling back to Pillow's bitmap font."""
    candidates = [
        "C:/Windows/Fonts/arial.ttf",                      # Windows
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",  # Linux
        "arial.ttf",
    ]
    for name in candidates:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def find_images(dataset_dir: Path):
    """Collect every image in <dataset>/JPEGImages (handles .jpeg/.jpg/.png)."""
    img_dir = dataset_dir / "JPEGImages"
    files = []
    for pattern in IMAGE_EXTS:
        files.extend(img_dir.glob(pattern))
    # de-duplicate (some patterns can match the same file) and sort for stability
    return sorted(set(files))


def read_boxes(xml_path: Path):
    """Return [(class_name, x1, y1, x2, y2), ...] from a VOC XML, or []."""
    if not xml_path.exists():
        return []
    root = ET.parse(xml_path).getroot()
    boxes = []
    for obj in root.findall("object"):
        name = (obj.find("name").text or "").strip()
        bb = obj.find("bndbox")
        if bb is None:
            continue
        boxes.append((
            name,
            float(bb.find("xmin").text),
            float(bb.find("ymin").text),
            float(bb.find("xmax").text),
            float(bb.find("ymax").text),
        ))
    return boxes


def draw_grid(img: Image.Image, font) -> None:
    """Draw the coordinate grid and edge numbers directly on the image."""
    draw = ImageDraw.Draw(img)
    w, h = img.size

    # Vertical lines (x coordinates)
    for x in range(0, w + 1, GRID_STEP):
        heavy = (x % HEAVY_STEP == 0)
        color = (255, 220, 0) if heavy else (90, 90, 90)
        draw.line([(x, 0), (x, h)], fill=color, width=2 if heavy else 1)
        if heavy:
            draw.text((x + 3, 3), str(x), font=font, fill=(255, 220, 0))

    # Horizontal lines (y coordinates)
    for y in range(0, h + 1, GRID_STEP):
        heavy = (y % HEAVY_STEP == 0)
        color = (255, 220, 0) if heavy else (90, 90, 90)
        draw.line([(0, y), (w, y)], fill=color, width=2 if heavy else 1)
        if heavy:
            draw.text((3, y + 3), str(y), font=font, fill=(255, 220, 0))


def draw_boxes(img: Image.Image, boxes, font) -> None:
    """Draw the real defect boxes in red with their class name above them."""
    draw = ImageDraw.Draw(img)
    for name, x1, y1, x2, y2 in boxes:
        draw.rectangle([x1, y1, x2, y2], outline=(255, 40, 40), width=2)
        # put the label just above the box (or below if it would go off-screen)
        ty = y1 - 14 if y1 - 14 > 0 else y2 + 2
        draw.text((x1, ty), name, font=font, fill=(255, 40, 40))


def main():
    parser = argparse.ArgumentParser(description="Draw a coordinate grid over sample images.")
    parser.add_argument("--dataset", default=DATASET_DIR, help="dataset folder (has JPEGImages/)")
    parser.add_argument("--out", default=INSPECT_DIR, help="output folder for annotated samples")
    parser.add_argument("--n", type=int, default=N_SAMPLES, help="number of random images")
    parser.add_argument("--seed", type=int, default=SEED, help="random seed")
    args = parser.parse_args()

    dataset_dir = Path(args.dataset)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    images = find_images(dataset_dir)
    if not images:
        raise SystemExit(f"No images found in {dataset_dir / 'JPEGImages'}")

    # Pick N random images, reproducible via the seed.
    rng = random.Random(args.seed)
    n = min(args.n, len(images))
    sample = sorted(rng.sample(images, n))

    font = load_font(16)
    print(f"Dataset: {dataset_dir}  ({len(images)} images)")
    print(f"Writing {n} annotated samples to {out_dir}/ ...\n")

    for img_path in sample:
        img = Image.open(img_path).convert("RGB")
        boxes = read_boxes(dataset_dir / "Annotations" / f"{img_path.stem}.xml")

        draw_grid(img, font)
        draw_boxes(img, boxes, font)

        out_path = out_dir / f"grid_{img_path.stem}.jpg"
        img.save(out_path, quality=92)
        print(f"  {img_path.name:32s} -> {out_path.name}  ({len(boxes)} defect box(es))")

    print("\nDone. Open the inspect/ folder, look at the grid coordinates, and")
    print("tell me the (x1, y1, x2, y2) pixel zone for each IC leg.")


if __name__ == "__main__":
    main()
