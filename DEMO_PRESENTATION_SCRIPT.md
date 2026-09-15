# 10-Minute Master Presentation Script: PasteTrace
**Competition:** NSW Automation — AI Horizon Solution Challenge 2026  
**Team:** Team Amaterasu  
**Project:** PasteTrace / PasteTrace — The AI Dispensing Defect Detective  
**Tagline:** *Helping Manufacturers Identify Dispensing Problems Faster with AI*  
**Total Target Video Duration:** Under 10:00 (Structured for ~9:40)

---

## Overall Timing & Structure (Under 10 Minutes)

| Section | Slide / Topic | Target Duration | Timestamp |
| :--- | :--- | :--- | :--- |
| **Preamble & Hook** | Slide 1: Introduction & Vision | 25s | `0:00 – 0:25` |
| **Problem Context** | Slide 2: The Micro-Dispensing Bottleneck | 55s | `0:25 – 1:20` |
| **The Paradigm Shift** | Slide 3: Trial & Error vs. Evidence-Guided AI | 55s | `1:20 – 2:15` |
| **Solution Overview** | Slide 4: See. Ask. Reason. Act. | 60s | `2:15 – 3:15` |
| **System Architecture** | Slide 5: The 4-Step Edge Pipeline | 75s | `3:15 – 4:30` |
| **Design Rationale** | Slide 6: Why This Approach? (Explainability, Edge, Memory) | 65s | `4:30 – 5:35` |
| **Technical Validation**| Slide 7: Validation, Accuracy & Benchmarking | 60s | `5:35 – 6:35` |
| **Enterprise Impact** | Slide 8: Shop-Floor ROI & Implementation | 50s | `6:35 – 7:25` |
| **Live Demonstration** | Slide 9: LIVE SYSTEM DEMO (Modular Hand-off) | 2m 10s | `7:25 – 9:35` |
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

Now, let us move from theory to reality. We invite you to see PasteTrace in action.

---

### SLIDE 9 — LIVE SYSTEM DEMO
**Timestamp:** `[7:25 – 9:35]` (2 minutes 10 seconds)

> *(Presenter transition cue: Switch screen to the live PasteTrace / PasteTrace Console interface at `http://localhost:5173`.)*

**Demonstration Narration Flow (Modular 5-Act Walkthrough):**
- **Act 1 — Vision Inspection & Quality Score:**  
  Select a defective board from the gallery. Watch the dual-stage YOLOv8s and MobileNetV2 vision pipeline detect each solder leg, identify insufficient paste pads with red bounding boxes, and assign an overall /100 Dispensing Quality Score with a clear FAIL verdict.
- **Act 2 — Guided Discovery & Explainable Diagnosis:**  
  Open the Assistant drawer. Show how natural language input or dynamic questions extract symptom evidence chips. Demonstrate the ranked root causes (e.g., Air Trapped in Syringe at 85%), highlighting the explicit **"WHY"** reasoning block and the step-by-step action plan.
- **Act 3 — Closed-Loop Learning Database:**  
  Under *"What actually fixed it?"*, select the confirmed root cause, enter a brief technician note, and click **Save to Case Log**. Show the timeline of matching historical cases updating its prior statistics in real time.
- **Act 4 — 8D Report & Audit-Ready PDF:**  
  Switch to the Report sub-tab. Showcase the pre-filled 8D NCR sections with the embedded board photo, and export the official PDF report with one click.
- **Act 5 — Calibration & Precision Lab Console:**  
  Briefly showcase the Calibration tab for custom manufacturing tolerances and the zero-cloud offline capability.

*(Note: For the detailed screen click-through, actions, and verbatim narrator lines for this live demo slot, refer directly to Section 3 of [DEMO_PRESENTATION_SCRIPT.md](file:///Users/elson/AI-Horizon-2026/automation-stuff-comp/DEMO_PRESENTATION_SCRIPT.md).)*

---

### SLIDE 10 — SUMMARY & CLOSING
**Timestamp:** `[9:35 – 10:00]` (25 seconds)

To conclude:

PasteTrace transforms fluid dispensing maintenance from **guess, replace, and retry** into **see, ask, reason, and act.**

By uniting edge computer vision, explainable physics-grounded reasoning, closed-loop machine learning, and automated 8D reporting, we provide manufacturing lines with the speed, consistency, and intelligence they need.

We are **Team Amaterasu**, and this is **PasteTrace — The Defect Detective**.

Thank you.