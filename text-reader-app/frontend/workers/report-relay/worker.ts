/**
 * worker.ts
 *
 * Cloudflare Worker that relays a bug/feedback report from the Bonita
 * extension popup into a GitHub issue on BonitaText/Bonita.
 *
 * The extension never talks to GitHub directly (that would mean shipping a
 * GitHub token inside the extension bundle, where anyone could extract it).
 * Instead it POSTs { title, body } here, and this Worker — which holds the
 * token as a Cloudflare secret, never exposed to the client — makes the
 * authenticated call on its behalf.
 *
 * Request:  POST /  { title: string, body: string }
 * Response: 200 { success: true, url: string, number: number }
 *           4xx/5xx { success: false, error: string }
 *
 * Required bindings (see README.md):
 *   - env.GITHUB_TOKEN   secret, a fine-grained PAT with Issues: write on
 *                         the BonitaText/Bonita repo.
 *   - env.RATE_LIMIT_KV  KV namespace used for the per-IP rate limit.
 *   - env.ALLOWED_ORIGIN optional, locks CORS to the extension's origin.
 */

export interface Env {
  GITHUB_TOKEN: string
  RATE_LIMIT_KV: KVNamespace
  ALLOWED_ORIGIN?: string
}

interface ReportPayload {
  title: unknown
  body: unknown
}

interface GithubIssueResult {
  url: string
  number: number
}

const GITHUB_OWNER = 'BonitaText'
const GITHUB_REPO = 'Bonita'
const GITHUB_LABEL = 'user-report'

// Keep these in sync with the client-side limits in popup/ReportIssue.tsx —
// the client checks are for UX, these are the ones that actually protect
// the token/API quota.
const MAX_TITLE_LENGTH = 120
const MAX_BODY_WORDS = 200
const MAX_BODY_CHARS = 2000

// A per-IP window, independent of the extension's own "10 per session"
// limit, since a session limit is trivially reset by reopening the popup.
const RATE_LIMIT_WINDOW_SECONDS = 60 * 60
const RATE_LIMIT_MAX_REQUESTS = 10

function corsHeaders(env: Env): Record<string, string> {
  const origin = env.ALLOWED_ORIGIN || '*'
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
}

function jsonResponse(
  data: Record<string, unknown>,
  status: number,
  env: Env,
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(env),
    },
  })
}

function wordCount(text: string): number {
  const trimmed = text.trim()
  if (trimmed.length === 0) return 0
  return trimmed.split(/\s+/).length
}

/**
 * Validates and trims the incoming payload.
 * Returns { title, body } on success, or throws with a user-facing message.
 */
function validatePayload(payload: ReportPayload): { title: string; body: string } {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('Request body must be a JSON object.')
  }

  const title = typeof payload.title === 'string' ? payload.title.trim() : ''
  const body = typeof payload.body === 'string' ? payload.body.trim() : ''

  if (!title) {
    throw new Error('A title is required.')
  }
  if (title.length > MAX_TITLE_LENGTH) {
    throw new Error(`Title must be ${MAX_TITLE_LENGTH} characters or fewer.`)
  }
  if (!body) {
    throw new Error('A report body is required.')
  }
  if (body.length > MAX_BODY_CHARS) {
    throw new Error(`Report is too long (max ${MAX_BODY_CHARS} characters).`)
  }
  if (wordCount(body) > MAX_BODY_WORDS) {
    throw new Error(`Report must be ${MAX_BODY_WORDS} words or fewer.`)
  }

  return { title, body }
}

/**
 * Fixed-window rate limit keyed on the caller's IP, backed by Workers KV.
 * Not perfectly atomic under heavy concurrency, but more than sufficient
 * for a low-volume feedback form.
 */
async function checkRateLimit(env: Env, request: Request): Promise<boolean> {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  const key = `rl:${ip}`

  const current = await env.RATE_LIMIT_KV.get(key)
  const count = current ? parseInt(current, 10) : 0

  if (count >= RATE_LIMIT_MAX_REQUESTS) {
    return false
  }

  await env.RATE_LIMIT_KV.put(key, String(count + 1), {
    expirationTtl: RATE_LIMIT_WINDOW_SECONDS,
  })
  return true
}

async function createGithubIssue(env: Env, title: string, body: string): Promise<GithubIssueResult> {
  const response = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        // GitHub's API requires a User-Agent on all requests.
        'User-Agent': 'bonita-report-relay',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        title: `[User report] ${title}`,
        body,
        labels: [GITHUB_LABEL],
      }),
    },
  )

  const data = (await response.json()) as { html_url?: string; number?: number; message?: string }

  if (!response.ok) {
    throw new Error(data.message || 'GitHub API request failed.')
  }

  return { url: data.html_url as string, number: data.number as number }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(env) })
    }

    if (request.method !== 'POST') {
      return jsonResponse({ success: false, error: 'Method not allowed.' }, 405, env)
    }

    const allowed = await checkRateLimit(env, request)
    if (!allowed) {
      return jsonResponse(
        { success: false, error: 'Too many reports from this network. Try again later.' },
        429,
        env,
      )
    }

    let payload: ReportPayload
    try {
      payload = await request.json()
    } catch {
      return jsonResponse({ success: false, error: 'Invalid JSON body.' }, 400, env)
    }

    let title: string
    let body: string
    try {
      ;({ title, body } = validatePayload(payload))
    } catch (err) {
      return jsonResponse(
        { success: false, error: err instanceof Error ? err.message : 'Invalid request.' },
        400,
        env,
      )
    }

    try {
      const issue = await createGithubIssue(env, title, body)
      return jsonResponse({ success: true, url: issue.url, number: issue.number }, 200, env)
    } catch {
      return jsonResponse(
        { success: false, error: 'Could not file the issue. Please try again later.' },
        502,
        env,
      )
    }
  },
}