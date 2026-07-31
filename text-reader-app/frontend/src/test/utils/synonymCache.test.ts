/**
 * @file content/utils/__tests__/synonymCache.test.ts
 *
 * Unit tests for synonymCache.ts.
 *
 * `chrome.runtime.sendMessage` is mocked so no real background worker or
 * network call is involved. Each test controls what `RawPosEntry[]` the
 * "background worker" returns, letting us verify complexity ranking,
 * diversity selection, POS ordering, caching, and messaging-failure
 * resilience in isolation.
 *
 * Fetching, structural filtering (dedup, circular-def suppression,
 * near-duplicate stems), and Datamuse/Free Dictionary bucketing now live in
 * `background/index.ts` and are covered by `background/__tests__/index.test.ts`
 * instead — this file assumes that filtering already happened and starts
 * from clean `RawPosEntry[]` fixtures.
 *
 * ## Helper convention
 * `mockSendMessage(response)` — install a per-test mock of
 * `chrome.runtime.sendMessage` that invokes its callback with the given
 * `RawPosEntry[]`. Call `clearSynonymCache()` in `beforeEach` so the
 * in-memory cache never bleeds between tests.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fetchWordInfo, clearSynonymCache } from '../../content/utils/synonymCache'
import type { RawPosEntry } from '../../background/index'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** A single verb bucket with two synonyms and a definition. */
const RAW_VERB_TWO_SYNS: RawPosEntry[] = [
  {
    pos: 'verb',
    synonyms: ['use', 'employ'],
    definition: 'To make use of something.',
  },
]

/** Two POS buckets: noun and verb. */
const RAW_MULTI_POS: RawPosEntry[] = [
  {
    pos: 'noun',
    synonyms: ['application'],
    definition: 'The state of being used.',
  },
  {
    pos: 'verb',
    synonyms: ['employ'],
    definition: 'To put into service.',
  },
]

/** A bucket with a definition but no synonyms. */
const RAW_DEF_ONLY: RawPosEntry[] = [
  {
    pos: 'verb',
    synonyms: [],
    definition: 'To put into practical action.',
  },
]

/** A bucket with more synonym candidates than the display cap. */
const RAW_MANY_SYNS: RawPosEntry[] = [
  {
    pos: 'verb',
    synonyms: Array.from({ length: 10 }, (_, i) => `synonym${i}`),
    definition: null,
  },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Installs a `chrome.runtime.sendMessage` mock for one test. Invokes the
 * callback synchronously (matching how the extension's real API behaves for
 * mock purposes) with `response`. Pass `null` to simulate a messaging
 * failure (e.g. background worker not running), surfaced the way the real
 * API does — via `chrome.runtime.lastError` rather than a rejected promise.
 */
function mockSendMessage(response: RawPosEntry[] | null) {
  const sendMessage = vi.fn(
    (_message: unknown, callback: (response?: RawPosEntry[]) => void) => {
      if (response === null) {
        // @ts-expect-error - test-only shape of chrome.runtime.lastError
        globalThis.chrome.runtime.lastError = { message: 'messaging error' }
        callback(undefined)
        // @ts-expect-error - reset for subsequent calls within the same test
        globalThis.chrome.runtime.lastError = undefined
        return
      }
      callback(response)
    },
  )

  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage,
      lastError: undefined as { message: string } | undefined,
    },
  })

  return sendMessage
}

/** Empty frequency map — words not in the map get the "not found" rarity score. */
const EMPTY_FREQ = new Map<string, number>()

/** A frequency map that marks 'use' as very common (rank ≤ 1000) and leaves 'employ' unranked. */
const FREQ_WITH_COMMON = new Map<string, number>([
  ['use', 50],
])

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  clearSynonymCache()
  vi.unstubAllGlobals()
})

// ─── Cache behaviour ──────────────────────────────────────────────────────────

describe('cache', () => {
  it('returns the same object on the second call without messaging again', async () => {
    const sendMessage = mockSendMessage(RAW_VERB_TWO_SYNS)

    const first  = await fetchWordInfo('utilize', EMPTY_FREQ)
    const second = await fetchWordInfo('utilize', EMPTY_FREQ)

    expect(second).toBe(first)
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })

  it('normalises casing — "Utilize" and "utilize" share the same cache entry', async () => {
    const sendMessage = mockSendMessage(RAW_VERB_TWO_SYNS)

    const lower = await fetchWordInfo('utilize', EMPTY_FREQ)
    const upper = await fetchWordInfo('Utilize', EMPTY_FREQ)

    expect(upper).toBe(lower)
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })

  it('clearSynonymCache causes the next call to message the background worker again', async () => {
    const sendMessage = mockSendMessage(RAW_VERB_TWO_SYNS)

    await fetchWordInfo('utilize', EMPTY_FREQ)
    clearSynonymCache()
    await fetchWordInfo('utilize', EMPTY_FREQ)

    expect(sendMessage).toHaveBeenCalledTimes(2)
  })
})

