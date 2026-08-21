# AGENTS.md

Guidance for AI agents working on this repository. Read this before making any change, especially UI/design work.

## Project overview

**DISPENSE.AI** (AI Dispensing Defect Detective) is a fully offline, on-device AI troubleshooting console for fluid-dispensing defects in electronics / semiconductor manufacturing.

- Stack: **Vite + TypeScript**, vanilla DOM (no framework), client-only, no server.
- Product truth: read `PRODUCT.md`.
- Design system (the canonical visual authority): read `DESIGN.md` and `.impeccable/design.json`.
- Live on-device NLU: Chrome Gemini Nano -> on-device model (transformers.js) -> embedded keyword engine. Always works offline.
- Architecture map:
  - `src/engine/` knowledge base, evidence scoring, question flow, action plan
  - `src/vision/` computer-vision pipeline, synthetic defect generator, quality score
  - `src/nlu/` layered offline LLM router
  - `src/db/` IndexedDB learning database + case-based priors
  - `src/report/` on-device PDF report generator
  - `src/ui/` UI modules (workbench, live, learning DB, report)
  - `src/live/` ESP32-CAM live-stream wiring point (placeholder)

## Commands

- `npm run dev` - start dev server (http://localhost:5173)
- `npm run build` - typecheck (`tsc`) + production build (`vite build`)
- `npm test` - engine + quality-score sanity checks
- `node .agents/skills/impeccable/scripts/detect.mjs <files>` - design anti-pattern / drift detector

Only commit when the user explicitly asks.

## Design mandate (anti-AI, anti-slop)

This project's visual identity is **"The Precision Lab Console"** - a dark industrial instrument, NOT a generic AI-chatbot aesthetic. Future design changes MUST reflect this.

### Always load the design skills before designing or changing UI

1. **`impeccable`** (`.agents/skills/impeccable`) - the primary authority. Follow `DESIGN.md` tokens exactly. Run its detector after any UI edit.
2. **`design-taste-frontend`** (`.agents/skills/design-taste-frontend`) - secondary anti-slop audit, especially for any new surface (pages, panels, flows).

### Declare a Design Read before new UI

State the design read and dials (variance / motion / density) before generating any new surface. This product is an **Operate**-mode tool: scanability, consistency, and data density outrank expression. Defaults: `VARIANCE 6 / MOTION 4 / DENSITY 8` (cockpit).

### Hard AI-tell bans (do not violate)

- **One accent color only** - phosphor-green (`#2ee6a8`). Amber/red are semantic status only (warning/defect/danger); blue is reserved for the user chat. No new accent colors without a documented semantic role in `DESIGN.md`.
- **No AI-purple gradients**, no neon glows beyond the low-opacity phosphor halo (`--glow`), no pure black (use the documented surface scale).
- **No Inter as the default display font** - the mono (JetBrains Mono) carries the instrument language; sans (Inter) is body-only.
- **No thick colored side-borders** on cards, bubbles, or boxes (reads as an AI tell). Use tinted backgrounds + full hairlines.
- **No em-dashes (`—` / `–`)** anywhere visible. Use hyphens, periods, or commas.
- **No `transition: all`** - list properties explicitly. Animate `transform`/`opacity` only, never `width`/`height` (use `transform: scaleX` for bars).
- **`font-variant-numeric: tabular-nums`** on every numeric readout (percentages, scores, metrics).
- **Dark-mode locked** - no light sections. Honor `prefers-reduced-motion`.
- **Visible `:focus-visible` rings** on all interactive controls; no removed focus outlines.
- **Stay within the documented scales** - any color, radius, or font-size outside `DESIGN.md`'s tokens is drift; add it to the design system before using it.

### Verification gate (required before a UI task is "done")

1. Run `node .agents/skills/impeccable/scripts/detect.mjs <changed files>` - must report **zero** findings.
2. Run `npm run build` and `npm test` - must pass.
3. Manually confirm no AI tells from the ban list above.

Do not declare a design task complete until all three pass.
