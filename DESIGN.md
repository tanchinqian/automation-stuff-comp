---
name: PasteTrace
description: An offline, on-device troubleshooting console for fluid-dispensing defects.
colors:
  # Dark mode (default)
  steel-blue: "#4a7a9e"
  steel-blue-dim: "#3c6480"
  on-brand: "#0a0f14"
  status-good: "#5a9e6f"
  status-warn: "#ffb64d"
  status-fail: "#ff5f6d"
  chat-user-blue: "#5aa9ff"
  console-ink: "#d7dde6"
  console-ink-dim: "#8a93a6"
  console-ink-faint: "#5a6272"
  surface-0: "#07090d"
  surface-1: "#0d1016"
  surface-2: "#12161f"
  surface-3: "#1a1f2b"
  hairline: "#232a38"
  hairline-soft: "#1a202b"
  data-viz-1: "#35586f"
  data-viz-2: "#4a7a9e"
  data-viz-3: "#6f9fc0"
  data-viz-4: "#9dc0d8"
  # Light mode
  light-surface-0: "#eceff2"
  light-surface-1: "#f6f8fa"
  light-surface-2: "#ffffff"
  light-surface-3: "#e2e7ec"
  light-hairline: "#c6cfd8"
  light-hairline-soft: "#dbe1e7"
  light-ink: "#1b222a"
  light-ink-dim: "#4c5864"
  light-ink-faint: "#78848f"
  light-brand: "#33627f"
  light-brand-dim: "#2a5069"
  light-on-brand: "#ffffff"
  light-status-good: "#2f7d4f"
  light-status-warn: "#8a5a00"
  light-status-fail: "#b3202c"
  light-chat-user: "#2f6fbf"
  light-data-viz-1: "#24455c"
  light-data-viz-2: "#33627f"
  light-data-viz-3: "#4f80a0"
  light-data-viz-4: "#7ba6bf"
typography:
  display:
    fontFamily: "'JetBrains Mono', 'Cascadia Mono', Consolas, monospace"
    fontWeight: 700
    letterSpacing: "0.1em"
  score:
    fontFamily: "'JetBrains Mono', 'Cascadia Mono', Consolas, monospace"
    fontSize: "40px"
    fontWeight: 700
  hero-title:
    fontFamily: "'JetBrains Mono', 'Cascadia Mono', Consolas, monospace"
    fontSize: "21px"
    fontWeight: 600
  hero-title-lg:
    fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 600
  headline:
    fontFamily: "'JetBrains Mono', 'Cascadia Mono', Consolas, monospace"
    fontSize: "17px"
    fontWeight: 600
  title:
    fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
  body:
    fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif"
    fontSize: "14px"
    lineHeight: 1.5
  small-body:
    fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif"
    fontSize: "13px"
  label:
    fontFamily: "'JetBrains Mono', 'Cascadia Mono', Consolas, monospace"
    fontSize: "11px"
    letterSpacing: "0.08em"
    textTransform: "uppercase"
  micro-label:
    fontFamily: "'JetBrains Mono', 'Cascadia Mono', Consolas, monospace"
    fontSize: "10px"
  control-label:
    fontFamily: "'JetBrains Mono', 'Cascadia Mono', Consolas, monospace"
    fontSize: "12px"
  question:
    fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
  stat:
    fontFamily: "'JetBrains Mono', 'Cascadia Mono', Consolas, monospace"
    fontSize: "19px"
    fontWeight: 700
  empty-state:
    fontFamily: "'JetBrains Mono', 'Cascadia Mono', Consolas, monospace"
    fontSize: "34px"
rounded:
  xs: "2px"
  sm: "3px"
  md: "4px"
  lg: "4px"
spacing:
  sm: "8px"
  md: "16px"
  lg: "20px"
components:
  button-primary:
    backgroundColor: "{colors.steel-blue}"
    textColor: "{colors.on-brand}"
    rounded: "{rounded.md}"
    padding: "9px 16px"
  button-default:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.console-ink}"
    rounded: "{rounded.md}"
    padding: "9px 16px"
  panel:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.console-ink}"
    rounded: "{rounded.lg}"
  option-chip:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.console-ink-dim}"
    rounded: "{rounded.md}"
    padding: "9px 13px"
---

# Design System: PasteTrace

## Overview

**Creative North Star: "The Precision Lab Console"**

PasteTrace reads as a precision laboratory instrument meets a factory HMI terminal: a dark control surface by default (with a light mode of the same identity), muted steel-blue accents, monospace data, and hairline separators. Density is deliberately high (a cockpit, not an airy gallery) because the user is an engineer scanning data under time pressure. Every element carries the language of instrumentation: sharp corners, thin borders, tabular numerals, and status conveyed through disciplined semantic color rather than decoration.

The personality is precise and unassuming. It earns attention through density, alignment, and the confidence of a well-calibrated machine, not through flourish.

