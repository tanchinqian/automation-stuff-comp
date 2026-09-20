# PasteTrace

[![CI Pipeline](https://github.com/tanchinqian/automation-stuff-comp/actions/workflows/ci.yml/badge.svg)](https://github.com/tanchinqian/automation-stuff-comp/actions/workflows/ci.yml)
![Docker Container](https://img.shields.io/badge/Docker-Containerized-2496ED?logo=docker&logoColor=white)
![Vision Stack](https://img.shields.io/badge/Vision-YOLOv8n%20%2B%20MobileNetV2-00E5FF)
![Offline First](https://img.shields.io/badge/Architecture-100%25%20On--Device%20Offline-2ee6a8)

PasteTrace is an offline-first, on-device AI troubleshooting console for fluid-dispensing defects in electronics and semiconductor manufacturing. It turns automated solder paste inspection (SPI) board images into explainable root-cause diagnoses, prioritized containment actions, and audit-ready 8D Non-Conformance Reports (NCR), continuously learning from every closed case.

---

![PasteTrace Active Inspection](docs/images/active_inspection.png)

---

## Key Capabilities

### 1. Two-Stage Vision Pipeline (On-Device & Offline)
- **Stage 1 (YOLOv8n)**: Pinpoint and extract microscopic component solder legs and pads across full PCB images.
- **Stage 2 (MobileNetV2 ONNX)**: Classify each cropped pad into **Good**, **Less Paste** (insufficient volume), or **Bridging** (solder short).
- Runs directly inside your browser or via the bundled local FastAPI backend with sub-second inference.

### 2. Bayesian Evidence-Scoring Root Cause Engine
- Feeds detected defect geometries and technician symptom logs into an industrial dispensing knowledge base.
- Generates ranked root causes with probabilistic likelihoods (e.g., *Air trapped in syringe / supply*, *Material viscosity drift*, *Nozzle blockage*, *Drifting dispensing pressure*).

### 3. Comprehensive 8D Non-Conformance (NCR) Reporting
- Follows the automotive and electronics manufacturing 8D problem-solving discipline (D1 through D8).
- One-click export to a clean, publication-quality 3-page PDF report complete with defect telemetry, quality scoring metrics, and containment actions.

### 4. Adaptive Learning Database
- Engineers confirm or correct root-cause findings after physical verification.
- Every closed case is logged and automatically shifts Bayesian prior probabilities, making future diagnoses for the same production line progressively more accurate.

---

## Visual Tour

### Industrial Inspection Workbench
High-density cockpit layout designed as a dark industrial instrument with zero generic chatbot aesthetic.

![Workbench Overview](docs/images/workbench_overview.png)

### Evidence-Based Root Cause Diagnosis
Probabilistic breakdown showing physical mechanism, category, evidence weighting, and step-by-step action plans.

![Diagnosis Rankings](docs/images/diagnosis_rankings.png)

### 8D Quality & Non-Conformance Workflow
Interactive 8D discipline stepper covering containment (D3), root cause verification (D4), corrective actions (D5), and systemic recurrence prevention (D7).

![8D Quality Console](docs/images/8d_report.png)

---

## Quick Start (Docker - Recommended for Evaluators)

Run the complete application (frontend, FastAPI backend, YOLOv8 detector, ONNX classifier, and seed database) in a single self-contained container with one command. No need to install Node.js, Python, or PyTorch:

```bash
docker compose up
```

Open **http://localhost:8000** in your browser. All API endpoints, sample boards, and models are live immediately.

To stop the container:
```bash
docker compose down
```

---

## Manual Setup (Local Development)

Requires Node 22+ and Python 3.11+ (the vision stack is tested on Python 3.11 - 3.13).

```bash
git clone https://github.com/tanchinqian/automation-stuff-comp.git
cd automation-stuff-comp

npm install                                 # install frontend dependencies
python -m pip install -r requirements.txt   # install Python vision dependencies

npm run dev                 # launch web app at http://localhost:5173
python server/start.py      # launch local API at http://localhost:8000 (optional)
```

Open **http://localhost:5173**. Without the Python server running, vision falls back to on-device browser inference and chat falls back to offline templates. 

For the conversational Gemini diagnosis assistant, copy `.env.example` to `.env` and provide your `GEMINI_API_KEY`.

---

## Bundled Vision Models

The repository ships with all pre-trained vision models pre-compiled and ready to run offline:

| Model | File Path | Architecture |
| :--- | :--- | :--- |
| **Stage-1 Leg Detector** | `models/leg_detector.pt` | Ultralytics YOLOv8n |
| **Stage-2 Crop Classifier** | `models/leg_classifier.onnx` | MobileNetV2 ONNX |
| **Classifier Labels** | `models/leg_classifier_labels.json` | JSON label map |

---

## Development Commands

| Command | Description |
| :--- | :--- |
| `npm run dev` | Start local Vite development server (`http://localhost:5173`) |
| `npm run build` | Typecheck (`tsc`) and compile production bundle into `dist/` |
| `npm test` | Run engine evidence-scoring and vision pipeline sanity tests |
| `npm run eval` | Run rule-engine and NLU evaluation harness against ground truth |
| `python server/start.py` | Run local FastAPI pipeline server on port `8000` |
| `docker compose up` | Launch full containerized application on port `8000` |

---

## Architecture & Documentation

- `PRODUCT.md` - Comprehensive product specification, user personas, and manufacturing requirements.
- `DESIGN.md` - Precision Lab Console design system tokens, typography, and anti-pattern rules.
- `AGENTS.md` - Development guidelines and strict design mandates.
