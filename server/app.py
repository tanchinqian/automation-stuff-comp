#!/usr/bin/env python3
"""Local FastAPI server wrapping the two-stage PCB defect pipeline.

The Vite frontend (http://localhost:5173) calls these endpoints. Models load
ONCE at startup, not per request.

Endpoints:
  GET  /health
  GET  /boards
  GET  /boards/{filename}/thumbnail
  POST /analyze            (JSON {image_path} OR multipart {file})
  POST /cases              (log a case for the learning database)
  GET  /cases/similar?defect_type=...

Run with:  python server/start.py
"""
import json
import os
import random
import re
import sys
import tempfile
import time
import uuid
import xml.etree.ElementTree as ET
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# make the repo root importable so `scripts.pipeline` resolves
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# load .env from the repo root before reading any config values
load_dotenv(ROOT / ".env")

from scripts.pipeline import analyze_board, load_models  # noqa: E402

# ---------------------------------------------------------------------------
# paths / config
# ---------------------------------------------------------------------------
TRAIN_IMG_DIR = ROOT / "train_data" / "JPEGImages"
ANNOTATION_DIR = ROOT / "train_data" / "Annotations"
CASES_DIR = ROOT / "cases"
CASES_FILE = CASES_DIR / "case_log.json"
TEMP_DIR = ROOT / "server" / "_uploads"
MODEL_VERSION = "1.0"
PORT = 8000

# Gemini chat configuration (see .env)
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
# GEMINI_MODEL may be a comma-separated fallback chain, e.g.
#   GEMINI_MODEL=gemini-3.1-flash-lite,gemini-2.5-flash,gemini-2.0-flash
# each model is tried in order until one responds.
GEMINI_MODELS = [
    m.strip()
    for m in os.getenv("GEMINI_MODEL", "gemini-3.1-flash-lite").split(",")
    if m.strip()
]
GEMINI_MODEL = GEMINI_MODELS[0] if GEMINI_MODELS else "gemini-3.1-flash-lite"
CHAT_HISTORY_LIMIT = int(os.getenv("CHAT_HISTORY_LIMIT", "20"))
PLACEHOLDER_KEY = "your_gemini_api_key_here"
# ---------------------------------------------------------------------------

