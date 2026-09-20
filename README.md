# PasteTrace

[![CI Pipeline](https://github.com/tanchinqian/automation-stuff-comp/actions/workflows/ci.yml/badge.svg)](https://github.com/tanchinqian/automation-stuff-comp/actions/workflows/ci.yml)

PasteTrace is an integrated troubleshooting console that turns a board inspection image into an explainable root-cause diagnosis, a step-by-step fix plan, and an exportable 8D report, learning from every case it closes.

## Quick Start (Docker - Recommended for Evaluators)

Run the entire application (frontend + FastAPI + vision models) in a single self-contained container with one command—no need to install Node.js, Python, or PyTorch:

```bash
docker compose up
```

Open **http://localhost:8000** in your browser. All API endpoints and the interactive console are ready.

---

## Manual Setup (Development)

Requires Node 22+ and Python 3.11+ (the vision stack is tested on 3.13).

```bash
git clone https://github.com/tanchinqian/automation-stuff-comp.git
cd automation-stuff-comp

npm install                                 # frontend deps
python -m pip install -r requirements.txt   # local API deps

npm run dev                 # web app: http://localhost:5173
python server/start.py      # local API: http://localhost:8000 (optional)
```

Open http://localhost:5173. Without the server, vision falls back on-device and the chat falls back to offline replies. For the AI chat, copy `.env.example` to `.env` and add a Gemini API key.

### Server models

The local API loads three bundled model files. They are committed to the repo, so a fresh clone already has them:

| Model | Path |
| --- | --- |
| Stage-1 leg detector (YOLOv8n) | `models/leg_detector.pt` |
| Stage-2 crop classifier (MobileNetV2, ONNX) | `models/leg_classifier.onnx` |
| Classifier labels | `models/leg_classifier_labels.json` |

`python server/start.py` only auto-installs the API layer (`fastapi`, `uvicorn`, `python-multipart`, `google-genai`, `python-dotenv`). The vision stack (`ultralytics`, `torch`, `onnxruntime`, `Pillow`, `numpy`) comes from `requirements.txt`.

### Updating an existing clone

```bash
git pull
python -m pip install -r requirements.txt
```

Restart the API after pulling: models load once at startup.

### Troubleshooting

| Symptom | Fix |
| --- | --- |
| `FileNotFoundError: .../leg_detector.pt` or `.../leg_classifier.onnx` on startup | The model files are missing. Run `git pull` and confirm the three files above exist under `models/`. |
| `ModuleNotFoundError: ultralytics` (or `onnxruntime`, `PIL`) | Run `python -m pip install -r requirements.txt`. |
| API starts but chat replies "having trouble connecting" | Set `GEMINI_API_KEY` in `.env` (copy `.env.example`). |

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the web app (http://localhost:5173) |
| `npm run build` | Typecheck + production build into `dist/` |
| `npm test` | Engine and vision sanity checks |
| `npm run eval` | Rule-engine + NLU eval harness |
| `python server/start.py` | Start the local API (http://localhost:8000) |

More: `PRODUCT.md` for what it does, `DESIGN.md` for the design system.
