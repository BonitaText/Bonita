/**
 * @file test/background/index.test.ts
 *
 * Unit tests for background/index.ts.
 *
 * `fetch` is stubbed so no real network call is made — the stub routes
 * responses based on which API the URL points at (Datamuse vs Free
 * Dictionary). `chrome.runtime.onMessage.addListener` is stubbed *before*
 * the module is dynamically imported so we can capture the listener
 * callback the module registers at load time and drive it directly.
 *
 * ## Division of responsibility with `content/utils/__tests__/synonymCache.test.ts`
 * That file assumes fetching and structural filtering already happened and
 * starts from clean `RawPosEntry[]` fixtures. This file is the mirror image:
 * it verifies the fetching, shape-filtering (dedup, circular-def
 * suppression, near-duplicate stems, truncation), and POS bucketing that
 * happen *before* complexity ranking — complexity ranking itself is out of
 * scope here.
 *
 * ## Helper convention
 * `mockFetch({ datamuse, freeDictionary })` — installs a `fetch` stub for
 * one test. Each field accepts a raw JSON payload (array), the string
 * `'fail'` to simulate a non-ok HTTP response, or the string `'error'` to
 * simulate a thrown/rejected fetch (e.g. offline). Omitting a field yields
 * `ok: true` with an empty array, matching a "no results" response.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import type { RawPosEntry } from '../../background/index'

// ─── Module under test (dynamically imported after chrome is stubbed) ────────

type MessageListener = (
  msg: { type: string; word?: string },
  sender: unknown,
  sendResponse: (response?: RawPosEntry[]) => void,
) => boolean

let fetchRawWordData: (word: string) => Promise<RawPosEntry[]>
let registeredListener: MessageListener

beforeAll(async () => {
  const listeners: MessageListener[] = []

  vi.stubGlobal('chrome', {
    runtime: {
      onMessage: {
        addListener: (fn: MessageListener) => {
          listeners.push(fn)
        },
      },
    },
  })

  const mod = await import('../../background/index')
  fetchRawWordData = mod.fetchRawWordData
  registeredListener = listeners[0]
})

// ─── Fetch mocking ────────────────────────────────────────────────────────────

type FetchSpec = unknown[] | 'fail' | 'error'

/**
 * Installs a `fetch` stub for one test. Routes by hostname so a single
 * `fetchRawWordData` call — which hits Datamuse and Free Dictionary in
 * parallel — can be given independent responses for each.
 */
function mockFetch(opts: { datamuse?: FetchSpec; freeDictionary?: FetchSpec } = {}) {
  const fn = vi.fn((url: string) => {
    if (url.includes('datamuse.com')) {
      return respond(opts.datamuse)
    }
    if (url.includes('dictionaryapi.dev')) {
      return respond(opts.freeDictionary)
    }
    return Promise.reject(new Error(`unexpected fetch url: ${url}`))
  })
  vi.stubGlobal('fetch', fn)
  return fn

  function respond(spec: FetchSpec | undefined) {
    if (spec === 'error') return Promise.reject(new Error('network error'))
    if (spec === 'fail') return Promise.resolve({ ok: false, json: async () => [] })
    return Promise.resolve({ ok: true, json: async () => spec ?? [] })
  }
}

/** Builds a minimal Free Dictionary entry with one meaning/definition. */
function fdEntry(
  partOfSpeech: string,
  definition: string,
  synonyms: string[] = [],
  meaningSynonyms: string[] = [],
) {
  return {
    meanings: [
      {
        partOfSpeech,
        synonyms: meaningSynonyms,
        definitions: [{ definition, synonyms }],
      },
    ],
  }
}

beforeEach(() => {
  vi.unstubAllGlobals()
  // Re-stub chrome since unstubAllGlobals only affects globals stubbed via
  // vi.stubGlobal; chrome was stubbed once in beforeAll for module load and
  // the captured `registeredListener` closure no longer depends on the
  // global being present, so nothing further is needed here. `fetch` is
  // re-stubbed per test via mockFetch().
})