# filled in at startup
MODELS_LOADED = False


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load both models once when the server boots."""
    global MODELS_LOADED
    if not GEMINI_API_KEY or GEMINI_API_KEY == PLACEHOLDER_KEY:
        print("WARNING: GEMINI_API_KEY not set. Chat endpoint will return errors.")
    else:
        print("Gemini chat models (fallback order): " + " -> ".join(GEMINI_MODELS))
    print("Loading models...")
    load_models()          # prints which YOLO + ONNX models were loaded
    MODELS_LOADED = True
    seed_case_log()        # create demo learning-database records if empty
    print(f"Models loaded. Serving on http://localhost:{PORT}")
    yield
    print("Server shutting down.")


app = FastAPI(title="PasteTrace pipeline server", lifespan=lifespan)

# allow the Vite dev server to call us from the browser
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def resolve_image_path(image_path: str) -> Path:
    """Resolve a client path to a real file, restricted to the repo root."""
    candidate = Path(image_path)
    if not candidate.is_absolute():
        candidate = ROOT / candidate
    resolved = candidate.resolve()
    # security: never let the client read outside the project
    if ROOT not in resolved.parents and resolved != ROOT:
        raise HTTPException(status_code=400, detail="image_path outside project")
    if not resolved.exists():
        raise HTTPException(status_code=404, detail=f"image not found: {image_path}")
    return resolved


def ground_truth_for(filename: str):
    """Read the VOC XML and return a defect class name, or None."""
    xml_path = ANNOTATION_DIR / f"{Path(filename).stem}.xml"
    if not xml_path.exists():
        return None
    try:
        root = ET.parse(xml_path).getroot()
    except ET.ParseError:
        return None

    names = [(o.find("name").text or "").strip()
             for o in root.findall("object")]
    names = [n for n in names if n]
    if not names:
        # a valid annotation with no defects = a good board
        return "good"
    # most frequent class wins (ties -> first)
    return max(sorted(set(names)), key=names.count)


def load_cases() -> list:
    """Read the append-only case log, or [] if it does not exist yet."""
    if not CASES_FILE.exists():
        return []
    try:
        return json.loads(CASES_FILE.read_text())
    except json.JSONDecodeError:
        return []


def save_cases(cases: list) -> None:
    CASES_DIR.mkdir(parents=True, exist_ok=True)
    CASES_FILE.write_text(json.dumps(cases, indent=2))


def case_matches(case: dict, defect_type: str) -> bool:
    """Does this case relate to the requested defect type?

    If the engineer confirmed specific defects, that confirmation is
    authoritative; otherwise fall back to the vision defect summary.
    """
    fb = case.get("engineer_feedback", {}) or {}
    confirmed = fb.get("confirmed_defects") or []
    if confirmed:
        return defect_type in confirmed
    result = case.get("analysis_result", {})
    summary = result.get("defect_summary", {}) or {}
    return summary.get(defect_type, 0) > 0


# ---------------------------------------------------------------------------
# Demo seed data for the learning database
# ---------------------------------------------------------------------------
def generate_seed_cases() -> list:
    """20 realistic confirmed cases (12 Less Paste, 8 Bridging).

    Uses causes whose names match the rule engine's CAUSES exactly, so the
    confirmations can feed the engine priors. Deterministic (seeded) so the
    /cases/similar counts are stable.
    """
    rng = random.Random(42)
    now = time.time()

    stems = [
        "20161019-SPI-AOI-1", "20161025-SPI-AOI-2", "20161021-SPI-AOI-13",
        "20161028-SPI-AOI-2", "20161102-SPI-AOI-9", "20161102-SPI-AOI-32",
        "20161021-SPI-AOI-17", "20161025-SPI-AOI-4", "20161021-SPI-AOI-14",
        "20161028-SPI-AOI-15", "20161021-SPI-AOI-15", "20161028-SPI-AOI-4",
        "20161021-SPI-AOI-16", "20161021-SPI-AOI-18", "20161025-SPI-AOI-5",
        "20161025-SPI-AOI-6", "20161020-SPI-AOI-5", "20170111-SPI-AOI-10",
        "20161227-SPI-AOI-5", "20170213-SPI-AOI-2",
    ]
    notes = [
        "Purged syringe, air bubble confirmed. Problem resolved.",
        "Material batch expired, replaced with fresh paste.",
        "Nozzle partially clogged with dried material, cleaned and recalibrated.",
        "Pressure regulator drift corrected, dispense stable again.",
        "Replaced valve seal; volume is repeatable again.",
        "Viscosity adjusted for shop temperature change.",
    ]
    # (confirmed cause, count) per defect type
    less_paste = [
        ("Air trapped in syringe / supply", 5),
        ("Material viscosity change", 3),
        ("Partially blocked nozzle", 2),
        ("Unstable dispensing pressure", 2),
    ]
    bridging = [
        ("Unstable dispensing pressure", 3),
        ("Material viscosity change", 3),
        ("Valve or seal wear", 2),
    ]

    cases = []
    idx = 0

    def make(cause: str, defect: str):
        nonlocal idx
        stem = stems[idx % len(stems)]
        if defect == "Less Paste":
            less = rng.randint(1, 4)
            bridge = rng.randint(0, 2)
        else:
            less = rng.randint(0, 2)
            bridge = rng.randint(1, 4)
        good = rng.randint(8, 14)
        cases.append({
            "case_id": uuid.uuid4().hex[:12],
            "timestamp": now - rng.uniform(0, 90) * 86400,
            "image_path": f"train_data/JPEGImages/{stem}.jpeg",
            "analysis_result": {
                "board_verdict": "FAIL",
                "defect_summary": {
                    "Less Paste": less,
                    "Bridging": bridge,
                    "Good": good,
                },
                "total_legs_detected": less + bridge + good,
                "flagged_legs": less + bridge,
                "low_confidence_count": rng.randint(0, 2),
            },
            "engineer_feedback": {
                "actual_cause": cause,
                "confirmed_defects": [defect],
                "notes": notes[idx % len(notes)],
            },
        })
        idx += 1

    for cause, count in less_paste:
        for _ in range(count):
            make(cause, "Less Paste")
    for cause, count in bridging:
        for _ in range(count):
            make(cause, "Bridging")
    return cases


def seed_case_log() -> None:
    """Create case_log.json with demo records only if missing or empty."""
    CASES_DIR.mkdir(parents=True, exist_ok=True)
    if not CASES_FILE.exists():
        save_cases(generate_seed_cases())
        print("INFO: Seeded cases/case_log.json with 20 demo records")
        return
    try:
        existing = load_cases()
    except Exception:      # noqa: BLE001
        existing = []
    if len(existing) == 0:
        save_cases(generate_seed_cases())
        print("INFO: case_log.json was empty, seeded with 20 demo records")


# ---------------------------------------------------------------------------
# endpoints
# ---------------------------------------------------------------------------
@app.get("/health")
def health():
    return {
        "status": "ok",
        "models_loaded": MODELS_LOADED,
        "chat_configured": gemini_configured(),
    }


@app.get("/boards")
def boards():
    """List available board images with ground-truth labels."""
    items = []
    if TRAIN_IMG_DIR.exists():
        for p in sorted(TRAIN_IMG_DIR.glob("*")):
            if p.suffix.lower() not in (".jpg", ".jpeg", ".png"):
                continue
            items.append({
                "filename": p.name,
                "path": p.relative_to(ROOT).as_posix(),
                "ground_truth": ground_truth_for(p.name),
            })
    return {"boards": items}


@app.get("/boards/{filename}/thumbnail")
def thumbnail(filename: str):
    """Return the raw image file for display in the UI."""
    # reject any path tricks in the filename
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="bad filename")
    path = TRAIN_IMG_DIR / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail="image not found")
    return FileResponse(path, media_type="image/jpeg")


@app.post("/analyze")
async def analyze(request: Request):
    """Run the pipeline on a path OR an uploaded file.

    JSON body   : {"image_path": "train_data/JPEGImages/x.jpeg"}
    multipart   : field "file" = image upload
    """
    started = time.perf_counter()
    content_type = request.headers.get("content-type", "")

    temp_path = None
    try:
        if content_type.startswith("multipart/form-data"):
            form = await request.form()
            upload = form.get("file")
            if upload is None:
                raise HTTPException(status_code=400, detail="missing 'file' field")
            TEMP_DIR.mkdir(parents=True, exist_ok=True)
            suffix = Path(upload.filename or "upload.jpg").suffix or ".jpg"
            fd, tmp = tempfile.mkstemp(suffix=suffix, dir=TEMP_DIR)
            with open(fd, "wb") as f:
                f.write(await upload.read())
            temp_path = Path(tmp)
            image_file = temp_path
        else:
            body = await request.json()
            if "image_path" not in body:
                raise HTTPException(status_code=400,
                                    detail="missing 'image_path'")
            image_file = resolve_image_path(body["image_path"])

        result = analyze_board(str(image_file))
        # store a portable repo-relative path when the file lives in the repo
        # (analyze_board echoes the path it was given, which is absolute on Windows)
        try:
            result["image_path"] = image_file.resolve().relative_to(ROOT).as_posix()
        except ValueError:
            result["image_path"] = str(image_file)
        result["processing_time_ms"] = round(
            (time.perf_counter() - started) * 1000, 2)
        result["model_version"] = MODEL_VERSION
        return result
    finally:
        # never leave uploaded temp files behind
        if temp_path is not None and temp_path.exists():
            temp_path.unlink(missing_ok=True)


@app.post("/cases")
async def create_case(request: Request):
    """Insert or update a case in cases/case_log.json.

    If the body carries a `case_id` that already exists, that record is updated
    (so SAVE CASE and the engineer-confirmation button refer to one case);
    otherwise a new record is appended.
    """
    body = await request.json()
    if "image_path" not in body or "analysis_result" not in body:
        raise HTTPException(status_code=400,
                            detail="image_path and analysis_result required")

    cases = load_cases()
    case_id = body.get("case_id") or uuid.uuid4().hex[:12]
    record = {
        "case_id": case_id,
        "timestamp": time.time(),
        "image_path": body["image_path"],
        "analysis_result": body["analysis_result"],
        "ranked_causes": body.get("ranked_causes", []) or [],
        "action_plan": body.get("action_plan", []) or [],
        "engineer_feedback": body.get("engineer_feedback", {}) or {},
    }
    report_data = body.get("report_data")
    if report_data:
        record["report_data"] = report_data

    for i, existing in enumerate(cases):
        if existing.get("case_id") == case_id:
            # keep the original opened time when updating an existing case
            record["timestamp"] = existing.get("timestamp", record["timestamp"])
            # a save that carries no report_data must not wipe a stored one
            if "report_data" not in body and existing.get("report_data"):
                record["report_data"] = existing["report_data"]
            cases[i] = record
            break
    else:
        cases.append(record)

    save_cases(cases)
    return {"case_id": case_id, "saved": True}


@app.get("/cases/all")
def all_cases():
    """Return every stored case record as-is (for the frontend learning loop)."""
    cases = load_cases()
    return {"cases": cases, "total": len(cases)}


@app.patch("/cases/{case_id}")
async def update_case(case_id: str, request: Request):
    """Merge a partial update into one stored case (learning database CRUD).

    Top-level fields are replaced when present; engineer_feedback is merged so a
    partial edit (e.g. only the confirmed cause) keeps the rest. The original
    timestamp is preserved.
    """
    body = await request.json()
    cases = load_cases()
    for i, existing in enumerate(cases):
        if existing.get("case_id") != case_id:
            continue
        merged = {**existing}
        for key in ("image_path", "analysis_result", "ranked_causes", "action_plan", "report_data"):
            if key in body:
                merged[key] = body[key]
        if "engineer_feedback" in body:
            merged["engineer_feedback"] = {
                **(existing.get("engineer_feedback") or {}),
                **(body.get("engineer_feedback") or {}),
            }
        cases[i] = merged
        save_cases(cases)
        return {"case_id": case_id, "updated": True}
    raise HTTPException(status_code=404, detail="case not found")


@app.delete("/cases/{case_id}")
def delete_case(case_id: str):
    """Delete exactly one stored case by case_id (learning database CRUD)."""
    cases = load_cases()
    remaining = [c for c in cases if c.get("case_id") != case_id]
    if len(remaining) == len(cases):
        raise HTTPException(status_code=404, detail="case not found")
    save_cases(remaining)
    return {"case_id": case_id, "deleted": True}


@app.get("/cases/similar")
def similar_cases(defect_type: str):
    """Summarise historical cases for a defect type (learning database)."""
    cases = load_cases()
    matches = [c for c in cases if case_matches(c, defect_type)]

    # dedupe by (image_path + confirmed cause) so repeated confirmations of the
    # same board do not inflate the historical counts
    seen = set()
    deduped = []
    for c in matches:
        key = (c.get("image_path", ""),
               (c.get("engineer_feedback", {}) or {}).get("actual_cause", ""))
        if key not in seen:
            seen.add(key)
            deduped.append(c)

    causes: dict = {}
    for c in deduped:
        fb = c.get("engineer_feedback", {}) or {}
        cause = fb.get("actual_cause")
        if cause:
            causes[cause] = causes.get(cause, 0) + 1

    most_common = max(causes, key=causes.get) if causes else None
    total = len(deduped)

    if total == 0:
        message = (f"No historical cases found for {defect_type} yet.")
    elif most_common:
        message = (f"Similar problems occurred {total} times. "
                   f"In {causes[most_common]} cases, the main cause was "
                   f"{most_common}.")
    else:
        message = (f"Similar problems occurred {total} times. "
                   "No confirmed causes recorded yet.")

    return {
        "defect_type": defect_type,
        "total_cases": total,
        "confirmed_causes": causes,
        "most_common_cause": most_common,
        "message": message,
    }


@app.get("/cases/matching")
def matching_cases(defect_type: str):
    """The actual case records behind /cases/similar's counts (read-only).

    Reuses case_matches() and applies the exact same dedup key as
    /cases/similar, so the returned total always equals its total_cases.
    """
    cases = load_cases()
    matches = [c for c in cases if case_matches(c, defect_type)]

    # dedupe by (image_path + confirmed cause) - identical to /cases/similar
    seen = set()
    deduped = []
    for c in matches:
        key = (c.get("image_path", ""),
               (c.get("engineer_feedback", {}) or {}).get("actual_cause", ""))
        if key not in seen:
            seen.add(key)
            deduped.append(c)

    return {"defect_type": defect_type, "cases": deduped, "total": len(deduped)}


# ---------------------------------------------------------------------------
# Chat layer (Gemini API)
# ---------------------------------------------------------------------------
class ChatMessage(BaseModel):
    role: str            # "user" | "model"
    content: str


class RankedCause(BaseModel):
    cause: str
    score: float
    reasons: list[str] = []


class RuleEngineResult(BaseModel):
    defect_name: str
    defect_confidence: float
    ranked_causes: list[RankedCause] = []
    action_plan: list[str] = []
    reasoning: str = ""


class ChatRequest(BaseModel):
    message: str
    conversation_history: list[ChatMessage] = []
    analysis_result: Optional[dict] = None
    phase: str = "discovery"
    rule_engine_result: Optional[RuleEngineResult] = None
    similar_cases: Optional[dict] = None


class ChatResponse(BaseModel):
    reply: str
    suggested_phase: str
    questions_asked: int
    ready_for_diagnosis: bool


def gemini_configured() -> bool:
    return bool(GEMINI_API_KEY) and GEMINI_API_KEY != PLACEHOLDER_KEY


def build_chat_prompt(req: ChatRequest) -> tuple[str, int]:
    """Assemble the dynamic system prompt for one chat turn.

    Returns (system_prompt, recommended_max_tokens) where the token budget is
    tightened for the discovery phase to enforce brief, single-question replies.
    """
    a = req.analysis_result or {}
    summary = a.get("defect_summary", {}) or {}
    less = summary.get("Less Paste", 0)
    bridge = summary.get("Bridging", 0)
    good = summary.get("Good", 0)
    flagged = a.get("flagged_legs", 0)
    total = a.get("total_legs_detected", less + bridge + good)
    # board quality = share of good legs (matches the UI)
    quality = round((good / total) * 100) if total else 0
    # an analysis with 0 legs means the image was not a usable board shot
    no_board = req.analysis_result is not None and int(total or 0) == 0

    prompt = f"""You are an expert PCB solder paste inspection assistant embedded in an industrial manufacturing console. You help engineers diagnose dispensing defects detected by the vision system.