// ─── Messaging resilience ─────────────────────────────────────────────────────

describe('messaging resilience', () => {
  it('returns hasContent:false and empty entries when the background worker is unreachable', async () => {
    mockSendMessage(null)
    const info = await fetchWordInfo('utilize', EMPTY_FREQ)
    expect(info.hasContent).toBe(false)
    expect(info.entries).toHaveLength(0)
  })

  it('returns hasContent:false when the background worker returns an empty array', async () => {
    mockSendMessage([])
    const info = await fetchWordInfo('utilize', EMPTY_FREQ)
    expect(info.hasContent).toBe(false)
  })

  it('does not throw when chrome.runtime.sendMessage itself throws synchronously', async () => {
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: vi.fn(() => {
          throw new Error('extension context invalidated')
        }),
      },
    })
    const info = await fetchWordInfo('utilize', EMPTY_FREQ)
    expect(info.hasContent).toBe(false)
    expect(info.entries).toHaveLength(0)
  })
})

// ─── POS ordering ─────────────────────────────────────────────────────────────

describe('POS ordering', () => {
  it('preserves one PosEntry per distinct POS from the background response', async () => {
    mockSendMessage(RAW_MULTI_POS)
    const info = await fetchWordInfo('use', EMPTY_FREQ)
    const poses = info.entries.map(e => e.pos)
    expect(poses).toContain('noun')
    expect(poses).toContain('verb')
  })

  it('puts non-noun POS entries before noun entries', async () => {
    mockSendMessage(RAW_MULTI_POS)
    const info = await fetchWordInfo('use', EMPTY_FREQ)
    const nounIdx = info.entries.findIndex(e => e.pos === 'noun')
    const verbIdx = info.entries.findIndex(e => e.pos === 'verb')
    expect(verbIdx).toBeLessThan(nounIdx)
  })
})

// ─── Synonym ranking ──────────────────────────────────────────────────────────

describe('synonym ranking', () => {
  it('synonyms appear simplest-first when a real freq map is supplied', async () => {
    // 'use' (rank 50) should score lower than 'employ' (not in map → rare)
    mockSendMessage(RAW_VERB_TWO_SYNS)
    const info = await fetchWordInfo('utilize', FREQ_WITH_COMMON)
    const verbEntry = info.entries.find(e => e.pos === 'verb')
    expect(verbEntry).toBeDefined()
    const useIdx    = verbEntry!.synonyms.indexOf('use')
    const employIdx = verbEntry!.synonyms.indexOf('employ')
    if (useIdx !== -1 && employIdx !== -1) {
      expect(useIdx).toBeLessThan(employIdx)
    }
  })

  it('returns at most 4 synonyms per POS entry', async () => {
    mockSendMessage(RAW_MANY_SYNS)
    const info = await fetchWordInfo('utilize', EMPTY_FREQ)
    for (const entry of info.entries) {
      expect(entry.synonyms.length).toBeLessThanOrEqual(4)
    }
  })

  it('passes through a definition unchanged when synonyms are absent', async () => {
    mockSendMessage(RAW_DEF_ONLY)
    const info = await fetchWordInfo('utilize', EMPTY_FREQ)
    expect(info.entries[0]?.definition).toBe('To put into practical action.')
  })
})

// ─── hasContent flag ──────────────────────────────────────────────────────────

describe('hasContent', () => {
  it('is true when at least one entry has a synonym', async () => {
    mockSendMessage(RAW_VERB_TWO_SYNS)
    const info = await fetchWordInfo('utilize', EMPTY_FREQ)
    expect(info.hasContent).toBe(true)
  })

  it('is true when at least one entry has only a definition (no synonyms)', async () => {
    mockSendMessage(RAW_DEF_ONLY)
    const info = await fetchWordInfo('utilize', EMPTY_FREQ)
    expect(info.hasContent).toBe(true)
  })

  it('is false when the background worker returns no usable buckets', async () => {
    mockSendMessage([])
    const info = await fetchWordInfo('utilize', EMPTY_FREQ)
    expect(info.hasContent).toBe(false)
  })
})