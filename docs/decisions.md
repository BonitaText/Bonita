# Bonita — Architectural Decisions

This document explains major design decisions, system changes, and tradeoffs made during the development of Bonita.

It focuses on *why the system is built the way it is*, not just how it works.

---

## 1. Evolution of the NLP Approach

### Before

The project initially explored a more traditional NLP pipeline:
- spaCy-based processing
- backend-assisted analysis
- heavier model-driven extraction for text structure and keywords

### Now

Bonita is fully client-side and uses:
- compromise for lightweight POS tagging
- custom heuristic scoring systems
- DOM-based text transformation logic

### Why the change

- Backend infrastructure introduced cost and deployment overhead
- Latency is critical for real-time page transformation
- Privacy-first design required local processing
- Browser environments favor lightweight, deterministic logic

---

## 2. Keyword Extraction Design Shift

### Before
- spaCy-based entity and phrase extraction
- simpler importance logic

### Now
- Hybrid scoring system using:
  - term frequency on page
  - rarity weighting
  - MeSH-based scientific weighting
  - regex/pattern detection for domain terms
  - acronym detection

### Why

Word length and generic NLP features were insufficient for:
- scientific articles
- technical writing
- mixed-domain web pages

The scoring system was redesigned to prioritize:
- semantic importance
- domain relevance
- contextual frequency

---

## 3. Sentence Splitting Strategy

### Before
- pure NLP sentence segmentation

### Now
- DOM-aware sentence splitter using:
  - rule-based boundary detection
  - abbreviation suppression heuristics
  - inline markup preservation via Range API

### Why

Standard NLP segmentation:
- broke inline HTML structure
- misclassified abbreviations as sentence endings
- failed to preserve visual formatting

The new system prioritizes:
- structural correctness in the browser DOM
- readability transformation over linguistic purity

---

## 4. Client-Side Only Architecture

### Decision
Bonita runs entirely in the browser with no backend.

### Reasons

- eliminates server cost
- improves responsiveness
- ensures privacy (no external data processing)
- simplifies deployment and maintenance
- aligns with accessibility-first philosophy

### Tradeoffs

- reduced ability to use heavy ML models
- less contextual understanding than server-based NLP
- more reliance on heuristics and approximations

---

## 5. UI as a Control System (Toolbar Architecture)

### Design shift

Bonita moved from:
> feature toggles in code

to:
> user-controlled cognitive processing tools

### Current model includes:
- draggable floating toolbar
- per-feature enable/disable controls
- adjustable sliders (thresholds, focus intensity)
- customizable visual settings

### Why

This enables:
- per-user customization of cognitive load
- per-website tuning of readability
- modular combination of features

Instead of a fixed pipeline, Bonita behaves like a configurable system.

---

## 6. Tradeoffs Accepted

Bonita intentionally prioritizes:

### Chosen strengths
- speed over deep linguistic accuracy
- explainability over black-box models
- consistency across devices over complexity
- privacy over cloud-based intelligence

### Known limitations
- heuristic inconsistency across domains
- imperfect semantic understanding
- no deep contextual reasoning layer

---

## 7. Design Philosophy Going Forward

Future development will follow these principles:

- improve heuristic systems before introducing ML
- avoid backend dependency unless absolutely necessary
- prioritize user control over automated decisions
- treat AI as optional enhancement, not core requirement

---

## 8. Overall Architectural Direction

Bonita is evolving toward:

> a modular, client-side cognitive accessibility framework for the web

not just a collection of readability features.

The system is designed to remain:
- lightweight
- privacy-preserving
- configurable
- extensible without backend dependency