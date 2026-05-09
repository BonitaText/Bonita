# Bonita — Project Notes

## Problem

Online resources are often unstructured and wordy, making them inaccessible to many people. Autistic individuals, those with ADHD, and people with dyslexia face difficulty processing information in dense, unformatted text.

## Solution

A Chrome extension that restructures walls of website text into readable content, real time, specifically built around the needs of neurodivergent users.

---

## Core Design Principle

Use the LLM as a last resort, not the first call. Most of what users need can be done with traditional NLP — instantly, for free, with no token limits. The LLM only steps in when content is genuinely too complex for rule-based tools.

**Readability gate:** Run Flesch-Kincaid on each paragraph. Score above 60 → NLP only. Score below 60 → queue LLM call. This keeps 80–90% of pages completely token-free.

**Caching:** LLM results are cached against a URL + content fingerprint in PostgreSQL. Revisiting the same page reuses the previous output at no cost.

---

## Tech Stack

| Tool | Purpose |
|---|---|
| React + Vite + CRXJS | Chrome extension frontend |
| FastAPI (Python) | Backend server |
| PostgreSQL | Caching LLM results, user preferences |
| spaCy | Keyword/phrase extraction, POS tagging |
| Flesch-Kincaid | Readability scoring |
| Qwen (LLM) | Semantic reordering, sentence simplification, TLDR |
| Datamuse API | Word synonyms and definitions on hover |
| PDF.js | Extract text from PDFs in Chrome |
| mammoth.js | Convert .docx files to HTML in browser |
| PyMuPDF | PDF text extraction (backend) |
| BeautifulSoup | Web page content extraction (backend) |
| html2text | Convert HTML to plain text (backend) |
| OpenDyslexia | Dyslexic-friendly font option |

---

## Processing Pipeline

### 1. Getting text out

- **Websites** — Read the page DOM directly. Use Readability.js to strip navbars, ads, footers, and surface only the main content.
- **PDFs** — Use PDF.js (frontend) or PyMuPDF (backend) to extract plain text page by page.
- **Word docs (.docx)** — Use mammoth.js to convert to plain HTML in the browser. No server needed.
- **Google Docs** — Use the Google Docs API (requires one-time user authorization) or grab user-selected text and process it in a side panel.

### 2. Processing (Traditional NLP — free, instant, no limits)

- **Sentence splitting** — Rule-based, break run-on paragraphs into individual sentences, then optionally convert to bullet points
- **Keyword/phrase bolding** — spaCy noun phrase extraction to identify and bold important terms
- **POS tagging** — Color-code verbs, nouns, adjectives etc. for users who benefit from grammatical highlighting
- **Word simplification** — Large lookup table of complex word → simple word swaps (e.g. "utilize" → "use"). Datamuse API used on hover to fetch synonyms and definitions for flagged complex words.
- **Display adjustments** — Font changes (including OpenDyslexia), spacing, line height — pure CSS/DOM manipulation
- **Reading time estimate** — Simple word count calculation

### 3. Processing (LLM — Qwen, only when needed)

Triggered when Flesch-Kincaid score falls below 60:

- Semantic reordering (e.g. conclusion first for research abstracts)
- Simplifying complex sentences that lookup tables can't handle
- Generating a 3-bullet TLDR for long dense pages

### 4. Output

- **Page overlay** — Replace rendered content on screen with the restructured version. The original page is never modified — the extension swaps what the browser is showing via DOM manipulation. Works for websites and PDFs.

---

## Features

### Core (v1)
- Sentence splitting → bullet point conversion
- Keyword/phrase bolding (spaCy)
- POS color-coding (verbs, nouns, adjectives)
- Word simplification with hover definitions (lookup table + Datamuse)
- Font switching (including OpenDyslexia)
- LLM restructuring for dense content (Qwen, score-gated)
- Result caching (PostgreSQL)

### Additional
- Line focus mode (fade all lines except the one being read)
- Text-to-speech (TTS)
- Audio cues for attention
- Image handling (toggle: keep in place / strip / collect at bottom / show alt text as caption)
- Save and load setting presets

---

## Images

