/**
 * @file popup/ReportIssue.tsx
 *
 * "Report an issue" form for the popup's settings menu.
 *
 * This is the *client* half of the report pipeline — a text box and a send
 * button. On submit it POSTs `{ title, body }` to the deployed
 * `bonita-report-relay` Cloudflare Worker (see /worker for that side), which
 * is the piece that actually holds the GitHub token and files the issue on
 * BonitaText/Bonita.
 *
 * Before using this component, deploy the Worker (see worker/README.md) and
 * replace RELAY_URL below with your Worker's live URL.
 *
 * Two limits are enforced here, purely for UX — the Worker enforces its own
 * limits server-side regardless of what the client sends:
 * - `MAX_WORDS` (200): a report longer than that is trimmed/rejected before
 *   it's sent.
 * - `MAX_REPORTS_PER_SESSION` (10): once reached, the form disables itself
 *   until the browser session ends. Tracked in `chrome.storage.session` so
 *   it survives the popup closing and reopening, but resets when the
 *   browser closes.
 */
import { Send } from 'lucide-react'
import { useEffect, useState } from 'react'

// Replace with the URL Wrangler prints after `wrangler deploy`, e.g.
// "https://bonita-report-relay.<your-subdomain>.workers.dev"
const RELAY_URL = 'https://bonita-report-relay.bonitatext.workers.dev'

const MAX_WORDS = 200
const MAX_REPORTS_PER_SESSION = 10
const SESSION_STORAGE_KEY = 'reportCount'

type SubmitState = 'idle' | 'sending' | 'sent' | 'error'

function countWords(text: string): number {
  const trimmed = text.trim()
  if (trimmed.length === 0) return 0
  return trimmed.split(/\s+/).length
}

/**
 * Reads the number of reports already sent this browser session.
 *
 * Uses `chrome.storage.session` when available (cleared when the browser
 * closes, unlike `chrome.storage.local`); falls back to an in-memory count
 * for environments where the extension APIs aren't present, e.g. a plain
 * browser preview during development.
 */
let inMemoryFallbackCount = 0

async function getSessionReportCount(): Promise<number> {
  if (typeof chrome !== 'undefined' && chrome.storage?.session) {
    const result = await chrome.storage.session.get(SESSION_STORAGE_KEY)
    return typeof result[SESSION_STORAGE_KEY] === 'number' ? result[SESSION_STORAGE_KEY] : 0
  }
  return inMemoryFallbackCount
}

async function incrementSessionReportCount(): Promise<number> {
  const next = (await getSessionReportCount()) + 1
  if (typeof chrome !== 'undefined' && chrome.storage?.session) {
    await chrome.storage.session.set({ [SESSION_STORAGE_KEY]: next })
  } else {
    inMemoryFallbackCount = next
  }
  return next
}

/**
 * "Report an issue" card for the popup settings menu.
 *
 * Renders a single textarea (used as both the title source and the report
 * body) plus a send button, a live word count, and a remaining-reports
 * count for the session.
 */
function ReportIssue() {
  const [text, setText] = useState('')
  const [reportCount, setReportCount] = useState(0)
  const [state, setState] = useState<SubmitState>('idle')
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    getSessionReportCount().then(setReportCount)
  }, [])

  const wordCount = countWords(text)
  const overLimit = wordCount > MAX_WORDS
  const sessionLimitReached = reportCount >= MAX_REPORTS_PER_SESSION
  const canSubmit =
    text.trim().length > 0 && !overLimit && !sessionLimitReached && state !== 'sending'

  /**
   * Builds a short issue title from the first line (or first few words) of
   * the report, since the form itself only exposes a single free-text box.
   */
  const deriveTitle = (body: string): string => {
    const firstLine = body.trim().split('\n')[0]
    const words = firstLine.split(/\s+/)
    const truncated = words.slice(0, 12).join(' ')
    return truncated.length < firstLine.length ? `${truncated}…` : truncated
  }

  const handleSubmit = async (): Promise<void> => {
    if (!canSubmit) return

    setState('sending')
    setErrorMessage('')

    try {
      const response = await fetch(RELAY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: deriveTitle(text), body: text.trim() }),
      })
      const data = await response.json()

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Could not send the report.')
      }

      const nextCount = await incrementSessionReportCount()
      setReportCount(nextCount)
      setText('')
      setState('sent')
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not send the report.')
      setState('error')
    }
  }

  return (
    <section className="report-issue" aria-label="Report an issue">
      <div className="report-issue-header">
        <strong>Send Report</strong>
        <span className="report-issue-count">
          {MAX_REPORTS_PER_SESSION - reportCount} of {MAX_REPORTS_PER_SESSION} reports left this
          session
        </span>
      </div>

      <textarea
        className={overLimit ? 'over-limit' : ''}
        disabled={sessionLimitReached || state === 'sending'}
        onChange={(event) => {
          setText(event.currentTarget.value)
          if (state === 'sent' || state === 'error') setState('idle')
        }}
        placeholder="Let us know about bugs, annoyances, and feature ideas you may have."
        rows={4}
        value={text}
      />

      <div className="report-issue-footer">
        <span className={overLimit ? 'over-limit' : ''}>
          {wordCount}/{MAX_WORDS} words
        </span>
        <button disabled={!canSubmit} onClick={handleSubmit} type="button">
          <Send size={15} strokeWidth={2} />
          {state === 'sending' ? 'Sending…' : 'Send'}
        </button>
      </div>

      {state === 'sent' && <p className="report-issue-status success">Thanks — report sent.</p>}
      {state === 'error' && <p className="report-issue-status error">{errorMessage}</p>}
      {sessionLimitReached && (
        <p className="report-issue-status">
          You've reached the limit of {MAX_REPORTS_PER_SESSION} reports for this session.
        </p>
      )}
    </section>
  )
}

export default ReportIssue