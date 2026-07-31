# bonita-report-relay

A small Cloudflare Worker that lets the Bonita extension file a GitHub issue
on `BonitaText/Bonita` without shipping a GitHub token inside the extension
itself. The popup POSTs `{ title, body }` here; the Worker validates it,
rate-limits it, and makes the authenticated GitHub call.

Files in this folder:

- `worker.ts` — the Worker code.
- `wrangler.toml` — deployment config read by the Wrangler CLI.
- `package.json` / `tsconfig.json` — this folder's own toolchain (Wrangler,
  `@cloudflare/workers-types`, TypeScript), separate from the extension's.
- `README.md` — this file.

`ReportIssue.tsx` (the popup form) lives in the extension's own codebase,
not here — see the note at the bottom.

## 1. Install dependencies and Wrangler

From inside this folder:

```bash
npm install
npx wrangler login
```

`npm install` pulls in Wrangler, `@cloudflare/workers-types` (so `worker.ts`
type-checks against the Workers runtime, e.g. `KVNamespace`), and
TypeScript itself, all scoped to this folder rather than installed
globally. `wrangler login` opens a browser window to authenticate Wrangler
with your Cloudflare account. From here on, run `wrangler` via `npx
wrangler ...` (or `npm run dev` / `npm run deploy`, which are already wired
up in `package.json`).

## 2. Create the `user-report` label

The Worker tags every issue it files with a `user-report` label, so reports
are easy to filter out from the rest of the issue tracker. Create it once,
on the repo:

```bash
gh label create user-report --repo BonitaText/Bonita \
  --color "D93F0B" \
  --description "Filed automatically from the extension's in-app report form"
```

(No `gh` CLI? Create it from the browser instead: repo → Issues → Labels →
New label, name it exactly `user-report`.)

## 3. Create a GitHub token

The Worker needs a token with permission to open issues on the repo:

1. Go to **GitHub → Settings → Developer settings → Fine-grained tokens →
   Generate new token**.
2. Resource owner: `BonitaText`. Repository access: **Only select
   repositories** → `Bonita`.
3. Permissions: **Issues → Read and write**. Nothing else is required.
4. Generate the token and copy it — GitHub only shows it once.

## 4. Create the KV namespace for rate limiting

The Worker keeps a light per-IP rate limit (10 requests/hour) in a Workers
KV namespace so the token and GitHub's API quota can't be hammered:

```bash
npx wrangler kv namespace create RATE_LIMIT_KV
```

This prints an `id`. Paste it into `wrangler.toml` under
`[[kv_namespaces]]`, in the `id` field. If you'll also run `wrangler dev`
locally, create a preview namespace too and fill in `preview_id`:

```bash
npx wrangler kv namespace create RATE_LIMIT_KV --preview
```

## 5. Store the token as a secret

Never put the token in `wrangler.toml` — secrets are stored separately by
Cloudflare and aren't visible in your deployed code or dashboard:

```bash
npx wrangler secret put GITHUB_TOKEN
```

Paste the token from step 3 when prompted.

## 6. Deploy

```bash
npm run deploy
```

Wrangler prints the live URL, something like:

```
https://bonita-report-relay.<your-subdomain>.workers.dev
```

That's the URL `ReportIssue.tsx` will POST to.

## 7. Test with curl

```bash
curl -X POST https://bonita-report-relay.<your-subdomain>.workers.dev \
  -H "Content-Type: application/json" \
  -d '{"title": "Test report", "body": "Just confirming the relay works."}'
```

A working setup returns something like:

```json
{ "success": true, "url": "https://github.com/BonitaText/Bonita/issues/42", "number": 42 }
```

Check `https://github.com/BonitaText/Bonita/issues` for a new issue tagged
`user-report`. Send 11 requests back to back and the 11th should come back
`429` with `"Too many reports from this network."` — that's the rate limit
working.

## 8. Lock down CORS (recommended, once you have an extension ID)

By default the Worker responds with `Access-Control-Allow-Origin: *`, which
is fine for testing but means any website could also call your relay from
a browser. Once you've loaded the extension and know its ID, uncomment and
set `ALLOWED_ORIGIN` in `wrangler.toml`:

```toml
[vars]
ALLOWED_ORIGIN = "chrome-extension://<your-extension-id>"
```

Then redeploy with `npm run deploy`.

## Using this from the extension

Once you have a live Worker URL, drop `ReportIssue.tsx` into the popup's
settings menu and set its `RELAY_URL` constant to that URL. See the comment
block at the top of that file for details.