**Key Characteristics:**
- Two modes of one identity: Steel Blue dark (default) and Steel Blue light, toggled once for the whole console.
- One accent (steel blue) for brand and interactive controls; amber/red/green reserved for semantic status; a separate data-viz ramp for charts.
- Monospace for numerals, labels, IDs, and technical values; sans-serif for body and section titles.
- Flat, hairline-separated surfaces; no decorative shadows or neon glows.
- Sharp 2-4px corners; status badges are flat rectangles, not pills.

## Colors

Color is roles first. A hue earns its place by doing one job:
- `--brand` / `--brand-dim` / `--brand-tint` / `--on-brand`: buttons, active tab, links, focus rings, selected chips. Never status.
- `--status-good` / `--status-warn` / `--status-fail`: pass/good/confirmed/resolved; warnings; failures/defects. Nothing else.
- `--data-viz-1..4`: cause bars, quality stars, the Related-cases timeline, progress meters. Charts are data, not brand, and not status.
- Neutrals (`--bg-0..3`, `--line`, `--line-soft`, `--ink`, `--ink-dim`, `--ink-faint`): surfaces, borders, text.
- `--chat-user`: the user's chat bubble/avatar only.

### Dark mode (default)
- **Steel Blue** (#4a7a9e) - brand/interactive; dim #3c6480; tint rgba(74,122,158,0.12); `--on-brand` #0a0f14.
- **Status** good #5a9e6f, warn #ffb64d, fail #ff5f6d.
- **Ink** #d7dde6 / #8a93a6 / #5a6272.
- **Surfaces** #07090d / #0d1016 / #12161f / #1a1f2b; hairlines #232a38 / #1a202b.
- **Data-viz** #35586f, #4a7a9e, #6f9fc0, #9dc0d8 (deep to bright).
- **Chat user** #5aa9ff.

### Light mode
Same roles, inverted surfaces, status hues darkened for legibility on light backgrounds. Applied with `data-mode="light"` on the root element (persisted, set by the topbar toggle).
- **Light brand** #33627f, dim #2a5069, `--on-brand` #ffffff.
- **Light status** good #2f7d4f, warn #8a5a00, fail #b3202c.
- **Light ink** #1b222a / #4c5864 / #78848f.
- **Light surfaces** #eceff2 / #f6f8fa / #ffffff / #e2e7ec; hairlines #c6cfd8 / #dbe1e7.
- **Light data-viz** #24455c, #33627f, #4f80a0, #7ba6bf.
- **Light chat user** #2f6fbf.
- **Scrims** (`--scrim`, `--scrim-soft`) darken the page behind modal and drawer overlays in both modes.

### Named Rules
**The One Voice Rule.** One accent carries brand and interaction. Amber, red, and green exist only as semantic status; blue only as the user-chat tint. Any new color must earn a semantic role before it may appear.

**The Role Separation Rule.** A long, high-scoring cause bar is not "good": charts use `--data-viz-*`, never `--status-good` or `--brand`.

## Typography

**Mono:** JetBrains Mono (fallback Cascadia Mono, Consolas) for numerals, labels, panel titles, IDs, timestamps, percentages, and technical values.
**Sans:** Inter (fallback Segoe UI, system-ui) for body prose and section titles.

**Character:** monospace carries the instrument language; the sans-serif keeps prose readable at density. Section headers are sentence-case sans; mono is reserved for genuinely technical content.

### Hierarchy
- **Display / Score** (700, mono, 40px): the big quality-score readout.
- **Hero Title** (600, sans, 24px): the identified-defect heading.
- **Headline** (600, 17px): panel/dialog titles.
- **Title** (600, 15px): question text and hero headings.
- **Body** (400, 14px, line-height 1.5): descriptions, reasoning, action detail. ~65ch max.
- **Small Body** (400, 13px / 13.5px): chat bubbles, bar names, reasoning text.
- **Label** (mono, 11px, uppercase, tracking 0.08em): section labels, chip text, status chips.
- **Micro Label** (mono, 10px / 10.5px): category tags, footnote labels.
- **Numerals** (mono, tabular-nums): every number display uses tabular figures so columns align.

Type ramp used across the system (px): 10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 15, 16, 17, 19, 21, 24, 34, 40.

### Named Rules
**The Tabular Rule.** All numeric readouts set `font-variant-numeric: tabular-nums` so values align in columns and feel like instrument readouts.

**The Two-Font Rule.** Mono only where the content is data or instrumentation (IDs, counts, timestamps, technical labels). Section titles, prose, and buttons' descriptive text use the sans face.

## Layout

- Two top-level tabs: `01 WORKBENCH`, `02 LEARNING DB`.
- Workbench has a sticky sub-tab strip directly under the sticky topbar: `Inspect & Diagnose` | `Report`. Panes are shown/hidden only, so state survives switching.
- `Inspect & Diagnose` is a single full-width column (max `1440px`) stacking Image Inspection and Diagnosis.
- The Assistant is an overlay drawer (fixed right, `min(420px, 100vw)`) with a dimming backdrop; it never occupies layout space. Open via the topbar toggle, close via backdrop, Escape, toggle, or its close button.
- Report and Learning DB use the standard `1380px` centered layout with `20px 24px` page padding.
- Everything collapses to one column below `980px`; the drawer goes full width below `640px`.
- Gap rhythm: `8 / 16 / 18 / 20px`; panel body padding `16px`.

## Elevation & Depth

The system is flat and tonal: depth comes from surface lightness steps and hairline borders, not drop shadows. There is no decorative glow; hover, active, and selected states are communicated with border color, text color, and low-opacity tints.

### Named Rules
**The Flat-By-Default Rule.** Surfaces are flat and separated by tone and hairlines. Colored side-borders, ambient glows, and drop shadows are not part of the language.

## Shapes

Radius scale is sharp and industrial: `2 / 3 / 4 / 4px` (`--r-2..--r-5`), used for panels, buttons, chips, inputs, and cards. Circles are reserved for genuinely round markers (status LEDs, timeline nodes). Interactive elements get a tactile press (`translateY(1px) scale(0.99)`) on `:active`.

## Components

### Buttons
- **Shape:** 4px radius, 1px hairline border, mono label.
- **Primary:** brand fill, `--on-brand` text, bold. Hover brightens slightly.
- **Default:** `--bg-3` fill, `--ink` text. Hover shifts border and text to brand.
- **Ghost:** transparent fill; `:active` presses down.

### Chips and status badges
- **Question/scene chips:** `--bg-2`/`--bg-3` fill, dim text, hairline, 2-3px corners (rectangular, not pills).
- **Selected:** brand border + brand text + brand tint.
- **Source badges (Learning DB):** flat 2px uppercase mono tags with a tooltip stating exactly what the tag means (Local only / Server only / Synced).

### Panels / Cards
- **Corner Style:** 4px radius.
- **Background:** `--bg-1`, 1px hairline, no texture overlay.
- **Head:** `--bg-2`, hairline bottom, a flat 6x6 brand marker (not a glyph), sentence-case sans title.
- **Internal Padding:** 16px.

### Collapsible sections (Diagnosis)
Flat header bar (`--bg-2`, hover `--bg-3`) with a rotating SVG chevron, a mono count badge, and a `grid-template-rows: 0fr -> 1fr` reveal (~220ms). Expansion state is per session.

### Inputs / Fields
- **Style:** `--bg-2` fill, 1px hairline, 4px radius, mono text.
- **Focus:** brand border + soft brand ring (`box-shadow: 0 0 0 2px var(--brand-glow)`), no default outline.
- **Placeholder:** `--ink-faint`.

### Navigation
- **Top bar:** sticky, `--bg-1`, hairline bottom; mono 12px tabs, active tab gets brand text plus a 2px brand underline. Holds the mode toggle and the Assistant toggle on the right.
- **Sub-tabs:** sticky below the topbar (offset via the measured `--topbar-h`), sans 12.5px, active underline in brand, `--bg-0` background so content scrolls beneath.

### Signature components
- **Cause bars:** horizontal likelihood bars using the `--data-viz` ramp (deep to bright as confidence rises), mono percentage, animating via `transform: scaleX` (never width).
- **Quality stars:** `--data-viz-2` stars plus an auto-scaled `/5` readout per metric.
- **Related-cases timeline:** a proportional real-date rail with clickable nodes; brand fill for cases confirmed as the current top cause, `--bg-3` with a hairline for the rest.

## Do's and Don'ts

### Do:
- **Do** keep a single accent for brand/interactive; use status hues only for status and the `--data-viz` ramp for charts.
- **Do** set every numeric readout in mono with `tabular-nums`.
- **Do** animate `transform`/`opacity` only (e.g. `scaleX` bars), and honor `prefers-reduced-motion`.
- **Do** show visible `:focus-visible` rings on all interactive controls.
- **Do** keep the flat, tonal, hairline-separated surface model; separation comes from tone and borders.
- **Do** keep text and borders inside the documented tokens and scales.

### Don't:
- **Don't** add a second accent, neon glows, gradients, or decorative drop shadows.
- **Don't** animate `width`/`height` (layout thrash); use transforms.
- **Don't** use thick colored side-borders on cards or bubbles; use tinted backgrounds and full hairlines.
- **Don't** switch palettes per section; light and dark are two modes of the same Steel Blue system, toggled once for the whole console.
- **Don't** use mono for section titles or body prose.
- **Don't** hide focus outlines, ship pill-shaped containers for cards, or use em-dashes in visible copy.