// ─── Datamuse bucketing ────────────────────────────────────────────────────────

describe('Datamuse bucketing', () => {
  it('buckets a synonym under "verb" for the "v" tag', async () => {
    mockFetch({ datamuse: [{ word: 'employ', tags: ['v'] }] })
    const entries = await fetchRawWordData('use')
    const verb = entries.find(e => e.pos === 'verb')
    expect(verb?.synonyms).toContain('employ')
  })

  it('buckets a synonym under "noun" for the "n" tag', async () => {
    mockFetch({ datamuse: [{ word: 'application', tags: ['n'] }] })
    const entries = await fetchRawWordData('use')
    const noun = entries.find(e => e.pos === 'noun')
    expect(noun?.synonyms).toContain('application')
  })

  it('buckets a synonym under "adjective" for the "adj" tag', async () => {
    mockFetch({ datamuse: [{ word: 'practical', tags: ['adj'] }] })
    const entries = await fetchRawWordData('useful')
    expect(entries.find(e => e.pos === 'adjective')?.synonyms).toContain('practical')
  })

  it('buckets a synonym under "adverb" for the "adv" tag', async () => {
    mockFetch({ datamuse: [{ word: 'practically', tags: ['adv'] }] })
    const entries = await fetchRawWordData('usefully')
    expect(entries.find(e => e.pos === 'adverb')?.synonyms).toContain('practically')
  })

  it('buckets a synonym under "other" when tags are missing or unrecognised', async () => {
    mockFetch({ datamuse: [{ word: 'whatever', tags: ['xyz'] }] })
    const entries = await fetchRawWordData('something')
    expect(entries.find(e => e.pos === 'other')?.synonyms).toContain('whatever')
  })
})

// ─── Free Dictionary bucketing ──────────────────────────────────────────────────

describe('Free Dictionary bucketing', () => {
  it('assigns the definition to the matching part-of-speech bucket', async () => {
    mockFetch({ freeDictionary: [fdEntry('verb', 'To put into service.')] })
    const entries = await fetchRawWordData('utilize')
    expect(entries.find(e => e.pos === 'verb')?.definition).toBe('To put into service.')
  })

  it('merges per-definition synonyms and per-meaning synonyms into the same bucket', async () => {
    mockFetch({
      freeDictionary: [fdEntry('verb', 'To make use of.', ['employ'], ['harness'])],
    })
    const entries = await fetchRawWordData('utilize')
    const verb = entries.find(e => e.pos === 'verb')
    expect(verb?.synonyms).toEqual(expect.arrayContaining(['employ', 'harness']))
  })

  it('deduplicates synonyms that appear from both Datamuse and Free Dictionary', async () => {
    mockFetch({
      datamuse: [{ word: 'employ', tags: ['v'] }],
      freeDictionary: [fdEntry('verb', 'To make use of.', ['employ'])],
    })
    const entries = await fetchRawWordData('utilize')
    const verb = entries.find(e => e.pos === 'verb')
    expect(verb?.synonyms.filter(s => s === 'employ')).toHaveLength(1)
  })

  it('lower-cases part-of-speech labels', async () => {
    mockFetch({ freeDictionary: [fdEntry('Verb', 'To make use of.')] })
    const entries = await fetchRawWordData('utilize')
    expect(entries.map(e => e.pos)).toContain('verb')
    expect(entries.map(e => e.pos)).not.toContain('Verb')
  })

  it('defaults to "other" when partOfSpeech is missing', async () => {
    const entry = { meanings: [{ synonyms: [], definitions: [{ definition: 'Some meaning.' }] }] }
    mockFetch({ freeDictionary: [entry] })
    const entries = await fetchRawWordData('thing')
    expect(entries.find(e => e.pos === 'other')?.definition).toBe('Some meaning.')
  })

  it('keeps the first non-circular definition per POS and ignores later ones', async () => {
    const entry = {
      meanings: [
        {
          partOfSpeech: 'noun',
          synonyms: [],
          definitions: [
            { definition: 'The first definition.' },
            { definition: 'A second, different definition.' },
          ],
        },
      ],
    }
    mockFetch({ freeDictionary: [entry] })
    const entries = await fetchRawWordData('thing')
    expect(entries.find(e => e.pos === 'noun')?.definition).toBe('The first definition.')
  })
})

