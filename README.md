# Bonita — Project Notes

## Problem

Online resources are often unstructured and wordy, making them inaccessible to many people. Autistic individuals, those with ADHD, and people with dyslexia face difficulty processing information in dense, unformatted text.

## Solution

A Chrome extension that restructures walls of website text into readable content, real time, specifically built around the needs of neurodivergent users.

---

## Tech Stack

| Tool | Purpose |
|---|---|
| React + Vite + CRXJS | Chrome extension frontend |
| FastAPI (Python) | Backend server |
| spaCy | Keyword/phrase extraction, POS tagging |
| Flesch-Kincaid | Readability scoring |
| OpenDyslexia | Dyslexic-friendly font option |

---

## Processing Pipeline

### 1. Getting text out
- **Websites** — Read the page DOM directly. Use Readability.js to strip navbars, ads, footers, and surface only the main content.

### 2. Processing (Traditional NLP — free, instant, no limits)
- **Sentence splitting** — Rule-based, break run-on paragraphs into individual sentences, then optionally convert to bullet points
- **Keyword/phrase bolding** — spaCy noun phrase extraction to identify and bold important terms
- **POS tagging** — Color-code verbs, nouns, adjectives etc. for users who benefit from grammatical highlighting
- **Display adjustments** — Font changes (including OpenDyslexia), spacing, line height — pure CSS/DOM manipulation
- **Text-to-speech** — Native browser Speech Synthesis API to read page content aloud, with controls for speed and voice selection

### 3. Output

- **Page overlay** — Replace rendered content on screen with the restructured version. The original page is never modified — the extension swaps what the browser is showing via DOM manipulation. Works for websites and PDFs.

## Features

### Core (v1)
- Sentence splitting → bullet point conversion
- Keyword/phrase bolding (spaCy)
- POS color-coding (verbs, nouns, adjectives)
- Font switching (including OpenDyslexia)
- Line focus mode (fade all lines except the one being read)
- Text-to-speech (TTS)

### For the future:
- LLM (for a TLDR)
- Audio cues for attention
- Image handling (toggle: keep in place / strip / collect at bottom / show alt text as caption)
- Save and load setting presets
- Pdf parsing
- Synonym suggestor

---
## Readability Scoring (Flesch-Kincaid)

**Formula:** 206.835 – 1.015 × (words/sentences) – 84.6 × (syllables/words)

| Score | Level |
|---|---|
| 90–100 | Very easy — children's books |
| 60–70 | Plain English — conversational |
| 30–50 | Academic/dense — college level |
| 0–30 | Very hard — legal docs, research papers |

Run per paragraph, not per page, so only the dense sections trigger an LLM call.

### How the UI pieces divide responsibilities

| Piece | How accessed | Purpose |
|---|---|---|
| Side panel | Pinned to browser via chrome.sidePanel API | Active reading tools — TTS controls, line focus toggle, word simplification, TLDR, POS highlighting |
| Popup | Click extension icon in Chrome toolbar | Settings — font choice, color config, feature toggles, presets |