PERSONALITY: Precise, calm, professional with light warmth. You sound like a senior process engineer who has seen thousands of defect cases - confident but never dismissive of the engineer's observations.

YOUR CONVERSATION MUST FOLLOW THIS FLOW:
Phase 1 - DISCOVERY (current phase: {req.phase})
  - Acknowledge what the vision system detected with specific numbers
  - Ask targeted questions ONE AT A TIME - never list multiple questions at once
  - You need to gather approximately 5 pieces of information:
    * How long has this been happening (sudden vs gradual onset)?
    * Is the defect continuous or intermittent?
    * Has anything changed recently (material, nozzle, settings, supplier)?
    * Is the defect at one location or across multiple locations on the board?
    * What material/paste is being dispensed?
  - Adapt follow-up questions based on what the engineer tells you (e.g. if they say "started after nozzle change", ask about nozzle type/age/cleaning schedule, skip questions already answered)
  - When you have gathered enough information (roughly 4-5 exchanges), set ready_for_diagnosis to true

Phase 2 - DIAGNOSIS ANNOUNCEMENT
  - Only enter this phase when ready_for_diagnosis is true
  - Present findings clearly and naturally, referencing what the engineer told you
  - Use the rule engine results as your foundation but expand naturally:
    * State the identified defect and your confidence
    * Present ranked causes with likelihood percentages and explain WHY each one is ranked where it is - reference both the vision data AND what the engineer told you
    * Present the action plan as a natural narrative, not just a list
  - If similar_cases data is available and total > 0, cite it naturally ("We've seen this pattern N times before. In most cases...")
  - After announcing diagnosis, invite the engineer to confirm or push back

