# 10-Minute Master Presentation Script: PasteTrace
**Competition:** NSW Automation — AI Horizon Solution Challenge 2026  
**Team:** Team Amaterasu  
**Project:** PasteTrace — The AI Dispensing Defect Detective  
**Tagline:** *Helping Manufacturers Identify Dispensing Problems Faster with AI*  
**Total Target Video Duration:** Under 10:00 (Calibrated for ~9:45)

---

## Overall Timing & Structure (Under 10 Minutes)

| Section | Slide / Topic | Target Duration | Timestamp |
| :--- | :--- | :--- | :--- |
| **Preamble & Hook** | Slide 1: Introduction & Vision | 25s | `0:00 – 0:25` |
| **Problem Context** | Slide 2: The Micro-Dispensing Bottleneck | 55s | `0:25 – 1:20` |
| **The Paradigm Shift** | Slide 3: Trial & Error vs. PasteTrace | 55s | `1:20 – 2:15` |
| **Solution Overview** | Slide 4: See. Ask. Reason. Act. | 60s | `2:15 – 3:15` |
| **System Architecture** | Slide 5: The 4-Step Edge Pipeline | 75s | `3:15 – 4:30` |
| **Design Rationale** | Slide 6: Why This Approach? (Explainability, Edge, Memory) | 65s | `4:30 – 5:35` |
| **Technical Validation**| Slide 7: Validation, Accuracy & Benchmarking | 60s | `5:35 – 6:35` |
| **Enterprise Impact** | Slide 8: Shop-Floor ROI & Implementation | 50s | `6:35 – 7:25` |
| **Live Demonstration** | Slide 9: LIVE SYSTEM DEMO (Full 5-Act Walkthrough) | 2m 10s | `7:25 – 9:35` |
| **Final Wrap-Up** | Slide 10: Summary & Closing Remarks | 25s | `9:35 – 10:00` |

---

## Master Presentation Script

### SLIDE 1 — PasteTrace: The Defect Detective
**Timestamp:** `[0:00 – 0:25]` (25 seconds)

Good day everyone. We are Team Amaterasu, and today we are proud to present **PasteTrace**, our AI Dispensing Defect Detective, developed for the AI Horizon Solution Challenge 2026 in partnership with NSW Automation.

Our mission is straightforward: instead of forcing manufacturing engineers and operators to spend valuable production hours guessing why a fluid dispensing defect occurred, PasteTrace identifies the true root cause within milliseconds, explains its reasoning, and prescribes immediate corrective actions.

Our goal is never to replace the engineer. It is to equip shop-floor teams with an intelligent diagnostic assistant that makes troubleshooting **faster, consistent, and strictly evidence-guided.**

---

### SLIDE 2 — The Micro-Dispensing Bottleneck
**Timestamp:** `[0:25 – 1:20]` (55 seconds)

In semiconductor packaging and precision electronics assembly, fluid dispensing—whether applying solder paste, epoxy, underfill, or conformal coating—is mission-critical. Even a microscopic defect can shut down an entire surface-mount production line.

When a defect appears—such as insufficient volume, pin bridging, missing dots, or irregular spreading—operators face an immediate dilemma:

**What actually caused it?**

- Was it a partial nozzle clog?
- Did fluid viscosity drift due to ambient pot life?
- Did pneumatic dispensing pressure fluctuate?
- Or did the z-height standoff change?

Here lies the fundamental industrial bottleneck: **multiple distinct mechanical and fluid-dynamic causes produce visually identical symptoms.**

Today, resolving these defects relies almost entirely on the tribal knowledge of veteran engineers. When junior operators are on shift, troubleshooting degenerates into a frustrating cycle of swapping needles, adjusting regulators, purging fluid, and running test boards. 

Every unnecessary trial costs thousands of dollars in line downtime and scrap. The real challenge is therefore not just *seeing* the defect—it is minimizing the critical time between **detecting the anomaly and taking the correct physical action.**

---

### SLIDE 3 — Trial & Error vs. PasteTrace
**Timestamp:** `[1:20 – 2:15]` (55 seconds)

This is where PasteTrace fundamentally transforms factory operations.

Under the conventional approach, lines suffer what we call **"45 minutes of guesswork."** 

