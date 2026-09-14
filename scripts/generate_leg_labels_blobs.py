#!/usr/bin/env python3
"""Generate YOLO "leg" labels by finding colourful bright blobs in the SPI image.

Unlike a fixed template (which fails when chip orientation varies), this script
finds legs purely from what the pixels look like. Legs/pins carry the SPI
height-map signature: bright and colourful (high value, high saturation),
roughly rectangular and elongated. The dark board background is dark and flat,
so it falls out of the "bright" mask automatically.

Pipeline per image:
  1. BGR -> HSV
  2. threshold on high VALUE (brightness) AND high SATURATION (colourful)
  3. clean the binary mask with MORPH_CLOSE (merge fragments) then MORPH_OPEN
     (drop tiny specks)
  4. find contours
  5. filter boxes: min/max area, aspect ratio range, circularity (kill round
     screw holes)
  6. merge pass: fuse tip/body fragments of the SAME leg into one box
  7. write normalized YOLO labels + copy the image
  8. --debug saves mask + overlay + rejection CSV for EVERY image

Usage:
  python scripts/generate_leg_labels_blobs.py            # full run
  python scripts/generate_leg_labels_blobs.py --debug    # save previews for all
  python scripts/generate_leg_labels_blobs.py --dataset train_data
"""
import argparse
import csv
import shutil
from collections import Counter
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

# ---------------------------------------------------------------------------
# CONFIG - tune these first if results look wrong
# ---------------------------------------------------------------------------
# Fixed thresholds - used ONLY with the --fixed-threshold flag. By default the
# script uses Otsu's method (auto per-image brightness cutoff) instead, because
# unevenly-lit boards need a different cutoff than uniformly-lit ones.
FIXED_VAL_THRESHOLD = 150  # fixed min VALUE (brightness) 0-255
FIXED_SAT_THRESHOLD = 100  # fixed min SATURATION 0-255

# Saturation floor used with Otsu: legs are colourful, so keep any pixel whose
# saturation is above this. It is LOW on purpose - it only excludes pure
# white/grey (saturation ~0) background and margins, letting Otsu decide the
# brightness cutoff.
SAT_FLOOR = 40

MIN_AREA = 120        # ignore tiny blobs (noise) below this many pixels
                      # (loosened ~25% from 160 so smaller real legs survive)
MAX_AREA = 4000       # ignore huge blobs (whole chip body/sheen) above this
ASPECT_MIN = 1.3      # legs are elongated. Applied BOTH ways (w/h and h/w),
                      # so both horizontal and vertical legs pass. (Was 1.4.)
ASPECT_MAX = 8.5      # reject absurdly thin/wide slivers (widened from 8.0)
CIRCULARITY_MAX = 0.74  # circularity=4*pi*A/P^2; 1.0 = perfect circle. Round
                        # screw holes are > this and get rejected. Legs are low.
                        # (moderate: 0.70 let through too few, 0.78 too many.)

# Morphology kernels. CLOSE must be SMALL and vertically-shaped so it only
# fills gaps WITHIN one leg (e.g. a tall thin pin split by a darker pixel),
# NOT between neighbouring legs in a tight row (which would merge them into
# one huge blob). OPEN removes tiny noise specks.
CLOSE_KERNEL = (3, 7)   # (width, height) - thin + tall: merge within a leg only
OPEN_KERNEL = 5         # square size for MORPH_OPEN (remove tiny noise specks)

# Split-merge fallback. If a blob survives but is wider than this multiple of
# the median leg width in the same image, it is almost certainly a row of
# merged legs - split it into N even sub-boxes instead of discarding it.
MERGE_WIDTH_RATIO = 1.8