Phase 3 - FOLLOWUP
  - Answer questions naturally
  - If engineer confirms a cause, acknowledge and suggest next steps
  - If engineer disagrees, explore their alternative hypothesis
  - Stay grounded in the vision data and rule engine findings

VISION SYSTEM DATA (always available):
  Board verdict: {a.get('board_verdict', 'n/a')}
  Detected: {less} Less Paste legs, {bridge} Bridging legs, {good} Good legs
  Flagged for review: {flagged} legs
  Board quality score: {quality}/100
"""
    if no_board:
        prompt += """
IMPORTANT - NO BOARD DETECTED IN THE SUPPLIED IMAGE:
  The vision system found 0 legs, so this image is not a recognisable PCB/SPI board (or the shot is
  unusable). The counts above are NOT a "0 defects / clean board" result - they carry no information.
  - State plainly that no board was detected in the image.
  - Do NOT present a defect, defect counts, or ranked causes as if the board had been inspected.
  - Do NOT describe the board as clean, passing or defect-free.
  - If a rule engine pre-analysis is present it came from the engineer's description, not from this
    image: you may still use it, but never attribute defect counts to the image.
  - Ask the engineer for a clearer, straight-on board photo, or offer to continue from their description alone.
"""

    r = req.rule_engine_result
    if r is not None:
        causes_block = "\n".join(
            f"  {i}. {c.cause} - {c.score:.0f}% likelihood\n      Why: {'; '.join(c.reasons)}"
            for i, c in enumerate(r.ranked_causes, start=1)
        )
        steps_block = "\n".join(
            f"  Step {i}: {s}" for i, s in enumerate(r.action_plan, start=1)
        )
        prompt += f"""
