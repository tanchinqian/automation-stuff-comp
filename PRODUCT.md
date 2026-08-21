# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary users are dispensing-line operators and process engineers in electronics / semiconductor manufacturing.

- New or less-experienced technicians and operators need guided troubleshooting when a dispensing defect appears (what went wrong, what to check first).
- Experienced process engineers want faster preliminary diagnosis and structured, evidence-backed analysis plus a shareable report before deeper investigation.

## Product Purpose

DISPENSE.AI (AI Dispensing Defect Detective) helps manufacturers identify and diagnose fluid-dispensing problems faster. The user describes or uploads a dispensing problem, the assistant asks targeted questions, identifies the likely defect, ranks possible causes with confidence and reasoning, recommends a logical troubleshooting sequence, and generates a report. It is a preliminary troubleshooting aid, not a replacement for engineers.

Success means an operator reaches a confident, correct first troubleshooting step in less time than an unassisted or experience-dependent workflow.

## Positioning

A combined, transparent engine: a domain-grounded dispensing failure-mode knowledge base drives explainable rule-and-evidence scoring, paired with classical computer-vision image analysis and a case-based learning database. The whole system runs entirely on-device in the browser with no cloud dependency, and every ranking is traceable to the symptom evidence and prior cases that produced it. A generic chatbot or a cloud API wrapper cannot truthfully claim this offline, explainable, learning pipeline.

## Operating Context

- Used on a shop floor or demo station in a browser, fully offline-capable (no API keys, no server).
- Workflows: describe a problem (5 smart intake questions + dynamic follow-ups, or free text parsed by layered on-device NLU); optionally inspect a dispensing image via a classical CV pipeline; review the ranked causes and reasoning; follow the recommended action plan; feed back which cause actually fixed the issue.
- Learning database persists locally (IndexedDB) and updates cause priors from resolved cases.
- A troubleshooting report can be generated as an on-device PDF (problem, defect, analysis, causes, confidence, actions, engineer notes).
- Live Inspection mode supports a webcam and synthetic simulator now; an ESP32-CAM stream is a stubbed placeholder.

## Capabilities and Constraints

- Capabilities: 5 smart questions + dynamic follow-ups; defect identification with confidence; ranked causes with likelihood bars and explained reasoning; troubleshooting action plan; classical CV image analysis (Otsu threshold, connected components) + synthetic defect generator + photo upload; dispensing quality score (shape/size/position/defect-risk to /100); IndexedDB learning database with case-based priors and seed demo data; on-device PDF report; live inspection (simulator + webcam + ESP32 stub).
- NLU is a layered fallback: Chrome Gemini Nano, then an on-device model (transformers.js), then an embedded keyword engine. It always works offline; the model download needs internet once.
- Constraints: vanilla TypeScript + Vite, no framework; client-only, no server. ESP32-CAM live-stream wiring is not yet implemented (placeholder in src/live/esp32.ts). Serving over http (not https) is required to reach a local ESP32 stream (mixed-content).
- Undecided: none material.

## Brand Commitments

- Name: DISPENSE.AI (AI Dispensing Defect Detective).
- Voice: instrument-grade, precise, engineering-neutral; concise labels and status text.
- Visual identity constraint (established): a dark industrial lab-console aesthetic with a single phosphor-green accent, amber/danger reserved for semantic status.

## Evidence on Hand

- The project spec: `NSW Automation .md` (AI Horizon Solution Challenge 2026), including the defect/cause/confidence examples the engine mirrors.
- A seeded demo history of 27 realistic troubleshooting cases in `src/db/caseDB.ts`.
- Real engine test coverage in `engine.test.ts` (diagnosis scenario, NLU heuristics, quality scoring).
- No fabricated customer testimonials, benchmarks, or press exist; future work must not fabricate them.

## Product Principles

1. The engine is transparent: every ranking must be explainable from the symptom evidence and prior cases that produced it.
2. On-device and offline-first: no cloud dependency for core analysis, learning, or reporting.
3. Domain grounding over generic chat: the knowledge base and CV pipeline encode real dispensing failure modes.
4. Assist, do not replace: the assistant shortens preliminary troubleshooting, never overrides the engineer's judgment.
5. The system learns: resolved cases update priors so it improves with each use.

## Accessibility & Inclusion

The UI targets WCAG AA contrast and keyboard operability on a desktop browser (focus-visible rings, ARIA tab/panel semantics, aria-live for async updates, reduced-motion support). No additional product-specific accessibility requirement was established.
