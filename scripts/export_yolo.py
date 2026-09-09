#!/usr/bin/env python3
"""Export the trained YOLOv8s best.pt to ONNX (fp16) for the browser."""
from pathlib import Path

if __name__ == "__main__":
    from ultralytics import YOLO

    best = Path("runs/detect/runs/yolo8s-pcb/weights/best.pt")
    model = YOLO(str(best))
    model.export(format="onnx", half=True, imgsz=640)
    print("EXPORT_DONE")
    onnx = best.with_suffix(".onnx")
    if onnx.exists():
        print(f"onnx size: {onnx.stat().st_size / 1e6:.1f} MB")