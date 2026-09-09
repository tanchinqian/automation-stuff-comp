#!/usr/bin/env python3
"""Train YOLOv8s on the PCB-AoI dataset and export ONNX.

Must be run as a file (not -c) so multiprocessing workers work on Windows.
Usage:
  python scripts/train_yolo.py
"""
import sys
from pathlib import Path

if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(root))

    from ultralytics import YOLO

    model = YOLO("yolov8s.pt")
    model.train(
        data="runs/yolo-data/data.yaml",
        epochs=150,
        imgsz=640,
        device=0,
        batch=16,
        project="runs",
        name="yolo8s-pcb",
        exist_ok=True,
        verbose=False,
    )
    print("TRAIN_DONE")

    # Export ONNX (fp16) for the browser runtime
    best = Path("runs/yolo8s-pcb/weights/best.pt")
    if best.exists():
        model = YOLO(str(best))
        model.export(format="onnx", half=True, imgsz=640)
        print("EXPORT_DONE")