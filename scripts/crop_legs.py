#!/usr/bin/env python3
"""Crop each defined leg zone out of every image and label it.

For each image in the dataset we:
  1. crop every zone from scripts/leg_zones.py (exact pixels, no padding by default)
  2. read the matching VOC XML and decide the label:
       - if a defect box's CENTER falls inside the zone, the zone is a defect
       - if several defects qualify, the one with the largest overlap wins
       - if none qualify, the zone is labelled "good"
  3. save the crop to output/<split>/<label>/<originalname>_<zone>.jpg

A CSV manifest (output/manifest.csv) records where every crop came from.

Usage:
  python scripts/crop_legs.py                 # full run over train + test
  python scripts/crop_legs.py --overlay       # draw zones on samples first
  python scripts/crop_legs.py --pad 10        # add a 10px margin to each crop
  python scripts/crop_legs.py --dataset train_data
"""
import argparse
import csv
import xml.etree.ElementTree as ET
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from leg_zones import LEG_ZONES, PAD

# ---------------------------------------------------------------------------
# CONFIG - tweak freely
# ---------------------------------------------------------------------------
DATA_ROOTS = ["train_data", "test_data"]  # folders with JPEGImages/ + Annotations/
OUT_DIR = "output"                        # where labelled crops are written
OVERLAY_DIR = "inspect/zones"             # where --overlay previews are written
OVERLAY_LIMIT = 20                        # how many images to preview with --overlay
# ---------------------------------------------------------------------------

# dataset folder name -> split name used in the output tree
SPLIT_NAMES = {"train_data": "train", "test_data": "test"}
IMAGE_EXTS = ("*.jpeg", "*.jpg", "*.png", "*.JPG", "*.JPEG")


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


def find_images(root: Path):
    """Every image in <root>/JPEGImages (handles .jpeg/.jpg/.png)."""
    files = []
    for pattern in IMAGE_EXTS:
        files.extend((root / "JPEGImages").glob(pattern))
    return sorted(set(files))


def read_boxes(xml_path: Path):
    """[(class_name, x1, y1, x2, y2), ...] from a VOC XML, or [] if missing."""
    if not xml_path.exists():
        return []
    root = ET.parse(xml_path).getroot()
    boxes = []
    for obj in root.findall("object"):
        name = (obj.find("name").text or "").strip()
        bb = obj.find("bndbox")
        if bb is None:
            continue
        boxes.append((name,
                      float(bb.find("xmin").text), float(bb.find("ymin").text),
                      float(bb.find("xmax").text), float(bb.find("ymax").text)))
    return boxes


def intersection_area(a, b):
    """Overlapping area between two (x1,y1,x2,y2) rectangles."""
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    if ix2 <= ix1 or iy2 <= iy1:
        return 0.0
    return (ix2 - ix1) * (iy2 - iy1)


def label_zone(zone_box, boxes):
    """Return (label, matched_box). label is 'good' when no defect qualifies."""
    zx1, zy1, zx2, zy2 = zone_box
    best_label, best_box, best_overlap = "good", None, 0.0
    for name, x1, y1, x2, y2 in boxes:
        cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
        # rule: defect counts for this zone only if its center is inside it
        if not (zx1 <= cx <= zx2 and zy1 <= cy <= zy2):
            continue
        overlap = intersection_area(zone_box, (x1, y1, x2, y2))
        if overlap > best_overlap:  # keep the biggest overlapping defect
            best_overlap, best_label, best_box = overlap, name, (x1, y1, x2, y2)
    return best_label, best_box


def clamp_box(box, w, h):
    """Keep a crop rectangle inside the image bounds."""
    x1, y1, x2, y2 = box
    return (max(0, x1), max(0, y1), min(w, x2), min(h, y2))


def draw_overlay(img, boxes, font):
    """Draw every zone + its assigned label, for visual verification."""
    draw = ImageDraw.Draw(img)
    for zone in LEG_ZONES:
        x1, y1, x2, y2 = zone["box"]
        label, _ = label_zone(zone["box"], boxes)
        color = (60, 220, 130) if label == "good" else (255, 60, 60)
        draw.rectangle([x1, y1, x2, y2], outline=color, width=2)
        draw.text((x1 + 2, y1 + 2), f'{zone["name"]}:{label}', font=font, fill=color)


