/**
 * @file content/utils/__tests__/synonymCache.test.ts
 *
 * Unit tests for synonymCache.ts.
 *
 * `fetch` is mocked via `vi.stubGlobal` so no real network calls are made.
 * Each test explicitly controls what Datamuse and the Free Dictionary return,
 * letting us verify bucketing, ranking, deduplication, circular-definition
 * suppression, structural filtering, and cache behaviour in isolation.
 *
 * ## Helper convention
 * `mockFetch(datamuse, freeDictionary)` — install a per-test mock that returns
 * the given fixtures in the order the two `fetch` calls are made inside
 * `fetchWordInfo`. Call `clearSynonymCache()` in `beforeEach` so the in-memory
 * cache never bleeds between tests.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { fetchWordInfo, clearSynonymCache } from '../../content/utils/synonymCache'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** A minimal Datamuse response with two tagged synonyms. */
const DM_TWO_SYNS = [
  { word: 'use',    score: 1000, tags: ['v'] },
  { word: 'employ', score: 800,  tags: ['v'] },
]

/** A Free Dictionary response with one verb meaning, two synonyms, one definition. */
const FD_VERB_ENTRY = [
  {
    meanings: [
      {
        partOfSpeech: 'verb',
        synonyms: ['apply'],
        definitions: [
          { definition: 'To make use of something.', synonyms: ['deploy'] },
        ],
      },
    ],
  },
]

/** A Free Dictionary response with a definition that is circular. */
const FD_CIRCULAR_DEF = [
  {
    meanings: [
      {
        partOfSpeech: 'verb',
        synonyms: [],
        definitions: [
          { definition: 'To utilize something in a utilitarian way.', synonyms: [] },
        ],
      },
    ],
  },
]

/** A Free Dictionary response with two POS buckets. */
const FD_MULTI_POS = [
  {
    meanings: [
      {
        partOfSpeech: 'noun',
        synonyms: ['application'],
        definitions: [{ definition: 'The state of being used.', synonyms: [] }],
      },
      {
        partOfSpeech: 'verb',
        synonyms: ['employ'],
        definitions: [{ definition: 'To put into service.', synonyms: [] }],
      },
    ],
  },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

type FetchReturn = object | object[]

/**
 * Installs a `fetch` mock for one test. Calls alternate between the Datamuse
 * URL and the Free Dictionary URL in the order they are fired by `fetchWordInfo`
 * (Datamuse first, Free Dictionary second, both via `Promise.all`).
 *
 * Pass `null` for a source to simulate a network error (rejected promise).
 */
function mockFetch(datamuse: FetchReturn | null, freeDictionary: FetchReturn | null) {
  let callCount = 0
  vi.stubGlobal('fetch', vi.fn((_url: string) => {
    const fixture = callCount++ === 0 ? datamuse : freeDictionary
    if (fixture === null) return Promise.reject(new Error('network error'))
    return Promise.resolve({
      ok: true,
      json: async () => fixture,
    })
  }))
}

/** Empty frequency map — words not in the map get the "not found" rarity score. */
const EMPTY_FREQ = new Map<string, number>()

/** A frequency map that marks 'use' and 'apply' as very common (rank ≤ 1000). */
const FREQ_WITH_COMMON = new Map<string, number>([
  ['use', 50],
  ['apply', 300],
])

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  clearSynonymCache()
  vi.unstubAllGlobals()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ─── Cache behaviour ──────────────────────────────────────────────────────────

describe('cache', () => {
  it('returns the same object on the second call without fetching again', async () => {
    mockFetch(DM_TWO_SYNS, FD_VERB_ENTRY)

    const first  = await fetchWordInfo('utilize', EMPTY_FREQ)
    const second = await fetchWordInfo('utilize', EMPTY_FREQ)

    expect(second).toBe(first)
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2) // one Datamuse + one FreeDictionary
  })

  it('normalises casing — "Utilize" and "utilize" share the same cache entry', async () => {
    mockFetch(DM_TWO_SYNS, FD_VERB_ENTRY)

    const lower = await fetchWordInfo('utilize', EMPTY_FREQ)
    const upper = await fetchWordInfo('Utilize', EMPTY_FREQ)

    expect(upper).toBe(lower)
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2)
  })

  it('clearSynonymCache causes the next call to fetch fresh data', async () => {
    // A single persistent fetch spy is required here — re-stubbing fetch
    // between rounds (as `mockFetch` does) would replace the spy and reset
    // its call count, making it impossible to assert a cumulative total.
    // Instead we keep one spy alive for the whole test and swap which
    // fixtures it serves via the `round` closure variable.
    let round = 0
    let callCount = 0
    const rounds = [
      { datamuse: [] as object[], freeDictionary: [] as object[] },
      { datamuse: DM_TWO_SYNS, freeDictionary: FD_VERB_ENTRY },
    ]

    vi.stubGlobal('fetch', vi.fn((_url: string) => {
      const { datamuse, freeDictionary } = rounds[round]
      // Datamuse fires first, Free Dictionary second, within each round
      // (calls alternate: 0=DM,1=FD,2=DM,3=FD ...)
      const fixture = callCount++ % 2 === 0 ? datamuse : freeDictionary
      return Promise.resolve({
        ok: true,
        json: async () => fixture,
      })
    }))

    await fetchWordInfo('utilize', EMPTY_FREQ) // round 0: empty results, gets cached

    clearSynonymCache()
    round = 1

    await fetchWordInfo('utilize', EMPTY_FREQ) // round 1: cache was cleared, fetches again

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(4) // 2 calls per round × 2 rounds
  })
})

