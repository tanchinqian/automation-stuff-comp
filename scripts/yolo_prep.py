#!/usr/bin/env python3
"""Prepare the PCB-AoI dataset for YOLO training.

Reads the Pascal-VOC annotations from train_data/test_data, converts them
to YOLO format (images/ + labels/, normalized .txt), and writes data.yaml.

Classes: 0 = less-paste (Bad_podu), 1 = bridging (Bad_qiaojiao).

Usage:
  python scripts/yolo_prep.py [--root .] [--out runs/yolo-data]
"""
import argparse
import os
import re
import shutil
import xml.etree.ElementTree as ET
from pathlib import Path

CLASS_MAP = {
    "less-paste": 0,
    "bridging": 1,
}
NAME_TO_CLASS = {
    "bad_podu": "less-paste",
    "bad_qiaojiao": "bridging",
}


def map_class(name: str) -> str | None:
    n = (name or "").lower().replace("-", "_")
    return NAME_TO_CLASS.get(n)


def parse_voc(xml_path: Path):
    """Return (img_width, img_height, [(cls, x1,y1,x2,y2), ...])."""
    tree = ET.parse(xml_path)
    root = tree.getroot()
    size = root.find("size")
    w = int(size.find("width").text)
    h = int(size.find("height").text)
    boxes = []
    for obj in root.findall("object"):
        cls_name = map_class(obj.find("name").text or "")
        if cls_name is None:
            continue
        bb = obj.find("bndbox")
        x1 = float(bb.find("xmin").text)
        y1 = float(bb.find("ymin").text)
        x2 = float(bb.find("xmax").text)
        y2 = float(bb.find("ymax").text)
        boxes.append((CLASS_MAP[cls_name], x1, y1, x2, y2))
    return w, h, boxes


def convert_split(src: Path, out: Path, split: str):
    """Convert one VOC split dir into YOLO images/labels."""
    jpeg_dir = src / "JPEGImages"
    ann_dir = src / "Annotations"
    img_out = out / "images" / split
    lbl_out = out / "labels" / split
    img_out.mkdir(parents=True, exist_ok=True)
    lbl_out.mkdir(parents=True, exist_ok=True)

    entries = []
    for jpeg in sorted(jpeg_dir.glob("*.jpeg")):
        xml_path = ann_dir / f"{jpeg.stem}.xml"
        if not xml_path.exists():
            continue
        w, h, boxes = parse_voc(xml_path)
        if not boxes:
            # no defect objects -> skip (dataset has none truly "good")
            continue
        # copy image
        shutil.copy2(jpeg, img_out / jpeg.name)
        # write label
        with open(lbl_out / f"{jpeg.stem}.txt", "w") as f:
            for cls, x1, y1, x2, y2 in boxes:
                # clamp
                x1, x2 = min(x1, x2), max(x1, x2)
                y1, y2 = min(y1, y2), max(y1, y2)
                cx = ((x1 + x2) / 2) / w
                cy = ((y1 + y2) / 2) / h
                bw = (x2 - x1) / w
                bh = (y2 - y1) / h
                f.write(f"{cls} {cx:.6f} {cy:.6f} {bw:.6f} {bh:.6f}\n")
        entries.append(jpeg.name)
    return entries


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=".", help="project root (has train_data/ and test_data/)")
    parser.add_argument("--out", default="runs/yolo-data", help="output dir for images/labels/data.yaml")
    args = parser.parse_args()

    root = Path(args.root)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    train_entries = convert_split(root / "train_data", out, "train")
    val_entries = convert_split(root / "test_data", out, "val")

    print(f"train images: {len(train_entries)}")
    print(f"val images:   {len(val_entries)}")

    data_yaml = f"""path: {out.resolve().as_posix()}
train: images/train
val: images/val

names:
  0: less-paste
  1: bridging
"""
    (out / "data.yaml").write_text(data_yaml)
    print(f"wrote {out / 'data.yaml'}")


if __name__ == "__main__":
    main()