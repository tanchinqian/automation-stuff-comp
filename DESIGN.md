---
name: DISPENSE.AI
description: AI Dispensing Defect Detective - an offline, on-device troubleshooting console for fluid-dispensing defects.
colors:
  phosphor-green: "#2ee6a8"
  phosphor-green-dim: "#1fbf89"
  warn-amber: "#ffb64d"
  danger-red: "#ff5f6d"
  chat-user-blue: "#5aa9ff"
  console-ink: "#d7dde6"
  console-ink-dim: "#8a93a6"
  console-ink-faint: "#5a6272"
  surface-0: "#07090d"
  surface-1: "#0d1016"
  surface-2: "#12161f"
  surface-3: "#1a1f2b"
  hairline: "#232a38"
  on-accent: "#06130e"
  amber-bar-deep: "#b8862f"
  danger-bar-deep: "#a93a45"
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
  sm: "4px"
  md: "8px"
  lg: "10px"
  pill: "14px"
  pill-lg: "20px"
  scene: "16px"
spacing:
  sm: "8px"
  md: "16px"
  lg: "20px"
components:
  button-primary:
    backgroundColor: "{colors.phosphor-green}"
    textColor: "#06130e"
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

# Design System: DISPENSE.AI

## Overview

**Creative North Star: "The Precision Lab Console"**

DISPENSE.AI reads as a precision laboratory instrument meets a factory HMI terminal: a near-black control surface, phosphor-green readouts, monospace numerals, and hairline separators. The density is deliberately high (a cockpit, not an airy gallery) because the visitor is an engineer scanning data under time pressure. Every element carries the language of instrumentation: crisp corners, thin borders, tabular numerals, and status conveyed through a single disciplined accent rather than decorative color.

The personality is precise and unassuming. It earns attention through density, alignment, and the confidence of a well-calibrated machine, not through flourish. The one moment of life is the phosphor-green accent that marks the active, the ranked, and the actionable. Amber and red exist strictly as semantic warning/defect states and never as decoration.

**Key Characteristics:**
- Dark charcoal surfaces with a single phosphor-green accent (plus amber/danger reserved for semantic states).
- Monospace for numerals, labels, and panel titles; sans-serif for body and descriptions.
- Dense, cockpit-grade spacing with hairline separators and tight, precise cards.
- Instrument markers: corner ticks, scanline texture, cause-tree visuals, tabular numerals.

## Colors

A restrained dark palette with one dominant phosphor-green accent. Color is a signal, not decoration: the accent marks the active, ranked, and actionable; amber and red are semantic only.