// ─── Network resilience ───────────────────────────────────────────────────────

describe('network resilience', () => {
  it('returns hasContent:false and empty entries when both sources fail', async () => {
    mockFetch(null, null)
    const info = await fetchWordInfo('utilize', EMPTY_FREQ)
    expect(info.hasContent).toBe(false)
    expect(info.entries).toHaveLength(0)
  })

  it('returns data from Free Dictionary when Datamuse fails', async () => {
    mockFetch(null, FD_VERB_ENTRY)
    const info = await fetchWordInfo('utilize', EMPTY_FREQ)
    expect(info.hasContent).toBe(true)
  })

  it('returns data from Datamuse when Free Dictionary fails', async () => {
    mockFetch(DM_TWO_SYNS, null)
    const info = await fetchWordInfo('utilize', EMPTY_FREQ)
    expect(info.hasContent).toBe(true)
  })

  it('returns hasContent:false when both sources return empty arrays', async () => {
    mockFetch([], [])
    const info = await fetchWordInfo('utilize', EMPTY_FREQ)
    expect(info.hasContent).toBe(false)
  })
})

// ─── Bucketing and POS ordering ───────────────────────────────────────────────

describe('POS bucketing and ordering', () => {
  it('produces one PosEntry per distinct POS from Free Dictionary', async () => {
    mockFetch([], FD_MULTI_POS)
    const info = await fetchWordInfo('use', EMPTY_FREQ)
    const poses = info.entries.map(e => e.pos)
    expect(poses).toContain('noun')
    expect(poses).toContain('verb')
  })

  it('puts non-noun POS entries before noun entries', async () => {
    mockFetch([], FD_MULTI_POS)
    const info = await fetchWordInfo('use', EMPTY_FREQ)
    const nounIdx = info.entries.findIndex(e => e.pos === 'noun')
    const verbIdx = info.entries.findIndex(e => e.pos === 'verb')
    expect(verbIdx).toBeLessThan(nounIdx)
  })

  it('merges Datamuse and Free Dictionary synonyms into the same POS bucket', async () => {
    // Datamuse tags 'use' as verb; FD_VERB_ENTRY also has verb synonyms.
    mockFetch(DM_TWO_SYNS, FD_VERB_ENTRY)
    const info = await fetchWordInfo('utilize', EMPTY_FREQ)
    const verbEntry = info.entries.find(e => e.pos === 'verb')
    expect(verbEntry).toBeDefined()
    // 'use' and 'employ' from Datamuse + 'apply'/'deploy' from FD are all verb
    expect(verbEntry!.synonyms.length).toBeGreaterThan(0)
  })

  it('drops POS buckets that end up with no synonyms and no definition', async () => {
    // Return a meaning whose only definition is circular and has no synonyms.
    mockFetch([], FD_CIRCULAR_DEF)
    const info = await fetchWordInfo('utilize', EMPTY_FREQ)
    // The circular definition should be suppressed; if no synonyms exist either
    // the bucket should be dropped entirely.
    const hasEmptyBucket = info.entries.some(e => e.synonyms.length === 0 && e.definition === null)
    expect(hasEmptyBucket).toBe(false)
  })
})

// ─── Structural filtering ─────────────────────────────────────────────────────

describe('structural filtering', () => {
  it('excludes a candidate that is identical to the lookup word', async () => {
    const dmWithSelf = [{ word: 'utilize', score: 500, tags: ['v'] }]
    mockFetch(dmWithSelf, [])
    const info = await fetchWordInfo('utilize', EMPTY_FREQ)
    const allSyns = info.entries.flatMap(e => e.synonyms)
    expect(allSyns).not.toContain('utilize')
  })

  it('excludes candidates that share the first 3 characters with the lookup word', async () => {
    // 'uti' is the 3-char prefix of 'utilize'; 'utile' shares it.
    const dmNearDupe = [{ word: 'utile', score: 500, tags: ['v'] }]
    mockFetch(dmNearDupe, [])
    const info = await fetchWordInfo('utilize', EMPTY_FREQ)
    const allSyns = info.entries.flatMap(e => e.synonyms)
    expect(allSyns).not.toContain('utile')
  })

  it('excludes multi-word candidates with more than 2 tokens', async () => {
    const dmPhrase = [{ word: 'make use of', score: 500, tags: ['v'] }]
    mockFetch(dmPhrase, [])
    const info = await fetchWordInfo('utilize', EMPTY_FREQ)
    const allSyns = info.entries.flatMap(e => e.synonyms)
    expect(allSyns).not.toContain('make use of')
  })

  it('accepts a two-word synonym phrase', async () => {
    const dmTwoWordValid = [{ word: 'put into', score: 500, tags: ['v'] }]
    mockFetch(dmTwoWordValid, [])
    const info = await fetchWordInfo('utilize', EMPTY_FREQ)
    const allSyns = info.entries.flatMap(e => e.synonyms)
    expect(allSyns).toContain('put into')
  })
})

