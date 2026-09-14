#!/usr/bin/env python3
"""Leg-zone configuration for the crop-and-classify pipeline.

This is the ONE file you edit when the crops do not land on the IC legs.
Each zone is a pixel rectangle (x1, y1, x2, y2) in the ORIGINAL 600x600 image.

How to tune:
  1. Run `python scripts/sample_grid.py` to get grid overlays in inspect/.
  2. Read the pixel coordinates of each leg off the grid.
  3. Replace the numbers below.
  4. Run `python scripts/crop_legs.py --overlay` to draw the zones back onto
     a few sample images and confirm they sit on the legs.

NOTE: the values below are PROVISIONAL - derived from where defects cluster in
the annotations, not from looking at the images. They assume a package roughly
spanning x 100-520 with 4 legs on the top edge and 4 on the bottom edge.
Adjust once you have reviewed inspect/.
"""

# Optional margin added around every zone when cropping (pixels). 0 = exact.
PAD = 0

# ---------------------------------------------------------------------------
# PER-LAYOUT TEMPLATES
#
# Each template describes the expected leg/pin positions for one IC package
# layout, as pixel rectangles in a 600x600 image. build_leg_detector.py tries
# each template in turn and keeps the one whose boxes land on actual pins
# (measured by colour/variance inside the box vs. the dark background).
#
# "name"  - short label for logs (not used as the YOLO class).
# "zones" - list of {"name": ..., "box": (x1, y1, x2, y2)} rectangles. Every
#           box in a template is labelled as class "leg" (id 0).
# ---------------------------------------------------------------------------
TEMPLATES = [
    {
        "name": "dual8",
        "zones": [
            # top edge, 4 legs
            {"name": "top1", "box": (117, 20, 187, 100)},
            {"name": "top2", "box": (222, 20, 292, 100)},
            {"name": "top3", "box": (327, 20, 397, 100)},
            {"name": "top4", "box": (432, 20, 502, 100)},
            # bottom edge, 4 legs
            {"name": "bottom1", "box": (117, 500, 187, 580)},
            {"name": "bottom2", "box": (222, 500, 292, 580)},
            {"name": "bottom3", "box": (327, 500, 397, 580)},
            {"name": "bottom4", "box": (432, 500, 502, 580)},
        ],
    },
    {
        "name": "quad16",
        "zones": [
            # top edge, 4 legs
            {"name": "top1", "box": (117, 20, 187, 100)},
            {"name": "top2", "box": (222, 20, 292, 100)},
            {"name": "top3", "box": (327, 20, 397, 100)},
            {"name": "top4", "box": (432, 20, 502, 100)},
            # bottom edge, 4 legs
            {"name": "bottom1", "box": (117, 500, 187, 580)},
            {"name": "bottom2", "box": (222, 500, 292, 580)},
            {"name": "bottom3", "box": (327, 500, 397, 580)},
            {"name": "bottom4", "box": (432, 500, 502, 580)},
            # left edge, 4 legs
            {"name": "left1", "box": (20, 110, 100, 195)},
            {"name": "left2", "box": (20, 215, 100, 300)},
            {"name": "left3", "box": (20, 320, 100, 405)},
            {"name": "left4", "box": (20, 425, 100, 510)},
            # right edge, 4 legs
            {"name": "right1", "box": (500, 110, 580, 195)},
            {"name": "right2", "box": (500, 215, 580, 300)},
            {"name": "right3", "box": (500, 320, 580, 405)},
            {"name": "right4", "box": (500, 425, 580, 510)},
        ],
    },
]

# ---------------------------------------------------------------------------
# THE ZONES - edit these (x1, y1, x2, y2) pixel rectangles
# ---------------------------------------------------------------------------
LEG_ZONES = [
    # --- top edge (4 legs) ---
    {"name": "top1", "box": (117, 20, 187, 100)},
    {"name": "top2", "box": (222, 20, 292, 100)},
    {"name": "top3", "box": (327, 20, 397, 100)},
    {"name": "top4", "box": (432, 20, 502, 100)},

    # --- bottom edge (4 legs) ---
    {"name": "bottom1", "box": (117, 500, 187, 580)},
    {"name": "bottom2", "box": (222, 500, 292, 580)},
    {"name": "bottom3", "box": (327, 500, 397, 580)},
    {"name": "bottom4", "box": (432, 500, 502, 580)},

    # --- left edge (4 legs) ---
    {"name": "left1", "box": (20, 110, 100, 195)},
    {"name": "left2", "box": (20, 215, 100, 300)},
    {"name": "left3", "box": (20, 320, 100, 405)},
    {"name": "left4", "box": (20, 425, 100, 510)},

    # --- right edge (4 legs) ---
    {"name": "right1", "box": (500, 110, 580, 195)},
    {"name": "right2", "box": (500, 215, 580, 300)},
    {"name": "right3", "box": (500, 320, 580, 405)},
    {"name": "right4", "box": (500, 425, 580, 510)},
]