RULE ENGINE PRE-ANALYSIS (use as foundation, expand naturally):
  Identified defect: {r.defect_name} ({r.defect_confidence * 100:.0f}% confidence)

  Ranked causes:
{causes_block}

  Suggested action plan:
{steps_block}

  Engine reasoning: {r.reasoning}
"""

    sc = req.similar_cases
    if sc is not None and int(sc.get("total_cases", 0)) > 0:
        prompt += f"""
HISTORICAL CASE DATA:
  {sc.get('message', '')}
  Most common confirmed cause: {sc.get('most_common_cause')}
"""

    prompt += """
HARD RULES - never break these:
- Use ONLY facts from the vision data, rule engine, and what the engineer told you. Never invent defect counts, percentages, or causes not in the data.
- If the vision data above says the image is not a board (0 legs detected), state that plainly; never present a defect diagnosis or a "clean board" conclusion from that image.
- STRICT RULE - ONE QUESTION PER REPLY, NO EXCEPTIONS:
  * Your reply must contain AT MOST one question mark.
  * If you find yourself wanting to ask two things, pick the more important one and ask only that.
  * Never combine a question with a follow-up question in the same reply ("And also, could you tell me...").
  * After the engineer answers, acknowledge their answer in ONE sentence maximum, then ask the next single question.
  * Acknowledgement must be brief: "Got it." / "Understood." / "That's helpful." - never more than 5 words before the next question.
  * Do NOT summarize what the engineer said back to them before asking the next question. Just acknowledge and move on.