An operator spots an abnormal dispense and enters an unguided trial-and-error loop:
- *"Is it nozzle clogging?"* — They disassemble the dispense head.
- *"Is it pressure?"* — They tweak the pneumatic valve.
- *"Is the material bad?"* — They scrap an entire syringe.

Components are swapped and machine parameters are altered without verification while the line sits idle.

With PasteTrace, this workflow is replaced by structured precision. 

By combining optical defect analysis with **five targeted diagnostic questions**, the system evaluates the complete symptom matrix against validated fluid-dispensing physics.

In our benchmark tests, our diagnostic scoring engine computes the root-cause ranking in just **0.17 milliseconds**—running fully on-device.

Instead of testing possibilities blindly, the technician receives a ranked, evidence-weighted roadmap with explicit engineering reasoning. We transition manufacturing:

**From trial-and-error guesswork to evidence-guided troubleshooting.**

---

### SLIDE 4 — Our Solution: See. Ask. Reason. Act.
**Timestamp:** `[2:15 – 3:15]` (60 seconds)

Our solution architecture can be summarized in four distinct pillars:

**See. Ask. Reason. Act.**

1. **See (Optical Intake):**  
   Using an on-station USB inspection camera or ESP32-CAM stream, the system captures the dispensed board. A dual-stage vision model localizes individual IC pins, evaluates geometry, and flags defects like bridging or less-paste with an objective /100 Quality Score.

2. **Ask (Dynamic Smart Triage):**  
   Visuals only tell half the story. The system deploys targeted intake questions—such as whether the defect is continuous or intermittent, or if a material batch just changed—using layered on-device Natural Language Understanding.

3. **Reason (Physics-Grounded Diagnosis):**  
   The system fuses visual detections and operator responses through a deterministic, explainable rule engine. Instead of a vague black-box answer, it outputs ranked root causes with percentage likelihoods and transparent explanations of *why* each cause was prioritized.

4. **Act (Containment & 8D Documentation):**  
   Finally, PasteTrace provides a prioritized containment sequence—telling the operator exactly what to inspect first. It then auto-populates an industrial **8D NCR Report** complete with embedded defect photos, streamlining quality compliance.

---

### SLIDE 5 — The 4-Step Edge Pipeline Architecture
**Timestamp:** `[3:15 – 4:30]` (75 seconds)

Under the hood, PasteTrace is engineered as an industrial-grade edge pipeline built for maximum reliability:

- **Step 1 — Dual-Stage Optical Intake:**  
  The system feeds inspection imagery into a trained **YOLOv8s detector** to locate all component leads, followed by a **MobileNetV2 crop classifier** that categorizes each lead into *Good, Less Paste, or Bridging*. To guarantee 100% uptime, an on-device ONNX Web Runtime with a classical CV fallback ensures full vision capability even if the local server is completely offline.

- **Step 2 — Dynamic Smart Triage & On-Device NLU:**  
  When an operator describes symptoms in plain text, our layered NLU router—utilizing on-device models and keyword heuristics—extracts precise symptom tags without sending sensitive factory data to external cloud servers.

- **Step 3 — Deterministic Scorer & Bayesian Priors:**  
  This is the reasoning core. Symptom vectors pass through an evidence-weighted failure mode matrix. This rule engine is mathematically combined with historical priors stored in a local **IndexedDB case database**, allowing the system's accuracy to sharpen as real cases are logged.

- **Step 4 — Automated 8D Quality Reporting:**  
  Once a diagnosis is reached and containment actions are assigned, the system compiles an audit-ready **8D Non-Conformance Report (NCR)**, ready for instant PDF export with embedded high-resolution bounding boxes and engineer sign-offs.

PasteTrace connects observation, reasoning, physical containment, and enterprise documentation into a single seamless loop.

---

### SLIDE 6 — Why This Approach? (Engineering Rationale)
**Timestamp:** `[4:30 – 5:35]` (65 seconds)

Why did we choose this architectural philosophy over a standard cloud LLM chatbot? Three reasons:

First, **Absolute Explainability**.  
In high-reliability electronics manufacturing, an engineer cannot act on a hallucinated black-box response. PasteTrace provides mathematical traceability: every score is backed by visible symptom evidence and clear physical rationale—explaining, for instance, that air entrapment is ranked higher than nozzle wear because the defect occurs intermittently across random pads.