// ─── Structural filtering (isStructurallyBad) ───────────────────────────────────

describe('structural filtering', () => {
  it('rejects candidates shorter than 2 characters', async () => {
    mockFetch({ datamuse: [{ word: 'a', tags: ['n'] }] })
    const entries = await fetchRawWordData('apple')
    expect(entries.find(e => e.pos === 'noun')).toBeUndefined()
  })

  it('rejects candidates longer than 20 characters', async () => {
    const tooLong = 'x'.repeat(21)
    mockFetch({ datamuse: [{ word: tooLong, tags: ['n'] }] })
    const entries = await fetchRawWordData('apple')
    expect(entries.find(e => e.pos === 'noun')).toBeUndefined()
  })

  it('rejects a candidate identical to the original word', async () => {
    mockFetch({ datamuse: [{ word: 'apple', tags: ['n'] }] })
    const entries = await fetchRawWordData('apple')
    expect(entries.find(e => e.pos === 'noun')).toBeUndefined()
  })

  it('rejects a candidate identical to the original word regardless of case', async () => {
    mockFetch({ datamuse: [{ word: 'Apple', tags: ['n'] }] })
    const entries = await fetchRawWordData('apple')
    expect(entries.find(e => e.pos === 'noun')).toBeUndefined()
  })

  it('rejects a candidate sharing the original word\'s first 3 characters (near-duplicate stem)', async () => {
    // 'capital' vs 'capitalize' — both start with 'cap'
    mockFetch({ datamuse: [{ word: 'capitalize', tags: ['v'] }] })
    const entries = await fetchRawWordData('capital')
    expect(entries.find(e => e.pos === 'verb')).toBeUndefined()
  })

  it('rejects a candidate that is a substring of the original word', async () => {
    // 'cook' is a substring of 'undercook' but shares no 3-char prefix with it
    mockFetch({ datamuse: [{ word: 'cook', tags: ['v'] }] })
    const entries = await fetchRawWordData('undercook')
    expect(entries.find(e => e.pos === 'verb')).toBeUndefined()
  })

  it('rejects a candidate for which the original word is a substring', async () => {
    mockFetch({ datamuse: [{ word: 'undercook', tags: ['v'] }] })
    const entries = await fetchRawWordData('cook')
    expect(entries.find(e => e.pos === 'verb')).toBeUndefined()
  })

  it('rejects a candidate phrase of more than 2 tokens', async () => {
    mockFetch({ datamuse: [{ word: 'in the money', tags: ['adj'] }] })
    const entries = await fetchRawWordData('rich')
    expect(entries.find(e => e.pos === 'adjective')).toBeUndefined()
  })

  it('accepts a valid 2-token phrase', async () => {
    mockFetch({ datamuse: [{ word: 'well off', tags: ['adj'] }] })
    const entries = await fetchRawWordData('rich')
    expect(entries.find(e => e.pos === 'adjective')?.synonyms).toContain('well off')
  })

  it('accepts an unrelated, structurally valid candidate', async () => {
    mockFetch({ datamuse: [{ word: 'fast', tags: ['adj'] }] })
    const entries = await fetchRawWordData('quick')
    expect(entries.find(e => e.pos === 'adjective')?.synonyms).toContain('fast')
  })

  it('applies the same structural filter to Free Dictionary synonym candidates', async () => {
    mockFetch({ freeDictionary: [fdEntry('adjective', 'Some meaning.', ['quickly'])] })
    // 'quickly' shares first 3 chars with 'quick'
    const entries = await fetchRawWordData('quick')
    expect(entries.find(e => e.pos === 'adjective')?.synonyms).not.toContain('quickly')
  })
})

