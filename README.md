# DISPENSE.AI — AI Dispensing Defect Detective

**NSW Automation · AI Horizon Solution Challenge 2026**

An on-device AI troubleshooting console for fluid-dispensing defects in electronics /
semiconductor manufacturing. Designed to be a genuinely different take on the brief —
**no cloud APIs required, runs 100% offline**, and every "AI" decision is explainable.

## Why this is different

Most teams ship a chatbot that wraps ChatGPT. This project inverts that:

- **A transparent diagnostic engine** (rules + evidence scoring) is the brain. Every
  ranking is traceable: *which symptoms pointed at which cause, and why.*
- **On-device AI vision** — a trained YOLOv8s detector (ONNX via onnxruntime-web)
  finds solder-paste defects on real boards, with a classical per-pad CV fallback.
  No image ever leaves the browser.
- **A genuinely learning database** — cases and their resolved fixes update the
  cause priors, so the tool gets smarter with each use, entirely in the browser.
- **Layered on-device NLU** — Chrome Gemini Nano → in-browser model (transformers.js)
  → embedded keyword rules. It always works, even fully offline.

## Features

| # | Feature | Status |
|---|---------|--------|
| 1 | **Workbench**: merged workspace — AI chat sidebar + image inspection + diagnosis in one screen | ✅ |
| 2 | 5 smart intake questions + **dynamic follow-up questions** (Bonus) | ✅ |
| 3 | Defect identification with confidence | ✅ |
| 4 | Ranked possible causes with likelihood bars + **explained reasoning** | ✅ |
| 5 | Troubleshooting action plan (sequential checks) | ✅ |
| 6 | **Image recognition** — on-device YOLOv8s detection + synthetic demo generator + photo upload (Bonus 1) | ✅ |
| 7 | **Dispensing Quality Score** (shape/size/position/defect-risk → /100) (Bonus 2) | ✅ |
| 8 | **AI Learning Database** in IndexedDB — cases, resolved outcomes, prior updates (Bonus 3) | ✅ |
| 9 | **PDF troubleshooting report** generated on-device (Bonus 4) | ✅ |
| 10 | **Live Inspection** mode — synthetic simulator + webcam live + **ESP32-CAM placeholder** | ✅ (ESP32 stub) |

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build -> dist/
npm run preview    # serve the production build
npm test           # sanity checks for the engine + quality scoring
```

## Project structure

```
src/
  engine/     knowledge base (defects/causes/symptoms/rules), evidence scoring,
              question flow, action plan generator
  nlu/        layered LLM router (Gemini Nano -> transformers.js -> heuristics)
  vision/     computer-vision pipeline (dot + SPI/board modes), quality score
  data/       swappable dataset providers (PCB-AoI, custom) + registry
  db/         IndexedDB learning database + case-based priors + demo seed data
  report/     on-device PDF report generator (jsPDF)
  live/       ESP32-CAM live-stream wiring point (placeholder)
  ui/         UI modules (workbench, vision gallery, live, learning DB, report)
scripts/
  generate-placeholder-boards.mjs   builds schematic demo boards + boards.json
  build-boards.mjs                  converts a real VOC dataset into boards.json
```

## Real inspection data (on-device YOLO + swappable dataset)

The Workbench inspection panel analyzes real SPI/PCB boards with a **trained
YOLOv8s detector** running fully on-device via `onnxruntime-web` (model in
`public/models/solder-defect.onnx`). A classical per-pad CV pipeline is the
fallback when the model is unavailable. Boards come from a swappable dataset
provider in `src/data/`:

- **Active dataset** is chosen in `src/data/datasetConfig.ts`.
- **PCB-AoI** (`src/data/providers/pcbAoi.ts`) is the target real dataset
  (solder-paste SPI: less-paste, bridging), read from `public/boards/boards.json`.
- The repo ships **schematic placeholder boards** so the gallery runs offline.
  To bundle the real dataset:

  ```
  npm i -D sharp
  node scripts/build-boards.mjs --data <path-to-pcb-aoi>
  ```

  This parses the Pascal-VOC annotations at build time into `boards.json` and
  downscales images. See `ATTRIBUTION.md` for dataset credits.

- A **Custom provider** (`src/data/providers/custom.ts`) is the escape hatch for
  future datasets or live photo uploads without touching the detector.

### Training the YOLO model (one-time)

The bundled model is trained on the PCB-AoI dataset (GPU optional):

```
python scripts/yolo_prep.py     # VOC -> YOLO images/labels + data.yaml
python scripts/train_yolo.py    # train yolov8s, 150 epochs, then export ONNX
python scripts/export_yolo.py   # (if training was interrupted) export best.pt -> onnx
```

Output lands in `public/models/solder-defect.onnx` + `classes.json`. Detection
code lives in `src/vision/yoloDetector.ts`; `analyzeBoardFromDetections` maps
detections into the shared `BoardAnalysis` shape.

## ESP32-CAM live stream (placeholder)

The Live Inspection tab is ready to accept a hardware stream. The wiring point is
`src/live/esp32.ts`. Point it at the ESP32-CAM's MJPEG URL (default
`http://192.168.4.1/stream`) and each captured frame runs through the same CV
pipeline. A YOLO-style CNN (`.tflite` / ONNX) can be dropped in for the live path
without touching the rest of the app. A webcam and a synthetic simulator are
included so the live demo always works even without hardware.

## Notes

- First run is fully offline: the embedded rules engine needs nothing. If you're
  online, the app may fetch a small on-device model once for richer free-text
  parsing (cached afterward). Gemini Nano is used automatically when available.
- Serving over `http` (not `https`) is required to reach a local ESP32 stream
  (mixed-content restriction).