- Never say "Question 1 of 5" or reveal the structure explicitly.
- Keep replies concise - 2-4 sentences for discovery phase, longer for the diagnosis announcement is fine.
- If the engineer says something unexpected or off-topic, acknowledge it naturally and gently steer back to diagnosis.
- Never use markdown headers or bullet points in your reply - write in natural prose only.

OUTPUT FORMAT (strict):
Return ONLY a JSON object, no markdown, with exactly these keys:
{"reply": "<your natural-language reply, obeying every rule above>", "suggested_phase": "discovery" | "diagnosis" | "followup", "ready_for_diagnosis": true | false}
The "reply" string must be plain prose (no headings, no bullet lists)."""

    # recommended output budget per phase (enforces brevity at the model level)
    recommended_max_tokens = {
        "discovery": 150,
        "diagnosis": 400,
        "followup": 250,
    }.get(req.phase, 200)
    return prompt, recommended_max_tokens


def _extract_json(text: str):
    """Parse the model's JSON envelope, tolerating code fences and preambles."""
    cleaned = (text or "").replace("```json", "").replace("```", "").strip()
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start == -1 or end <= start:
        return None
    try:
        return json.loads(cleaned[start:end + 1])
    except json.JSONDecodeError:
        return None


def _salvage_reply(text: str) -> str:
    """Best-effort recovery of the reply when the JSON envelope is truncated."""
    cleaned = (text or "").replace("```json", "").replace("```", "").strip()
    # drop a leading prose preamble like "Here is the JSON requested:"
    brace = cleaned.find("{")
    if not cleaned.startswith("{") and brace > 0:
        cleaned = cleaned[brace:]

    # pull the "reply" string even if the closing brace/quote is missing
    m = re.search(r'"reply"\s*:\s*"', cleaned)
    if m:
        rest = cleaned[m.end():]
        out: list[str] = []
        i = 0
        while i < len(rest):
            if rest[i] == "\\" and i + 1 < len(rest):
                nxt = rest[i + 1]
                out.append({"n": "\n", "t": "\t", '"': '"', "\\": "\\"}.get(nxt, nxt))
                i += 2
                continue
            if rest[i] == '"':
                break
            out.append(rest[i])
            i += 1
        salvaged = "".join(out).strip()
        if salvaged:
            return salvaged

    # last resort: strip JSON punctuation/keys and return whatever prose remains
    stripped = re.sub(r'^[\s{]*"?[a-z_]+"?\s*:\s*"?', "", cleaned, flags=re.I)
    stripped = re.sub(r'(?i)here is the json( requested)?:?', "", stripped)
    return stripped.strip().strip('{}"').strip()