// ─── Circular definition suppression ────────────────────────────────────────────

describe('circular definition suppression', () => {
  it('discards a definition that contains the headword as a whole word', async () => {
    // Include a synonym so the bucket survives the empty-bucket filter and
    // we can inspect its (nulled-out) definition in isolation.
    mockFetch({
      freeDictionary: [fdEntry('noun', 'A prefect is a school official.', ['administrator'])],
    })
    const entries = await fetchRawWordData('prefect')
    const noun = entries.find(e => e.pos === 'noun')
    expect(noun).toBeDefined()
    expect(noun?.definition).toBeNull()
  })

  it('keeps a definition where the headword only appears as a stem, not a whole word', async () => {
    mockFetch({ freeDictionary: [fdEntry('noun', 'An officer within a prefecture.')] })
    const entries = await fetchRawWordData('prefect')
    expect(entries.find(e => e.pos === 'noun')?.definition).toBe('An officer within a prefecture.')
  })

  it('is case-insensitive when detecting circularity', async () => {
    mockFetch({
      freeDictionary: [fdEntry('noun', 'A Prefect oversees students.', ['administrator'])],
    })
    const entries = await fetchRawWordData('prefect')
    const noun = entries.find(e => e.pos === 'noun')
    expect(noun).toBeDefined()
    expect(noun?.definition).toBeNull()
  })

  it('falls through to a later non-circular definition when an earlier one is circular', async () => {
    const entry = {
      meanings: [
        {
          partOfSpeech: 'noun',
          synonyms: [],
          definitions: [
            { definition: 'A prefect leads a group of students.' },
            { definition: 'A senior administrative official.' },
          ],
        },
      ],
    }
    mockFetch({ freeDictionary: [entry] })
    const entries = await fetchRawWordData('prefect')
    expect(entries.find(e => e.pos === 'noun')?.definition).toBe('A senior administrative official.')
  })
})

// ─── Definition truncation ───────────────────────────────────────────────────────

describe('definition truncation', () => {
  it('leaves short definitions untouched', async () => {
    mockFetch({ freeDictionary: [fdEntry('noun', 'A short definition.')] })
    const entries = await fetchRawWordData('thing')
    expect(entries.find(e => e.pos === 'noun')?.definition).toBe('A short definition.')
  })

  it('truncates definitions longer than 200 characters and appends an ellipsis', async () => {
    const longDef = 'word '.repeat(60).trim() // well over 200 chars
    mockFetch({ freeDictionary: [fdEntry('noun', longDef)] })
    const entries = await fetchRawWordData('thing')
    const def = entries.find(e => e.pos === 'noun')?.definition
    expect(def).toBeDefined()
    expect(def!.endsWith('…')).toBe(true)
    expect(def!.length).toBeLessThanOrEqual(201) // 200 chars + ellipsis
  })

  it('truncates on a word boundary rather than mid-word', async () => {
    const longDef = 'word '.repeat(60).trim()
    mockFetch({ freeDictionary: [fdEntry('noun', longDef)] })
    const entries = await fetchRawWordData('thing')
    const def = entries.find(e => e.pos === 'noun')?.definition!
    const withoutEllipsis = def.slice(0, -1)
    expect(withoutEllipsis.endsWith(' ')).toBe(false)
    expect(longDef.startsWith(withoutEllipsis)).toBe(true)
  })
})

// ─── Empty-bucket dropping ────────────────────────────────────────────────────────