def main():
    parser = argparse.ArgumentParser(description="Crop and label IC leg zones.")
    parser.add_argument("--dataset", nargs="*", default=DATA_ROOTS,
                        help="dataset folders to process (default: train_data test_data)")
    parser.add_argument("--out", default=OUT_DIR, help="output folder for crops")
    parser.add_argument("--pad", type=int, default=PAD, help="margin around each zone (px)")
    parser.add_argument("--overlay", action="store_true",
                        help="also write zone previews to inspect/zones/ and exit")
    parser.add_argument("--overlay-limit", type=int, default=OVERLAY_LIMIT,
                        help="max images to preview with --overlay")
    args = parser.parse_args()

    out_dir = Path(args.out)
    font = load_font(14)
    manifest_rows = []
    counts = {}          # (split, label) -> count
    zone_counts = {}     # zone name -> count

    for root_name in args.dataset:
        root = Path(root_name)
        split = SPLIT_NAMES.get(root.name, root.name)
        images = find_images(root)
        if not images:
            print(f"  (skipping {root_name}: no images)")
            continue

        # ---- overlay-only preview mode -----------------------------------
        if args.overlay:
            ov_dir = Path(OVERLAY_DIR)
            ov_dir.mkdir(parents=True, exist_ok=True)
            for img_path in images[:args.overlay_limit]:
                boxes = read_boxes(root / "Annotations" / f"{img_path.stem}.xml")
                img = Image.open(img_path).convert("RGB")
                draw_overlay(img, boxes, font)
                img.save(ov_dir / f"zones_{img_path.stem}.jpg", quality=92)
            print(f"  wrote {min(len(images), args.overlay_limit)} overlays to {ov_dir}/")
            continue

        # ---- normal crop + label run -------------------------------------
        for img_path in images:
            boxes = read_boxes(root / "Annotations" / f"{img_path.stem}.xml")
            img = Image.open(img_path).convert("RGB")
            w, h = img.size

            for zone in LEG_ZONES:
                label, matched = label_zone(zone["box"], boxes)
                zx1, zy1, zx2, zy2 = zone["box"]
                crop_box = clamp_box((zx1 - args.pad, zy1 - args.pad,
                                      zx2 + args.pad, zy2 + args.pad), w, h)
                crop = img.crop(crop_box)

                dest = out_dir / split / label
                dest.mkdir(parents=True, exist_ok=True)
                crop_name = f"{img_path.stem}_{zone['name']}.jpg"
                crop_path = dest / crop_name
                crop.save(crop_path, quality=95)

                counts[(split, label)] = counts.get((split, label), 0) + 1
                zone_counts[zone["name"]] = zone_counts.get(zone["name"], 0) + 1
                manifest_rows.append({
                    "split": split,
                    "source_image": img_path.name,
                    "zone": zone["name"],
                    "label": label,
                    "zone_box": f"{zx1},{zy1},{zx2},{zy2}",
                    "matched_box": ",".join(str(int(v)) for v in matched) if matched else "",
                    "crop_path": crop_path.as_posix(),
                })

    if args.overlay:
        return

    # ---- manifest --------------------------------------------------------
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = out_dir / "manifest.csv"
    with open(manifest_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=[
            "split", "source_image", "zone", "label",
            "zone_box", "matched_box", "crop_path"])
        writer.writeheader()
        writer.writerows(manifest_rows)

    # ---- summary ---------------------------------------------------------
    print(f"\nTotal crops: {len(manifest_rows)}")
    print("\nPer split / label:")
    for (split, label), n in sorted(counts.items()):
        print(f"  {split:6s} {label:14s} {n:5d}")
    print("\nPer zone:")
    for zone, n in sorted(zone_counts.items()):
        print(f"  {zone:8s} {n:5d}")
    print(f"\nManifest: {manifest_path}")


if __name__ == "__main__":
    main()