# ---------------------------------------------------------------------------
# Post-detection MERGE pass. A single leg can break into 2-3 blobs (bright tip
# + darker body) that pass the filters separately, causing double counting.
# After filtering we merge boxes that clearly belong to the same leg.
#
# Absolute axis position (not the box size) decides "same row/column":
#   - vertical legs (h > w) sit in a COLUMN: their x_center must match.
#   - horizontal legs (w > h) sit in a ROW:  their y_center must match.
# Along the other axis the boxes must overlap or be separated by only a small
# gap (tip vs body). A combined-size cap stops two genuinely separate
# neighbouring legs from being fused.
# ---------------------------------------------------------------------------
MERGE_X_TOLERANCE = 15    # max x_center difference for two vertical-leg boxes
MERGE_Y_TOLERANCE = 15    # max y_center difference for two horizontal-leg boxes
MERGE_GAP_TOLERANCE = 10  # max gap (px) between boxes before they're separate
MAX_MERGED_HEIGHT = 80    # never merge vertical boxes taller than this
MAX_MERGED_WIDTH = 80     # never merge horizontal boxes wider than this

DATA_ROOTS = ["train_data", "test_data"]  # folders containing JPEGImages/
OUT_DIR = "dataset_leg_detection_v2"
LEG_CLASS_ID = 0
# ---------------------------------------------------------------------------


def find_images(root: Path):
    """Every image in <root>/JPEGImages."""
    files = []
    for pattern in ("*.jpeg", "*.jpg", "*.png", "*.JPG", "*.JPEG"):
        files.extend((root / "JPEGImages").glob(pattern))
    return sorted(set(files))