describe('empty-bucket dropping', () => {
  it('drops a POS bucket that ends up with no synonyms and no definition', async () => {
    // Only candidate is structurally bad; only definition is circular.
    mockFetch({
      datamuse: [{ word: 'thing', tags: ['n'] }], // identical to headword -> rejected
      freeDictionary: [fdEntry('noun', 'A thing is an object.')], // circular -> null
    })
    const entries = await fetchRawWordData('thing')
    expect(entries.find(e => e.pos === 'noun')).toBeUndefined()
  })

  it('keeps a bucket that has a definition even with zero synonyms', async () => {
    mockFetch({ freeDictionary: [fdEntry('verb', 'To put into practical action.')] })
    const entries = await fetchRawWordData('utilize')
    const verb = entries.find(e => e.pos === 'verb')
    expect(verb).toBeDefined()
    expect(verb?.synonyms).toEqual([])
  })

  it('keeps a bucket that has synonyms even with no definition', async () => {
    mockFetch({ datamuse: [{ word: 'employ', tags: ['v'] }] })
    const entries = await fetchRawWordData('utilize')
    const verb = entries.find(e => e.pos === 'verb')
    expect(verb).toBeDefined()
    expect(verb?.definition).toBeNull()
  })

  it('returns an empty array when both sources return nothing usable', async () => {
    mockFetch({})
    const entries = await fetchRawWordData('utilize')
    expect(entries).toEqual([])
  })
})

// ─── Network resilience ──────────────────────────────────────────────────────────

describe('network resilience', () => {
  it('returns [] for Datamuse-derived data when the Datamuse fetch throws', async () => {
    mockFetch({ datamuse: 'error', freeDictionary: [fdEntry('verb', 'To make use of.')] })
    const entries = await fetchRawWordData('utilize')
    // Free Dictionary data still comes through despite Datamuse failing
    expect(entries.find(e => e.pos === 'verb')?.definition).toBe('To make use of.')
  })

  it('returns [] for Datamuse-derived data when the Datamuse response is not ok', async () => {
    mockFetch({ datamuse: 'fail' })
    const entries = await fetchRawWordData('utilize')
    expect(entries).toEqual([])
  })

  it('returns [] for Free Dictionary-derived data when that fetch throws', async () => {
    mockFetch({ datamuse: [{ word: 'employ', tags: ['v'] }], freeDictionary: 'error' })
    const entries = await fetchRawWordData('utilize')
    expect(entries.find(e => e.pos === 'verb')?.synonyms).toContain('employ')
    expect(entries.find(e => e.pos === 'verb')?.definition).toBeNull()
  })

  it('returns [] for Free Dictionary-derived data when that response is not ok', async () => {
    mockFetch({ freeDictionary: 'fail' })
    const entries = await fetchRawWordData('utilize')
    expect(entries).toEqual([])
  })

  it('resolves to an empty array (not a rejection) when both sources fail', async () => {
    mockFetch({ datamuse: 'error', freeDictionary: 'error' })
    await expect(fetchRawWordData('utilize')).resolves.toEqual([])
  })
})

// ─── Word normalisation ───────────────────────────────────────────────────────────

describe('word normalisation', () => {
  it('lower-cases the word before building request URLs', async () => {
    const fn = mockFetch({ datamuse: [], freeDictionary: [] })
    await fetchRawWordData('Utilize')
    const urls = fn.mock.calls.map(call => call[0] as string)
    expect(urls.some(u => u.includes('Utilize'))).toBe(false)
    expect(urls.some(u => u.includes('utilize'))).toBe(true)
  })
})

// ─── Message listener ─────────────────────────────────────────────────────────────

describe('message listener', () => {
  it('returns true and asynchronously calls sendResponse for FETCH_WORD_INFO', async () => {
    mockFetch({ datamuse: [{ word: 'employ', tags: ['v'] }] })
    const sendResponse = vi.fn()

    const result = registeredListener({ type: 'FETCH_WORD_INFO', word: 'use' }, {}, sendResponse)
    expect(result).toBe(true)

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledTimes(1))
    const response = sendResponse.mock.calls[0][0] as RawPosEntry[]
    expect(response.find(e => e.pos === 'verb')?.synonyms).toContain('employ')
  })

  it('returns false and never calls sendResponse for unrelated message types', () => {
    const sendResponse = vi.fn()
    const result = registeredListener({ type: 'SOME_OTHER_MESSAGE' }, {}, sendResponse)
    expect(result).toBe(false)
    expect(sendResponse).not.toHaveBeenCalled()
  })
})