### Primary
- **Phosphor Green** (#2ee6a8): the single accent. Active states, primary CTAs, ranked-cause bars, selected chips, confidence values, the brand mark. Used sparingly so it stays meaningful.
- **Phosphor Green Dim** (#1fbf89): hover states and secondary accent on the primary green, e.g. `.bar-fill` gradients and `:hover` borders.
- **On Accent** (#06130e): the dark text on phosphor-green-filled buttons and labels, so the accent CTA stays readable (WCAG AA).

### Secondary (semantic, reserved)
- **Warn Amber** (#ffb64d): warnings and mid-confidence indicators (reasoning callouts, mid-range bars, status warnings).
- **Danger Red** (#ff5f6d): defect/error states and high-confidence-of-problem bars (missing-dot detections).
- **Chat User Blue** (#5aa9ff): reserved exclusively for the user's chat bubbles/avatar so assistant (green) vs user (blue) is always clear. It is a muted secondary, never a page accent.
- **Amber Bar Deep** (#b8862f) and **Danger Bar Deep** (#a93a45): the deeper end of the amber/red gradient fills on confidence bars, for legibility of the fill against the track.

### Neutral
- **Console Ink** (#d7dde6): primary text.
- **Console Ink Dim** (#8a93a6): secondary text and descriptions.
- **Console Ink Faint** (#5a6272): hints, captions, placeholders.
- **Surface 0/1/2/3** (#07090d / #0d1016 / #12161f / #1a1f2b): the page background through elevated surfaces.
- **Hairline** (#232a38): borders and separators.

### Named Rules
**The One Voice Rule.** The phosphor-green accent is the only page accent. Amber and red are used only to carry semantic status (warning, defect, danger); blue only for the user chat. Any new color must earn a semantic role before it may appear.

## Typography

**Display / Label / Mono Font:** JetBrains Mono (fallback Cascadia Mono, Consolas)
**Body Font:** Inter (fallback Segoe UI, system-ui)
**Label/Mono Font:** JetBrains Mono

**Character:** Monospace carries the instrument language (labels, panel titles, numerals, status); the sans-serif body keeps descriptions readable at density. Uppercase mono labels are the signposting voice of the console.

### Hierarchy
- **Display / Score** (700, mono, 40px): the big quality-score readout.
- **Hero Title** (600, 21px): the identified-defect heading.
- **Headline** (600, 17px): panel/dialog titles.
- **Title** (600, 15px): question text and hero headings.
- **Body** (400, 14px, line-height 1.5): descriptions, reasoning, action detail. ~65ch max.
- **Small Body** (400, 13px / 13.5px): chat bubbles, bar names, reasoning text.
- **Label** (mono, 11px, uppercase, tracking 0.08em): section labels, chip text, status chips.
- **Micro Label** (mono, 10px / 10.5px): category tags, footnote-style labels.
- **Numerals** (mono, tabular-nums): every number display (percentages, scores, metrics) uses tabular figures so columns align.

Type ramp used across the system (px): 10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 15, 16, 17, 19, 21, 24, 34, 40.

### Named Rules
**The Tabular Rule.** All numeric readouts set `font-variant-numeric: tabular-nums` so values align in columns and feel like instrument readouts.

## Layout

- Max-width container `1380px`, centered, with `20px 24px` page padding.
- Workbench uses a two-column grid: main column (`minmax(0,1fr)`) and a fixed `380px` sticky chat sidebar. Stacks to a single column below `980px`.
- Panels within the main column stack with an `18px` gap (`.main-col`).
- Gap rhythm: `8 / 16 / 18 / 20px`. Panel body padding `16px`; section labels use mono uppercase.
- High density by default: tight paddings, hairline separators, tabular data. Not an airy layout.

## Elevation & Depth

The system is flat and tonal: depth comes from surface lightness steps and hairline borders, not drop shadows. There are no decorative box-shadows; the only glow (`--glow`) is a subtle phosphor-green halo reserved for the active/selected state and the brand mark, kept low-opacity (0.16).

### Named Rules
**The Flat-By-Default Rule.** Surfaces are flat and separated by tone and hairline borders. The phosphor glow appears only as a state response (active, selected, hover), never as ambient decoration.

## Shapes

The form language is precise and industrial: a radius scale of `2 / 4 / 6 / 8 / 10px`, with `10px` for panels, `8px` for buttons, chips, inputs, and cards, `6px` for small elements, and `4px` for tiny markers and bar tracks. Corners are gently curved but never pill-like for containers. Full pills are reserved only for small status badges (`14px`/`20px`) and scene chips (`16px`) where a pill reads as a control, not a surface. Interactive elements get a tactile press (translateY + slight scale) on `:active`.

## Components

### Buttons
- **Shape:** gently curved (8px), 1px hairline border.
- **Primary:** phosphor-green background, dark text (#06130e), bold mono label. Hover adds the phosphor glow + slight brighten.
- **Default:** surface-3 background, console-ink text. Hover shifts border to phosphor-green-dim and text to phosphor-green.
- **Ghost:** transparent background, no fill. `:active` presses down (translateY(1px) scale(0.99)).

### Chips (question options + scene picker)
- **Style:** surface-2 background, dim text, 1px hairline border, mono label.
- **State:** selected = phosphor-green border + green text + subtle green fill + low glow; unselected = dim. `:active` presses down.

### Panels / Cards
- **Corner Style:** 10px radius.
- **Background:** surface-1 with a subtle scanline texture overlay (`.panel::before`, pointer-events none).
- **Border:** 1px hairline.
- **Head:** surface-2 background, hairline bottom border, mono uppercase title, and a rotated-square corner tick.
- **Internal Padding:** 16px.

### Inputs / Fields
- **Style:** surface-2 background, 1px hairline border, 8px radius, mono text.
- **Focus:** accent border + soft green ring (`box-shadow: 0 0 0 2px rgba(46,230,168,0.35)`), no default outline.
- **Placeholder:** console-ink-faint, ends with ellipsis `…`.

### Navigation (top tab bar)
- **Style:** mono 12px tabs in the sticky top bar; inactive = dim, active = phosphor-green with a 2px bottom accent underline. Height ~64px, one line at desktop. Uses ARIA tab semantics.

### Signature Component: The Cause Tree
The ranked-diagnosis visual: each possible cause is a horizontal bar whose width encodes likelihood, colored by confidence band (green → amber → red), with a mono percentage. Below it, a cause-tree list ties each cause to its category. This is the signature "explainable AI" moment and must stay data-first: numbers in tabular mono, bars animating via `transform: scaleX` (not width).

## Do's and Don'ts

### Do:
- **Do** keep phosphor-green as the single accent; use amber/red only for semantic status and blue only for the user chat.
- **Do** set every numeric readout in mono with `tabular-nums`.
- **Do** animate bars and reveals with `transform`/`opacity` only (scaleX), and honor `prefers-reduced-motion`.
- **Do** show visible `:focus-visible` rings on all interactive controls.
- **Do** keep the flat, tonal, hairline-separated surface model; no decorative drop shadows.

### Don't:
- **Don't** add a second accent color or neon glows; the phosphor green is the whole palette's voice.
- **Don't** animate `width`/`height` (layout thrash); use transform.
- **Don't** use thick colored side-borders on cards or bubbles (reads as an AI tell); use tinted backgrounds and full hairlines instead.
- **Don't** switch themes between sections; the page is dark-mode-only and locked.
- **Don't** hide focus outlines or ship pill-shaped containers for standard cards.