def load_font(size: int):
    for name in ("C:/Windows/Fonts/arial.ttf",
                 "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
                 "arial.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def circularity(contour):
    """4*pi*area / perimeter^2 -> ~1.0 for a circle, smaller for elongated."""
    area = cv2.contourArea(contour)
    peri = cv2.arcLength(contour, True)
    if peri <= 0 or area <= 0:
        return 0.0
    return 4.0 * np.pi * area / (peri * peri)


def otsu_brightness_mask(v, s):
    """Threshold the Value channel with Otsu, combined with a saturation floor.

    Returns a binary mask (255 = candidate leg pixel). Otsu finds the best
    brightness cutoff for THIS image, so uneven lighting doesn't drop whole
    legs. The saturation floor is deliberately low: it just removes pure
    white/grey background and margins, not the legs.
    """
    # Otsu: v is the Value (brightness) channel, 0-255. It computes a cutoff
    # that best separates the bright foreground from the dark background.
    _, v_mask = cv2.threshold(v, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    # saturation floor: keep colourful pixels only (drop grey/white bg)
    s_mask = (s >= SAT_FLOOR).astype(np.uint8) * 255

    # combine: pixel must be bright (Otsu) AND colourful (saturation floor)
    return cv2.bitwise_and(v_mask, s_mask)


def fixed_brightness_mask(v, s):
    """Fixed-threshold mask (fallback when --fixed-threshold is set)."""
    v_mask = (v >= FIXED_VAL_THRESHOLD).astype(np.uint8) * 255
    s_mask = (s >= FIXED_SAT_THRESHOLD).astype(np.uint8) * 255
    return cv2.bitwise_and(v_mask, s_mask)


def split_wide_box(box, median_width):
    """Split one too-wide box into N even sub-boxes (merged-leg fallback).

    box      - (x1, y1, x2, y2) pixel rect
    median_width - the median leg width in the same image

    N = round(box_width / median_width), clamped to at least 2. Each sub-box
    keeps the original height and spans an even slice of the width.
    """
    x1, y1, x2, y2 = box
    w = x2 - x1
    n = max(2, int(round(w / median_width)))
    out = []
    step = w / n
    for i in range(n):
        sx1 = int(round(x1 + i * step))
        sx2 = int(round(x1 + (i + 1) * step))
        if sx2 > sx1:
            out.append((sx1, y1, sx2, y2))
    return out


def _union(a, b):
    """Union bounding box of two (x1, y1, x2, y2) rectangles."""
    return (min(a[0], b[0]), min(a[1], b[1]),
            max(a[2], b[2]), max(a[3], b[3]))


def _can_merge(a, b, vertical):
    """Decide whether two boxes belong to the same physical leg.

    vertical=True  - boxes are treated as COLUMN legs (h > w): require matching
                     x_center, y-overlap or small y-gap, and a height cap.
    vertical=False - boxes are treated as ROW legs (w > h): require matching
                     y_center, x-overlap or small x-gap, and a width cap.
    """
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    acx, acy = (ax1 + ax2) / 2, (ay1 + ay2) / 2
    bcx, bcy = (bx1 + bx2) / 2, (by1 + by2) / 2

    if vertical:
        # same column? x_centers must be very close
        if abs(acx - bcx) > MERGE_X_TOLERANCE:
            return False
        # y ranges overlap, or the gap between them is small (tip vs body)
        overlap = min(ay2, by2) - max(ay1, by1)
        if overlap <= 0 and (-overlap) > MERGE_GAP_TOLERANCE:
            return False
        # never let the merged box grow past the cap
        if (max(ay2, by2) - min(ay1, by1)) > MAX_MERGED_HEIGHT:
            return False
    else:
        # same row? y_centers must be very close
        if abs(acy - bcy) > MERGE_Y_TOLERANCE:
            return False
        # x ranges overlap, or the gap between them is small
        overlap = min(ax2, bx2) - max(ax1, bx1)
        if overlap <= 0 and (-overlap) > MERGE_GAP_TOLERANCE:
            return False
        if (max(ax2, bx2) - min(ax1, bx1)) > MAX_MERGED_WIDTH:
            return False

    return True


def _merge_group(boxes, vertical):
    """Iteratively merge one orientation group until no more merges happen.

    Merging two boxes may make a third eligible to merge with the result, so we
    keep making full passes until a pass changes nothing.
    """
    boxes = [tuple(b) for b in boxes]
    changed = True
    while changed:
        changed = False
        used = [False] * len(boxes)
        # sort so boxes on the same column/row are adjacent in the scan
        if vertical:
            order = sorted(range(len(boxes)),
                           key=lambda i: ((boxes[i][0] + boxes[i][2]) / 2,
                                          (boxes[i][1] + boxes[i][3]) / 2))
        else:
            order = sorted(range(len(boxes)),
                           key=lambda i: ((boxes[i][1] + boxes[i][3]) / 2,
                                          (boxes[i][0] + boxes[i][2]) / 2))

        for ii in range(len(order)):
            i = order[ii]
            if used[i]:
                continue
            for jj in range(ii + 1, len(order)):
                j = order[jj]
                if used[j]:
                    continue
                if _can_merge(boxes[i], boxes[j], vertical):
                    boxes[i] = _union(boxes[i], boxes[j])  # grow box i
                    used[j] = True                          # box j consumed
                    changed = True

        # keep only the surviving (unconsumed) boxes for the next pass
        boxes = [boxes[i] for i in range(len(boxes)) if not used[i]]

    return boxes


def merge_boxes(boxes):
    """Post-detection merge: fuse split tip/body blobs into one box per leg.

    Splits boxes into vertical (left/right columns) and horizontal (top/bottom
    rows) groups, merges each group, then returns all merged boxes.
    """
    vertical = [b for b in boxes if (b[3] - b[1]) > (b[2] - b[0])]
    horizontal = [b for b in boxes if (b[2] - b[0]) >= (b[3] - b[1])]
    return _merge_group(vertical, vertical=True) + _merge_group(horizontal, vertical=False)


def evaluate_contour(c):
    """Measure one contour and decide which filter (if any) rejects it.

    Returns a dict with the bounding box, area, aspect both ways, circularity
    and a "reason" string: "min_area", "max_area", "aspect_ratio",
    "circularity", or "accepted". This is used both for filtering and for the
    --debug rejection log, so the numbers exactly match the decision.
    """
    x, y, w, h = cv2.boundingRect(c)
    area = w * h

    # Aspect ratio BOTH ways. A top/bottom row leg is wide-and-short (w/h > 1),
    # a left/right column leg is tall-and-narrow (h/w > 1). We accept a blob if
    # EITHER orientation lands in the allowed range, so both are caught.
    w_over_h = w / h if h > 0 else 0.0
    h_over_w = h / w if w > 0 else 0.0
    aspect_ratio = max(w_over_h, h_over_w)  # orientation-normalized (>= 1)

    circ = circularity(c)

    # Filters run in priority order; the first that fails becomes the reason.
    if area < MIN_AREA:
        reason = "min_area"
    elif area > MAX_AREA:
        reason = "max_area"
    elif not (ASPECT_MIN <= w_over_h <= ASPECT_MAX
              or ASPECT_MIN <= h_over_w <= ASPECT_MAX):
        reason = "aspect_ratio"
    elif circ > CIRCULARITY_MAX:
        reason = "circularity"
    else:
        reason = "accepted"

    return {
        "x": x, "y": y, "w": w, "h": h, "area": area,
        "w_over_h": w_over_h, "h_over_w": h_over_w,
        "aspect_ratio": aspect_ratio, "circularity": circ,
        "reason": reason, "box": (x, y, x + w, y + h),
    }


def detect_legs(bgr, use_fixed=False):
    """Return (boxes, clean_mask, raw_mask, diagnostics, pre_merge_boxes).

    boxes           - final (post-merge) list of (x1, y1, x2, y2) leg boxes
    clean_mask      - the final morphological mask used for contour detection
    raw_mask        - the raw Otsu mask BEFORE any morphology (for --debug)
    diagnostics     - one dict per contour (all of them, accepted or rejected),
                      used to write the --debug rejection CSV
    pre_merge_boxes - the filtered boxes BEFORE the merge pass (for --debug)
    """
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    h, s, v = cv2.split(hsv)

    # 2. threshold: use Otsu by default, fixed thresholds as override
    if use_fixed:
        raw_mask = fixed_brightness_mask(v, s)
    else:
        raw_mask = otsu_brightness_mask(v, s)

    # 3. morphology: SMALL vertical CLOSE (fill gaps within a single leg only,
    #    not between neighbouring legs) then OPEN (drop tiny specks).
    kc = cv2.getStructuringElement(cv2.MORPH_RECT, CLOSE_KERNEL)
    ko = cv2.getStructuringElement(cv2.MORPH_RECT, (OPEN_KERNEL, OPEN_KERNEL))
    mask = cv2.morphologyEx(raw_mask, cv2.MORPH_CLOSE, kc)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, ko)

    # 4. find contours
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    # Evaluate EVERY contour (accepted or not) so --debug can explain the
    # rejections. Accepted ones become our candidates.
    diagnostics = [evaluate_contour(c) for c in contours]
    candidates = [d["box"] for d in diagnostics if d["reason"] == "accepted"]

    # Median leg width: the midpoint of all accepted blob widths. Used only if
    # some blob looks like several merged legs.
    median_width = None
    if candidates:
        widths = [x2 - x1 for (x1, y1, x2, y2) in candidates]
        median_width = float(np.median(widths))

    # Second pass: emit the boxes, splitting any that are far wider than the
    # median (they are probably several merged legs) rather than discarding.
    boxes = []
    for (x1, y1, x2, y2) in candidates:
        w = x2 - x1
        if median_width and w > MERGE_WIDTH_RATIO * median_width:
            boxes.extend(split_wide_box((x1, y1, x2, y2), median_width))
        else:
            boxes.append((x1, y1, x2, y2))

    # 5. post-detection MERGE pass: fuse tip/body fragments of the same leg.
    #    Run AFTER all filtering (and the split fallback) so it only ever
    #    combines boxes that already passed every shape test.
    pre_merge_boxes = boxes
    boxes = merge_boxes(boxes)

    return boxes, mask, raw_mask, diagnostics, pre_merge_boxes


def to_yolo(box, img_w, img_h):
    """Normalized label line for one pixel box."""
    x1, y1, x2, y2 = box
    x1, y1, x2, y2 = (max(0, min(img_w, x1)), max(0, min(img_h, y1)),
                      max(0, min(img_w, x2)), max(0, min(img_h, y2)))
    if x2 <= x1 or y2 <= y1:
        return None
    xc = ((x1 + x2) / 2) / img_w
    yc = ((y1 + y2) / 2) / img_h
    bw = (x2 - x1) / img_w
    bh = (y2 - y1) / img_h
    return f"{LEG_CLASS_ID} {xc:.6f} {yc:.6f} {bw:.6f} {bh:.6f}"


def main():
    parser = argparse.ArgumentParser(description="Find leg blobs and write YOLO labels.")
    parser.add_argument("--debug", action="store_true",
                        help="save mask/overlay/CSV debug files for ALL images")
    parser.add_argument("--dataset", nargs="*", default=DATA_ROOTS,
                        help="folders with JPEGImages (default: train_data test_data)")
    parser.add_argument("--fixed-threshold", action="store_true",
                        help="use fixed VAL/SAT thresholds instead of Otsu per-image")
    args = parser.parse_args()

    out = Path(OUT_DIR)
    splits = {"train_data": "train", "test_data": "val"}

    # collect all image paths (with their split name) up front
    images = []                       # (root, image_path, split)
    for root_name in args.dataset:
        root = Path(root_name)
        split = splits.get(root.name, root.name)
        for p in find_images(root):
            images.append((root, p, split))
    if not images:
        raise SystemExit("No images found.")

    counts = {}            # final (post-merge) box count per image
    pre_merge_counts = {}  # box count BEFORE the merge pass per image
    total_boxes = 0
    total_pre_merge = 0
    font = load_font(18)
    rejection_totals = Counter()  # reason -> count, across debug images

    for root, img_path, split in images:
        bgr = cv2.imread(str(img_path))
        if bgr is None:
            continue
        h, w = bgr.shape[:2]
        boxes, mask, raw_mask, diagnostics, pre_merge_boxes = detect_legs(
            bgr, use_fixed=args.fixed_threshold)

        # write the label (skip writing an empty label for the summary check;
        # YOLO allows empty files but we track 0-box images separately)
        lbl_dir = out / "labels" / split
        img_dir = out / "images" / split
        lbl_dir.mkdir(parents=True, exist_ok=True)
        img_dir.mkdir(parents=True, exist_ok=True)

        lines = [to_yolo(b, w, h) for b in boxes]
        lines = [ln for ln in lines if ln is not None]
        (lbl_dir / f"{img_path.stem}.txt").write_text("\n".join(lines) + "\n")
        shutil.copy2(img_path, img_dir / img_path.name)

        counts[img_path.name] = len(lines)
        pre_merge_counts[img_path.name] = len(pre_merge_boxes)
        total_boxes += len(lines)
        total_pre_merge += len(pre_merge_boxes)

        # ---- debug previews (ALL images when --debug) -----------------------
        if args.debug:
            dbg = Path("inspect/blob_detection")
            dbg.mkdir(parents=True, exist_ok=True)
            # raw adaptive-threshold mask BEFORE morphology (shows what Otsu
            # picked up before the shape filters / split-merge ran)
            cv2.imwrite(str(dbg / f"raw_{img_path.stem}.png"), raw_mask)
            cv2.imwrite(str(dbg / f"mask_{img_path.stem}.png"), mask)

            # rejection log CSV: one row per contour, accepted or rejected
            csv_path = dbg / f"{img_path.stem}_rejections.csv"
            with open(csv_path, "w", newline="") as f:
                writer = csv.DictWriter(f, fieldnames=[
                    "x", "y", "w", "h", "area",
                    "aspect_ratio", "circularity", "rejection_reason"])
                writer.writeheader()
                for d in diagnostics:
                    writer.writerow({
                        "x": d["x"], "y": d["y"], "w": d["w"], "h": d["h"],
                        "area": d["area"],
                        "aspect_ratio": round(d["aspect_ratio"], 3),
                        "circularity": round(d["circularity"], 3),
                        "rejection_reason": d["reason"],
                    })
                    rejection_totals[d["reason"]] += 1

            # overlay:
            #   orange (thin)  = rejected blobs (did not pass the filters)
            #   cyan   (thin)  = accepted boxes BEFORE the merge pass
            #   green  (thick) = final boxes AFTER the merge pass
            rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
            pil = Image.fromarray(rgb)
            draw = ImageDraw.Draw(pil)
            for d in diagnostics:
                if d["reason"] != "accepted":
                    x1, y1, x2, y2 = d["box"]
                    draw.rectangle([x1, y1, x2, y2], outline=(255, 130, 40), width=1)
            for (x1, y1, x2, y2) in pre_merge_boxes:
                draw.rectangle([x1, y1, x2, y2], outline=(0, 220, 255), width=1)
            for (x1, y1, x2, y2) in boxes:
                draw.rectangle([x1, y1, x2, y2], outline=(46, 255, 120), width=3)
            draw.text((8, 8), f"{len(boxes)}", font=font, fill=(255, 255, 255))
            pil.save(dbg / f"boxes_{img_path.stem}.jpg", quality=92)

    # ---- yaml ----------------------------------------------------------------
    (out / "leg_detection_v2.yaml").write_text(
        f"path: {out.resolve().as_posix()}\n"
        "train: images/train\n"
        "val: images/val\n"
        "names:\n"
        "  0: leg\n"
    )

    # ---- summary --------------------------------------------------------------
    processed = len(counts)
    if processed == 0:
        raise SystemExit("No images processed.")
    avg = total_boxes / processed
    lo = min(counts.values())
    hi = max(counts.values())
    low_threshold = avg * 0.5
    flagged = sorted(name for name, n in counts.items() if n < low_threshold)

    # average merge ratio = mean over images of (boxes before / boxes after).
    # A ratio of 1.0 means nothing merged; 1.5 means 1.5 pre-merge boxes became
    # 1 final box on average. Images with 0 post-merge boxes are skipped.
    ratios = [pre_merge_counts[n] / counts[n]
              for n in counts if counts[n] > 0 and pre_merge_counts.get(n, 0) > 0]
    avg_ratio = sum(ratios) / len(ratios) if ratios else 1.0

    print(f"Images processed         : {processed}")
    print(f"Total boxes BEFORE merge : {total_pre_merge}")
    print(f"Total boxes AFTER merge  : {total_boxes}")
    print(f"Average merge ratio      : {avg_ratio:.2f}  (before/after)")
    print(f"Average boxes / image    : {avg:.2f}  (after merge)")
    print(f"Min / Max boxes / image  : {lo} / {hi}")
    if flagged:
        print(f"\nImages with 0 or unusually low boxes (< {low_threshold:.2f}):")
        for name in flagged:
            print(f"  {name}  ({counts[name]} boxes)")
    else:
        print("\nNo images with 0 or unusually low box counts.")

    if args.debug:
        print(f"\nDebug previews saved to inspect/blob_detection/ (all images)")
        # aggregate rejection reasons across all debug images
        print("\nRejection summary (all debug images combined):")
        for reason in ("min_area", "max_area", "aspect_ratio",
                       "circularity", "accepted"):
            print(f"  {reason:13s}: {rejection_totals.get(reason, 0)}")
    print(f"Labels/images written to {out}/")


if __name__ == "__main__":
    main()