# Frontend Source Map

Quick orientation for anyone touching this codebase, especially backend folks figuring out where to plug in.

---

## The big picture

A Chrome extension has three surfaces. Each lives in its own folder:

| Folder | Surface | When it runs |
|---|---|---|
| `content/` | The floating dock + page modifications | Injected into every webpage the user visits |
| `popup/` | Small panel from the toolbar icon | When the user clicks the Bonita icon |
| `sidepanel/` | (currently unused) | — |

All three share data through `shared/settings.ts`, which is backed by `chrome.storage.sync`.

---

## `content/` — the part that actually reads and modifies the page

This is where most of the action is.

### `content/views/`
Visual UI pieces (the dock, toggles, popup menus). Backend folks can mostly ignore this folder.

### `content/utils/` — **the functions that change the page**
Each file = one feature. They take the page DOM as input, mutate it, and have a corresponding "remove" to undo.

| File | What it does | Where could backend help? |
|---|---|---|
| `posHighlighter.ts` | Colors verbs / nouns / adjectives on the page using compromise.js | Could swap to backend POS tagger |
| `sentenceSplitter.ts` | Turns long paragraphs into bullet lists | Could swap to backend sentence segmenter |
| `wordSimplifier.ts` | Replaces complex words with simpler ones using `simpleWordList.ts` | Could swap to backend simplifier (LLM, larger dictionary, etc.) |
| `simpleWordList.ts` | The lookup table for `wordSimplifier`. Plain `Record<string, string>` | — |
| `phraseBolder.ts` | Bolds key noun phrases for skimming | Could swap to backend keyword extractor (TF-IDF, spaCy, etc.) |

**To replace any of these with a backend call, only that file changes.** The rest of the system doesn't care where the result comes from.

### `content/hooks/`
Glue layer that watches user settings and calls into `utils/`. Backend folks can mostly ignore.

### `content/main.tsx`
Entry point — boots the whole content script.

---

## `shared/settings.ts` — **the data contract**

This is the one file backend should actually read. It defines the `BonitaSettings` shape — every feature toggle, every preference, every color. If backend ever needs to know "what does this user have enabled", read this.

```ts
interface BonitaSettings {
  font: 'default' | 'opendyslexic' | 'arial' | 'verdana'
  sentenceSplitting: boolean
  keywordBolding: boolean
  posEnabled: { verbs: boolean; nouns: boolean; adjectives: boolean }
  posColors: { verbs: string; nouns: string; adjectives: string }
  lineFocus: boolean
  wordSimplification: boolean
  tts: boolean
  imageHandling: 'keep' | 'strip' | 'bottom'
  // ...
}
```

Storage key: `bonitaSettings` in `chrome.storage.sync`.

---

## `popup/` — toolbar icon menu

A separate tiny app, opens when the user clicks the extension icon. Currently mostly placeholder sections for finer settings (POS colors, TTS controls, etc.).

---

## How a backend call would slot in

Take `wordSimplifier.ts` as an example. Today it does:

```ts
applyWordSimplification() {
  // walk page text → look up each word in simpleWordList → swap
}
```

To swap to a backend, only this function changes:

```ts
async applyWordSimplification() {
  const text = collectPageText()
  const replacements = await fetch('https://your-backend/simplify', {
    method: 'POST',
    body: JSON.stringify({ text }),
  }).then(r => r.json())
  // apply the replacements with the existing wrapping logic
}
```

The toggle, the storage layer, the hook — none of those change. **Each util file is the integration point for its feature's backend.**