Second, **Air-Gapped Edge Processing**.  
Semiconductor and PCB manufacturing environments maintain strict security protocols. Component placements, die layouts, and proprietary fluid dispensing formulations cannot be transmitted to public cloud APIs. PasteTrace operates 100% on-device on the shop floor, eliminating data leakage vulnerabilities.

Third, **Institutional Knowledge Retention**.  
When an experienced senior engineer solves an intricate dispensing issue, that insight often leaves when their shift ends. PasteTrace incorporates a closed-loop feedback mechanism: whenever a technician records what physically fixed the problem, local Bayesian priors are updated. The tool transforms transient personal experience into permanent organizational asset.

---

### SLIDE 7 — Validation & Quality Assurance
**Timestamp:** `[5:35 – 6:35]` (60 seconds)

A manufacturing diagnostic system is only as good as its verification rigor.

We evaluated PasteTrace against **15 comprehensive industrial failure vectors** spanning nozzle blockages, pneumatic instability, fluid viscosity shifts, air entrapment, and mechanical needle misalignment.

Across our test matrix, our engine demonstrated:
- **100% Top-1 and Top-3 root-cause accuracy**, reliably placing the true physical defect within the top diagnostic tier across all test scenarios.
- **11 out of 11 adversarial edge tests passed**, proving robust input schema bounds and zero unexpected crashes under invalid inputs.
- An average diagnostic latency of **0.17 milliseconds**, proving that complex evidence-weighted reasoning executes with virtually zero computational overhead.
- Optical validation on both synthetic and physical SPI boards, accurately identifying micro-bridging and starved solder pads.

These metrics prove that PasteTrace is not a theoretical prototype, but a battle-tested industrial engine.

---

### SLIDE 8 — Enterprise Impact & ROI
**Timestamp:** `[6:35 – 7:25]` (50 seconds)

What does PasteTrace deliver to a manufacturing enterprise?

1. **Drastic MTTR Reduction:** Cuts troubleshooting time by up to 70%, turning hours of unguided trial-and-error into structured, seconds-long triage.
2. **Reduced Scrap & Maintenance Overhead:** Prevents premature needle replacements, unnecessary pump disassemblies, and spoiled fluid syringes.
3. **Accelerated Technician Onboarding:** Enables junior technicians on the graveyard shift to troubleshoot with the diagnostic confidence of a 10-year veteran.
4. **Frictionless Compliance:** Automatically generates audit-ready 8D documentation with embedded visual proof, eliminating manual administrative overhead.

Now, let us move from theory to reality. We invite you to see PasteTrace in action on a real dispensing failure.

---

### SLIDE 9 — LIVE SYSTEM DEMO
**Timestamp:** `[7:25 – 9:35]` (2 minutes 10 seconds)

*(Presenter cuts smoothly from presentation slides to the live dark-mode PasteTrace Console running at `http://localhost:5173`.)*

```
================================================================================
ACT 1: COMPUTER VISION & QUALITY SCORING [7:25 – 7:55] (30s)
================================================================================
```
- **Visual Action:**
  - On the **Workbench > Inspect & Diagnose** tab, click on the **Board Gallery**.
  - Select the `Less Paste` board sample (or upload a board photo).
  - Click **Analyze Board** (or let the local pipeline process it).
  - Zoom in slightly on the canvas overlay: highlight the green bounding boxes on Good leads and red bounding boxes on starved leads.
  - Point the cursor to the **Inspection Summary** and **Quality Score card**.

- **Spoken Voiceover:**
  > *"Here is the live PasteTrace console. We start at the optical inspection station. When an operator spots a potential defect, they load or capture an image of the dispensed board.
  >
  > Immediately, our two-stage vision pipeline engages: a trained YOLOv8s detector localizes every lead, and a MobileNetV2 classifier evaluates paste coverage.
  >
  > Notice the canvas: it precisely flags four leads with insufficient solder paste in red. Instantly, PasteTrace issues a FAIL verdict and generates an objective Dispensing Quality Score of 68 out of 100, breaking down shape, volume, and positioning consistency."*

