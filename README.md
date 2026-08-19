# DISPENSE.AI — AI Dispensing Defect Detective

**NSW Automation · AI Horizon Solution Challenge 2026**

An on-device AI troubleshooting console for fluid-dispensing defects in electronics /
semiconductor manufacturing. Designed to be a genuinely different take on the brief —
**no cloud APIs required, runs 100% offline**, and every "AI" decision is explainable.

## Why this is different

Most teams ship a chatbot that wraps ChatGPT. This project inverts that:

- **A transparent diagnostic engine** (rules + evidence scoring) is the brain. Every
  ranking is traceable: *which symptoms pointed at which cause, and why.*
- **Classical computer vision** (Otsu threshold → connected-component labelling →
  defect classification) — not "upload to a vision API".
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
| 6 | **Image recognition** via a real CV pipeline + synthetic demo generator + photo upload (Bonus 1) | ✅ |
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
  vision/     computer-vision pipeline + synthetic defect generator + quality score
  db/         IndexedDB learning database + case-based priors + demo seed data
  report/     on-device PDF report generator (jsPDF)
  live/       ESP32-CAM live-stream wiring point (placeholder)
  ui/         UI modules (troubleshoot console, vision, live, learning DB, report)
```

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