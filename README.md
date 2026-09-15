# DISPENSE.AI

An on-device troubleshooting console for fluid-dispensing defects (solder paste, adhesives) in electronics manufacturing. Point it at a board image, get an explainable diagnosis, an action plan, and a loggable 8D report.

Two parts:

- **Web app** (Vite + TypeScript, no framework): Workbench, Report, Learning DB, light/dark mode.
- **Local server** (FastAPI, `server/`): the vision pipeline (YOLOv8s + MobileNetV2) and the Gemini-backed diagnosis chat.

## Quick start

```bash
# 1. web app
npm install
npm run dev                 # http://localhost:5173

# 2. local server (new terminal, installs missing pip packages itself)
python server/start.py      # http://localhost:8000
```

Open http://localhost:5173. Boards in the Workbench gallery run through the server. If the server is not running, vision falls back on-device (ONNX YOLO, then classical CV) and the chat falls back to offline templates, so the app still works.

For the chat, copy `.env.example` to `.env` and add a Gemini API key. Everything else needs no configuration.

## What you get

- **Image inspection** - board analysis with per-leg/board results, quality score, and PASS/FAIL verdict.
- **Diagnosis** - a transparent rule engine turns symptoms into ranked causes with reasons, plus a troubleshooting sequence. No black box.
- **Assistant** - a chat drawer for guided discovery, with on-device NLU fallback when there is no server.
- **Report** - an 8D report you can fill in and export to PDF, including the board image and the saved report fields.
- **Learning DB** - cases from IndexedDB and the server log side by side, with search, edit/delete, and priors that sharpen future rankings.

## How it works

1. **Vision**: a YOLOv8s leg detector finds dispensed legs, a MobileNetV2 crop classifier labels each one (Good / Less Paste / Bridging). Falls back to on-device ONNX then classical per-pad CV.
2. **Rules**: symptoms feed an evidence-weighted scorer over a knowledge base of defects and causes, blended with priors learned from past cases.
3. **Chat**: the server grounds Gemini in the current analysis, symptom evidence, and historical cases; offline it uses Gemini Nano, an in-browser model, or keyword rules.
4. **Learn**: saving or confirming a case adds it to the learning database, which shifts the cause priors for later diagnoses.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the web app (http://localhost:5173) |
| `npm run build` | Typecheck + production build into `dist/` |
| `npm run preview` | Serve the production build |
| `npm test` | Engine, vision, and quality-score sanity checks |
| `python server/start.py` | Start the local API (http://localhost:8000) |

## Project layout

```
src/
  engine/    knowledge base, evidence scoring, question flow, action plans
  nlu/       layered offline NLU (Gemini Nano -> in-browser model -> keywords)
  vision/    in-browser CV fallback (ONNX YOLO + classical per-pad)
  db/        IndexedDB case store + case-based priors
  report/    on-device PDF report + board-image embedding
  ui/        Workbench, Report, Learning DB, Assistant drawer
  api/       typed client for the local server
server/      FastAPI app (analyze, boards, cases CRUD, chat)
public/models/  on-device ONNX model + classes (ships in the repo)
scripts/     dataset/YOLO helpers (see scripts/ for training commands)
```

## Notes

- Vision and the rule engine run fully offline. Only the chat needs the local server plus a Gemini key.
- The server's trained weights (`runs/`, `models/`) are not committed; `public/models/` ships the on-device model.
- The server allows the dev origin `http://localhost:5173` via CORS. Add your origin in `server/app.py` if you serve the app elsewhere.
- Design language and tokens: see `DESIGN.md`.
