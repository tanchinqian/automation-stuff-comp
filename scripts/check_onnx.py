#!/usr/bin/env python3
"""Sanity-check the exported ONNX on one real board image via onnxruntime-gpu."""
import numpy as np

if __name__ == "__main__":
    import onnxruntime as ort
    import cv2

    sess = ort.InferenceSession("public/models/solder-defect.onnx", providers=["CPUExecutionProvider"])
    inp = sess.get_inputs()[0]
    iname = inp.name
    _, _, ih, iw = inp.shape
    print(f"input: {iname} {inp.shape}")

    img = cv2.imread("train_data/JPEGImages/20161025-SPI-AOI-2.jpeg")
    if img is None:
        raise SystemExit("no test image")
    # letterbox
    scale = min(iw / img.shape[1], ih / img.shape[0])
    rw, rh = int(img.shape[1] * scale), int(img.shape[0] * scale)
    resized = cv2.resize(img, (rw, rh))
    canvas = np.full((ih, iw, 3), 114, dtype=np.uint8)
    canvas[:rh, :rw] = resized
    blob = canvas[:, :, ::-1].transpose(2, 0, 1).astype(np.float32) / 255.0
    blob = np.expand_dims(blob, 0)

    out = sess.run(None, {iname: blob})
    print("outputs:", [(o.shape, o.dtype) for o in out])
    # detection output: [1, 84, 8400]
    det = out[0][0]
    boxes = det[:4]  # cx, cy, w, h (normalized)
    scores = det[4:]
    cls = np.argmax(scores, axis=0)
    conf = scores[cls, np.arange(scores.shape[1])]
    keep = np.where(conf > 0.4)[0]
    print(f"detections > 0.4 conf: {len(keep)}")
    for i in keep[:6]:
        print(f"  cls={cls[i]} conf={conf[i]:.2f} box=({boxes[0,i]:.3f},{boxes[1,i]:.3f},{boxes[2,i]:.3f},{boxes[3,i]:.3f})")