```
================================================================================
ACT 2: GUIDED DISCOVERY & EXPLAINABLE DIAGNOSIS [7:55 – 8:30] (35s)
================================================================================
```
- **Visual Action:**
  - Click the **Assistant** toggle in the top bar to open the side drawer.
  - Type or click into the prompt: *"The defect is intermittent and started right after we installed a new solder paste syringe."* Click **ANALYZE**.
  *(Pro-tip: You can also click the built-in 'Load demo' button in the drawer header to instantly load this complete session!)*
  - Watch the evidence chips light up: `Material: Solder Paste`, `Intermittent`, `Recent Batch Change`.
  - On the main panel, highlight the **Identified Dispensing Defect** banner (`Insufficient Dispensing Volume — 90% Confidence`).
  - Expand **Ranking details** to show the horizontal likelihood bars, hover over the **Reasoning** block, and scroll down to the **Action Plan**.

- **Spoken Voiceover:**
  > *"The visual evidence feeds straight into our diagnostic assistant. Through dynamic intake questions, the operator describes the operating context. Layered on-device NLU parses this input without touching an external cloud.
  >
  > PasteTrace identifies the defect as 'Insufficient Dispensing Volume' with 90% confidence. But look at the cause ranking: 'Air trapped in syringe' is ranked at 85%, followed by nozzle clogging at 70%.
  >
  > Crucially, PasteTrace is not a black box—it explains WHY. It states explicitly: 'Air bubbles are ranked highest because volume varies intermittently rather than continuously, and followed a syringe changeover.' Below, it gives the operator a prioritized, step-by-step checklist of what to inspect first."*

```
================================================================================
ACT 3: CLOSED-LOOP AI LEARNING DATABASE [8:30 – 8:55] (25s)
================================================================================
```
- **Visual Action:**
  - Under **"What actually fixed it?"**, click the button chip: `Air trapped in syringe / supply`.
  - Type in the note: *"Purged syringe barrel. Defect cleared."* Click **Save to Case Log**.
  - Expand **Related cases** to show the interactive timeline and historical summary text.
  - Click the top navigation tab **02 LEARNING DB** to reveal the searchable case log.

- **Spoken Voiceover:**
  > *"Once the technician purges the syringe barrel and resolves the issue, they record what actually fixed it.
  >
  > Saving to the Case Log updates our local Bayesian priors in IndexedDB. Looking at the related cases timeline, out of 12 similar historical incidents, 8 were traced to air in the syringe. PasteTrace captures shop-floor tribal knowledge so every confirmed fix makes future diagnoses faster and smarter."*

```
================================================================================
ACT 4: 8D REPORT GENERATION & EXPORT [8:55 – 9:20] (25s)
================================================================================
```
- **Visual Action:**
  - Switch back to **01 WORKBENCH** and click the **Report** sub-tab.
  - Scroll through the pre-populated **8D Quality Report** (Machine ID, D1–D5 containment and root-cause data, and the embedded board photo with defect bounding boxes).
  - Click **Download PDF** (or **Generate PDF**) and display the exported PDF document on screen.

- **Spoken Voiceover:**
  > *"When defect containment requires formal quality sign-off, the operator simply clicks the Report tab.
  >
  > PasteTrace automatically compiles the entire investigation into an industry-standard 8D Non-Conformance Report. It embeds the board image with bounding-box defect overlays, logs containment actions, and structures verification notes. With one click, it exports an audit-ready PDF ready for quality managers and customer compliance."*

```
================================================================================
ACT 5: CALIBRATION & LAB CONSOLE WRAP-UP [9:20 – 9:35] (15s)
================================================================================
```
- **Visual Action:**
  - Click the **Calibration** sub-tab to display the adjustable star-rating and defect tolerance sliders.
  - Briefly toggle the dark/light mode button in the top bar to show UI flexibility, then return to the sleek dark instrument console.

- **Spoken Voiceover:**
  > *"With adjustable calibration thresholds for custom line tolerances and 100% on-device offline resilience, PasteTrace provides an industrial-grade instrument built specifically for high-reliability manufacturing."*

---

### SLIDE 10 — SUMMARY & CLOSING
**Timestamp:** `[9:35 – 10:00]` (25 seconds)

*(Presenter transitions back to the final slide.)*

To conclude:

PasteTrace transforms fluid dispensing maintenance from **guess, replace, and retry** into **see, ask, reason, and act.**

By uniting edge computer vision, explainable physics-grounded reasoning, closed-loop machine learning, and automated 8D reporting, we provide manufacturing lines with the speed, consistency, and intelligence they need to thrive.

We are **Team Amaterasu**, and this is **PasteTrace — The Defect Detective**.

Thank you.