def call_gemini(req: ChatRequest) -> dict:
    """Call Gemini, trying each model in GEMINI_MODELS until one responds.

    Only genuine API errors move to the next model. Malformed/truncated JSON is
    retried once with a larger token budget and then salvaged, so a valid API
    response never degrades into the canned "trouble connecting" message.
    """
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=GEMINI_API_KEY)

    # build chat contents from recent history + the new message
    contents = []
    for msg in req.conversation_history[-CHAT_HISTORY_LIMIT:]:
        role = "model" if msg.role == "model" else "user"
        contents.append(types.Content(role=role, parts=[types.Part(text=msg.content)]))
    contents.append(types.Content(role="user", parts=[types.Part(text=req.message)]))

    system_prompt, max_tokens = build_chat_prompt(req)
    # retry budget used only when the first response is truncated/malformed
    retry_tokens = max(max_tokens, 512)

    last_error: Exception | None = None
    for model_name in GEMINI_MODELS:
        for cap in (max_tokens, retry_tokens):
            try:
                response = client.models.generate_content(
                    model=model_name,
                    contents=contents,
                    config=types.GenerateContentConfig(
                        system_instruction=system_prompt,
                        temperature=0.4,
                        max_output_tokens=cap,
                        top_p=0.9,
                        response_mime_type="application/json",
                    ),
                )
            except Exception as e:      # noqa: BLE001 - unavailable/quota/etc.
                last_error = e
                print(f"/chat model '{model_name}' failed ({e}); trying next model")
                break  # next model

            data = _extract_json(response.text or "")
            if data is not None and str(data.get("reply", "")).strip():
                return {
                    "reply": str(data["reply"]).strip(),
                    "suggested_phase": data.get("suggested_phase", req.phase),
                    "ready_for_diagnosis": bool(data.get("ready_for_diagnosis", False)),
                }

            # malformed/truncated JSON: the API call itself succeeded, so do NOT
            # treat this as a model failure - retry once with more tokens
            if cap == max_tokens:
                print(f"/chat model '{model_name}' returned truncated JSON; retrying with {retry_tokens} tokens")
                continue
            salvaged = _salvage_reply(response.text or "")
            if salvaged:
                print(f"/chat model '{model_name}' JSON unparseable; salvaged reply text")
                return {
                    "reply": salvaged,
                    "suggested_phase": req.phase,
                    "ready_for_diagnosis": False,
                }
            last_error = RuntimeError(f"model '{model_name}' returned no usable reply")
            break  # next model

    # every model in the chain failed
    raise last_error if last_error else RuntimeError("no Gemini models configured")


@app.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    """Conversational diagnosis turn backed by the Gemini API."""
    questions_asked = sum(1 for m in req.conversation_history if m.role == "user")

    if not gemini_configured():
        # frontend treats a non-200 as a failure and falls back to templates
        raise HTTPException(
            status_code=503,
            detail="GEMINI_API_KEY not set. Chat endpoint unavailable.",
        )

    try:
        result = call_gemini(req)
        return ChatResponse(
            reply=result["reply"],
            suggested_phase=result["suggested_phase"],
            questions_asked=questions_asked,
            ready_for_diagnosis=result["ready_for_diagnosis"],
        )
    except Exception as e:      # noqa: BLE001 - any SDK/parse failure
        print(f"/chat Gemini error: {e}")
        return ChatResponse(
            reply=("I'm having trouble connecting to the diagnosis engine. "
                   "Please check your API key and try again."),
            suggested_phase=req.phase,
            questions_asked=questions_asked,
            ready_for_diagnosis=False,
        )


# ---------------------------------------------------------------------------
# Static frontend mounting (production / Docker)
# ---------------------------------------------------------------------------
DIST_DIR = ROOT / "dist"
if DIST_DIR.exists():
    app.mount("/", StaticFiles(directory=str(DIST_DIR), html=True), name="static")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=PORT)