| Option | Notes |
|---|---|
| Leave in place | Simplest. Risk: image may end up beside unrelated content after restructuring. |
| Strip entirely | Cleanest reading experience. Too aggressive as default — make it a toggle. |
| Collect at bottom | Images pulled out of text flow into a gallery. Text reads uninterrupted. |
| Surface alt text | Display `<img alt="...">` text as a visible caption, even when image is hidden. |
| AI description | Send image to LLM vision for a plain English description when alt text is missing. Only for large content images, not icons. |

---

## Word Hover — How It Works

1. On page load, scan text against a word frequency list to flag complex words
2. Flag complex words with a subtle underline — no network call yet
3. On hover → single Datamuse API call to fetch synonyms and definition
4. Cache result locally so repeat hovers are instant
5. Cross-reference Datamuse results against frequency list to pick the simplest synonym

Example popup:

> **ubiquitous** → common
> *found or appearing everywhere*

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

---

## Project Structure

```
text-reader-app/

  frontend/                        ← Chrome extension (React + Vite + CRXJS)
    src/

      shared/                      ← Shared across all extension pieces
        settings.ts                ← Settings shape, defaults, read/write helpers
        types.ts                   ← Shared TypeScript types

      content/                     ← Runs on every webpage
        main.tsx                   ← Injects shadow DOM container into page
        views/
          App.tsx                  ← Floating trigger button + page overlay
          Overlay.tsx              ← Restructured content rendered over the page
          LineFocus.tsx            ← Line focus mode highlight
          WordTooltip.tsx          ← Hover tooltip for word simplification
        hooks/
          useSettings.ts           ← Listens to chrome.storage for live updates
          usePageContent.ts        ← Extracts and sends page content to backend
        utils/
          readability.ts           ← Readability.js wrapper (strips navbars/ads)
          domReplacer.ts           ← Swaps page content with restructured version
          wordScanner.ts           ← Scans page for complex words to underline

      popup/                       ← Click extension icon in toolbar → settings
        index.html
        index.tsx
        views/
          Popup.tsx                ← Settings UI
          sections/
            FontSettings.tsx       ← Font choice (including OpenDyslexia)
            HighlightSettings.tsx  ← POS colors, keyword bolding
            ReadingSettings.tsx    ← Line focus, sentence splitting, bullets
            ImageSettings.tsx      ← Image handling preference
            Presets.tsx            ← Save and load setting presets
            TTSSettings.tsx        ← Text-to-speech configuration

      sidepanel/                   ← Pinned to browser → active reading tools
        index.html
        index.tsx
        views/
          SidePanel.tsx            ← Tools UI
          sections/
            TLDR.tsx               ← 3-bullet summary of current page
            TTSControls.tsx        ← Play, pause, speed, voice controls
            LineFocus.tsx          ← Toggle and sensitivity for line focus
            WordTools.tsx          ← Word simplification, hover definitions
            POSHighlight.tsx       ← Toggle POS highlighting on/off per type

    public/
      logo.png
    manifest.config.ts
    vite.config.ts
    package.json

  backend/                         ← Python + FastAPI
    main.py                        ← Spins up the server
    routes/
      process.py                   ← Text processing endpoints
      words.py                     ← Word lookup / Datamuse endpoints
    services/
      extractor.py                 ← BeautifulSoup, html2text, PyMuPDF
      nlp.py                       ← spaCy, Flesch-Kincaid, sentence splitting
      llm.py                       ← Qwen calls
      cache.py                     ← PostgreSQL caching logic
    models/
      schemas.py                   ← Data shapes (request/response)
    db/
      database.py                  ← PostgreSQL connection
```

### How the three UI pieces divide responsibilities

| Piece | How accessed | Purpose |
|---|---|---|
| Content script | Runs on every page automatically | Page overlay, floating trigger button, word tooltips, line focus |
| Side panel | Pinned to browser via chrome.sidePanel API | Active reading tools — TTS controls, line focus toggle, word simplification, TLDR, POS highlighting |
| Popup | Click extension icon in Chrome toolbar | Settings — font choice, color config, feature toggles, presets |

### How settings stay in sync

All three pieces read and write to `chrome.storage.sync` via the helpers in `shared/settings.ts`. The content script listens for storage changes in real time using `chrome.storage.onChanged` — so adjusting a setting in the side panel applies to the page instantly without a reload.