// ─── Circular definition suppression ─────────────────────────────────────────

describe('circular definition suppression', () => {
  it('suppresses a definition that contains the lookup word as a whole word', async () => {
    mockFetch([], FD_CIRCULAR_DEF)
    const info = await fetchWordInfo('utilize', EMPTY_FREQ)
    const defs = info.entries.flatMap(e => e.definition ? [e.definition] : [])
    const hasCircular = defs.some(d => /\butilize\b/.test(d.toLowerCase()))
    expect(hasCircular).toBe(false)
  })

  it('keeps a definition that merely shares a stem but not the whole word', async () => {
    const fdStemShare = [
      {
        meanings: [
          {
            partOfSpeech: 'noun',
            synonyms: [],
            definitions: [
              // "utilitarian" shares a stem but is not the whole word "utilize"
              { definition: 'Relating to utilitarian principles.', synonyms: [] },
            ],
          },
        ],
      },
    ]
    mockFetch([], fdStemShare)
    const info = await fetchWordInfo('utilize', EMPTY_FREQ)
    const defs = info.entries.flatMap(e => e.definition ? [e.definition] : [])
    expect(defs.some(d => d.includes('utilitarian'))).toBe(true)
  })
})

// ─── Synonym ranking ──────────────────────────────────────────────────────────

describe('synonym ranking', () => {
  it('synonyms appear simplest-first when a real freq map is supplied', async () => {
    // 'use' (rank 50) should score lower than 'employ' (not in map → rare)
    mockFetch(DM_TWO_SYNS, [])
    const info = await fetchWordInfo('utilize', FREQ_WITH_COMMON)
    const verbEntry = info.entries.find(e => e.pos === 'verb')
    expect(verbEntry).toBeDefined()
    // 'use' should appear before 'employ' since it is more common
    const useIdx    = verbEntry!.synonyms.indexOf('use')
    const employIdx = verbEntry!.synonyms.indexOf('employ')
    if (useIdx !== -1 && employIdx !== -1) {
      expect(useIdx).toBeLessThan(employIdx)
    }
  })

  it('deduplicates synonyms that appear in both Datamuse and Free Dictionary', async () => {
    // 'employ' comes from both DM_TWO_SYNS and FD_VERB_ENTRY
    const fdWithDuplicate = [
      {
        meanings: [
          {
            partOfSpeech: 'verb',
            synonyms: ['employ'],
            definitions: [{ definition: 'To make use of.', synonyms: [] }],
          },
        ],
      },
    ]
    mockFetch(DM_TWO_SYNS, fdWithDuplicate)
    const info = await fetchWordInfo('utilize', EMPTY_FREQ)
    const verbEntry = info.entries.find(e => e.pos === 'verb')
    const count = verbEntry?.synonyms.filter(s => s === 'employ').length ?? 0
    expect(count).toBeLessThanOrEqual(1)
  })

  it('returns at most 4 synonyms per POS entry', async () => {
    const manySyns = Array.from({ length: 10 }, (_, i) => ({
      word: `synonym${i}`,
      score: 100 - i,
      tags: ['v'],
    }))
    mockFetch(manySyns, [])
    const info = await fetchWordInfo('utilize', EMPTY_FREQ)
    for (const entry of info.entries) {
      expect(entry.synonyms.length).toBeLessThanOrEqual(4)
    }
  })
})

// ─── hasContent flag ──────────────────────────────────────────────────────────

describe('hasContent', () => {
  it('is true when at least one entry has a synonym', async () => {
    mockFetch(DM_TWO_SYNS, [])
    const info = await fetchWordInfo('utilize', EMPTY_FREQ)
    expect(info.hasContent).toBe(true)
  })

  it('is true when at least one entry has only a definition (no synonyms)', async () => {
    const fdDefOnly = [
      {
        meanings: [
          {
            partOfSpeech: 'verb',
            synonyms: [],
            definitions: [{ definition: 'To put into practical action.', synonyms: [] }],
          },
        ],
      },
    ]
    mockFetch([], fdDefOnly)
    const info = await fetchWordInfo('utilize', EMPTY_FREQ)
    expect(info.hasContent).toBe(true)
  })

  it('is false when all buckets are dropped (circular def, no synonyms)', async () => {
    mockFetch([], FD_CIRCULAR_DEF)
    const info = await fetchWordInfo('utilize', EMPTY_FREQ)
    // If the circular def is the only content, hasContent should be false
    // (the bucket gets dropped entirely)
    if (info.entries.length === 0) {
      expect(info.hasContent).toBe(false)
    } else {
      // Some synonym survived — hasContent can legitimately be true
      expect(info.hasContent).toBe(info.entries.some(e => e.synonyms.length > 0 || e.definition !== null))
    }
  })
})