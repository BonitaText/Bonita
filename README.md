# Bonita

## Problem

Online resources are often unstructured and wordy, making them inaccessible to many people. Autistic individuals, those with ADHD, and people with dyslexia face difficulty processing information in dense, unformatted text.

## Solution

A Chrome extension that restructures walls of website text into readable content, real time, specifically built around the needs of neurodivergent users.

---

## Overview

Bonita is a fully client-side Chrome extension that transforms dense web content into structured, skimmable, and accessible formats.

It improves readability with features that can: break text into point form, bold important terms, and unpack complex words on hover, and additional focus and audio reading tools.

Although we designed it with neurodivergent users in mind, Bonita improves readability for everyone.

---

## Core Philosophy

- Fully client-side processing (no backend required).
- Privacy-first design (no data sent off-device).
- Deterministic, explainable transformations (no black-box AI dependency).
- Built for accessibility.

---

## Features

### Improved Readability
- Sentence splitter → converts dense paragraphs into bullet points.
- Line focus mode → highlights a reading band while fading surrounding text, so you never lose your place.
- Parts of speech highlighting (verbs, nouns, adjectives).
- Keyword bolding for skimming important concepts.
- Accurate science term detection using weighted phrase scoring (MeSH + heuristics).

### Vocabulary Support
- Underlining words based on complexity.
- Synonyms and definitions shown on hover.
- Detail level depends on term difficulty.

### Additional Tools
- Text-to-speech (hover-based reading).
- OpenDyslexic font support and font switching.

### UI Controls
- Floating draggable toolbar.
- Feature toggles per tool.
- Adjustable sliders (bolding and underlining threshold, focus line height).
- Custom bold colors.
- Popup settings menu for global configuration.

---

## How It Works

1. Extract content from the page DOM (Readability.js removes noise).
2. Analyze text using lightweight NLP-inspired heuristics.
3. Transform structure (split, highlight, simplify).
4. Render updated overlay without modifying the original page.

---

## Tech Stack

- React + Vite + CRXJS (Chrome extension frontend).
- Content scripts for DOM manipulation.
- compromise (lightweight NLP tagging).
- Custom heuristic scoring systems.
- Web Speech API (TTS).
- CSS + DOM-based rendering system.

---

## Key Features Summary

Bonita combines:
- structural transformation (splitting + formatting).
- semantic emphasis (keywords + POS tagging).
- cognitive support tools (simplification + TTS).
- user-controlled configurability (toolbar system).

---

## Future Ideas

- Improved phrase detection.
- Better cross-domain keyword ranking.
- Optional advanced language models (research stage, not required).
- Ability to work on differing file types.
- Preset accessibility profiles (speed read mode, in-depth analysis mode, etc).
- Implementing stronger language models that can run locally.
- Split Bonita for science and academia, and the base Bonita.
  - This is because there are many research specific features that are otherwise bloat for non-researchers.
- Integration with Obsidian and Notion, so you can save simplified articles.
- More convenience tools such as font colour changes, dark mode, highlighting etc. 

---

## Project Status

Unreleased, in development.
