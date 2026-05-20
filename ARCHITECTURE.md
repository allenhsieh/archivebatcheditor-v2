# Architecture

Design decisions and rationale. Read on demand when you need to understand a tradeoff.

## Overview

Single-user, localhost-only Next.js app that talks to Archive.org and YouTube on the user's behalf to manage their Archive.org collection.

```
┌─────────────────────────────────────────────────┐
│  Next.js App (port 3000)                        │
│                                                 │
│  ┌──────────────────┐  ┌────────────────────┐   │
│  │ React UI         │  │ Route Handlers     │   │
│  │ - Item selection │  │ - Archive.org RW   │   │
│  │ - Editors        │  │ - YouTube RW       │   │
│  │ - SSE consumer   │──│ - SSE producers    │   │
│  │ - Activity log   │  │ - OAuth callback   │   │
│  └────────┬─────────┘  └─────────┬──────────┘   │
│           │                      │              │
│           ▼                      ▼              │
│      TanStack Query         Drizzle/SQLite      │
└─────────────────────────────────────────────────┘
              │                      │
              ▼                      ▼
   ┌──────────────────┐   ┌──────────────────────┐
   │ Archive.org      │   │ YouTube Data API     │
   │ - search         │   │ - playlistItems      │
   │ - metadata RW    │   │ - videos.update      │
   │ - IA-S3 PUT      │   │ - OAuth token refresh│
   └──────────────────┘   └──────────────────────┘
```

## Why Next.js (not Vite + Express)

v1 ran two servers: Vite (3000) for the frontend, Express (3001) for the API. Vite proxied `/api` and `/auth` to Express. This caused:

- OAuth callback bug: redirect to `/` landed on Express (no frontend), required a `FRONTEND_URL` env-var workaround
- Two `package.json` script entries to remember (`npm run dev` + `npm run server:dev`)
- Test mocks split between frontend HTTP-client and backend HTTP-client paths
- Cookies and CORS dance for cross-port

Next.js Route Handlers eliminate all of that. One process, one port, native SSE support via `ReadableStream`, OAuth callbacks land on the same origin as the UI.

## Why SQLite + drizzle (not JSON files)

v1 persisted state in `.youtube-tokens.json`, `.youtube-retry-queue.json`, `.youtube-channel-cache.json`. Problems:

- No atomicity. A crash mid-write corrupts the file.
- No schema. Easy to drift between code and disk.
- No queries. To find "items that failed yesterday" you'd parse the whole file in memory.
- Activity log was kept in React state and **lost on refresh**, which matters because partial-fail is the common case and the user needs to revisit failed items later.

Drizzle gives a TypeScript-typed schema, migrations, transactions, and SQL queries. SQLite is a single file, zero ops. Together they replace four scattered failure modes with one well-understood store.

See [DB_SCHEMA.md](./DB_SCHEMA.md) for tables.

## Why TanStack Query (not custom useArchive hook)

v1's `useArchive.ts` (411 lines) crammed server state, UI selection state, log state, and processing state into one hook. Components were thin but the hook was a god-object.

TanStack Query handles caching, refetching, mutation queueing, optimistic updates, and error retry semantics for free. Server data lives there; UI selection state goes in Zustand; everything is decoupled and testable.

## Why Tailwind (not inline styles)

v1's components used `style={{...}}` for everything. Hard to scan, no dark-mode story, no reuse of colors/spacing. Tailwind is the modern default and has the strongest AI-tooling support.

## Why sequential writes (not concurrent or atomic-batch)

Two reasons, both are about the user's actual workflow:

1. **Partial-success is the common case.** Items reject for many independent reasons. Sequential + per-item try/catch surfaces *which specific items failed and why*. Concurrent writes would make per-item error correlation messy. Atomic multi-target writes would roll back the entire batch on a single failure — the opposite of what the user needs.
2. **Rate-limit pressure.** Archive.org will 429 or 503 SlowDown if hammered. Sequential with `API_DELAY_MS = 1000` between calls + `X-Accept-Reduced-Priority: 1` keeps you in the green.

This is a deliberate constraint, not a limitation. Do NOT add a "concurrency" knob.

## Why one HTTP client (`fetch`)

v1 used `node:https` in some paths and `fetch` in others. Tests in `flyer-upload.test.ts` mocked both, separately, because the upload path went through one and Archive.org reads went through the other. Pick `fetch` (native in Node 18+), use it everywhere, mocks become trivial.

## SSE event contract (frozen)

Every streaming endpoint emits the same shape so the UI can use one shared `useSSEStream` hook:

```ts
type ProgressEvent =
  | { type: 'start'; total: number; operationId: string }
  | { type: 'progress'; current: number; total: number; identifier: string;
      status: 'processing' | 'completed' | 'error'; error?: string }
  | { type: 'complete'; total: number; successful: number; failed: number;
      results: Array<{ identifier: string; success: boolean; error?: string }> }
  | { type: 'error'; error: string }
```

This is lifted directly from v1's `flyer-upload.test.ts` test expectations. Do not change the shape — the tests in v1 cover it well and we'll port them.

The `operationId` field is the UUID of the corresponding `operation_runs` row, sent in the `start` event so the client can later query `activity_log_entries` for this batch (e.g., to power a "retry failed items from this batch" affordance). v1 had no equivalent because the activity log lived in React state; in the rebuild every batch is addressable.

## Activity log: first-class persistence

Every write attempt (metadata update, flyer fanout, YouTube write) creates a row in `activity_log_entries`. Schema includes:

- `operation_id` — group rows from one batch
- `identifier` — Archive.org or YouTube item
- `status` — success | failure | skipped
- `error_message` — verbatim from Archive.org / YouTube on failure
- `created_at`

The UI surfaces the log with filter by status, date, and operation. The user can select "all failures from this batch" and re-run them. This is a primary feature, not a nice-to-have, because partial-fail is the common case.

## Error taxonomy

Centralized in `lib/archive/errors.ts` and `lib/youtube/errors.ts`. Type guards (lifted from v1):

```ts
isApiError(e)            // Archive.org API error shape
isYouTubeAuthError(e)    // invalid_grant — abort retry queue immediately
isYouTubeQuotaError(e)   // quotaExceeded — abort, surface to UI
isRateLimitError(e)      // 429 — handled by reduced-priority header but watch for it
```

The retry wrapper short-circuits these into appropriate outcomes:

- `"no changes to _meta.xml"` 400 → return success, no retries
- `isYouTubeAuthError` → abort entire batch, surface "re-authorize YouTube"
- `isYouTubeQuotaError` → abort entire batch, surface quota status
- `isRateLimitError` → with reduced-priority header this should rarely fire; if it does, log and back off
- Anything else → log per-item failure, continue with next item

## Frontend component decomposition

v1's `MetadataEditor.tsx` was 2,705 lines containing 6+ distinct features. Split into:

| Component | Responsibility |
|-----------|----------------|
| `SearchSection` | Archive.org collection search input |
| `ItemSelector` | Multi-select grid with per-item status badges |
| `MetadataEditor` | Field selection + value input + "Update N items" button |
| `BatchImageUpload` | One flyer file → cover for N selected items |
| `YouTubeMatcher` | Find YouTube video for selected Archive.org items |
| `YouTubeRecordingDateEditor` | Push recording date to matched YouTube videos |
| `YouTubeTagsSync` | Push tags to matched YouTube videos |
| `YouTubeDescriptionSync` | Push/pull descriptions |
| `LogViewer` | Activity log with filter + retry-failed affordance |

All editors share `useSSEStream(url, body)` — the streaming consumer is implemented once.

## OAuth flow (now sane)

Single origin, single port. Routes:

- `GET /api/auth/youtube` → redirect to Google
- `GET /api/auth/youtube/callback?code=...` → exchange code, persist tokens to `youtube_oauth_tokens` table, redirect to `/?youtube_auth=success`
- `GET /api/auth/youtube/status` → returns `{ authenticated: boolean, expiresAt?: string }`

No `FRONTEND_URL` env var. No proxy. The callback hits the same origin as the UI.

## Token refresh

Use `googleapis` library's automatic refresh. On `invalid_grant`:
- Mark token row as `revoked = true`
- Surface "Re-authorize YouTube" CTA in the UI
- Drain any pending YouTube write operations to a "needs-reauth" status (don't keep retrying — see hard rule #3 in CLAUDE.md)

## Python toolkit decision

The v1 repo has `archive-metadata-tools/` (Python helpers: `analyze_metadata.py`, `delete_bad_flyers.py`, `audit_date_mismatches.py`, etc.). They're standalone scripts, not part of the web app.

For the rebuild: **leave Python out**. If equivalent functionality is needed (audit reports, bulk fixes that don't fit the UI), build it as a CLI script in TypeScript using the same `lib/archive/client.ts`. One language, one toolchain, one place to keep error handling consistent.

If you really want a backstop, add a `scripts/` folder with `tsx`-runnable scripts.

## Logging

Keep the v1 convention of emoji-prefixed `console.log` for per-item operation events (✅ success, ❌ failure, ⏸️ skipped, 🔑 auth issue, 📊 quota). It's friendly to scan in a single-user local dev terminal, and the user explicitly likes it.

Rules:
- Per-item events go to `console.log` AND to `activity_log_entries`. The DB row is the durable record; the console line is the live tail.
- Don't add a structured-logging library (pino, winston). Single-user local app, no log aggregation target, not worth the ceremony.
- Don't log secrets. Never log the raw `Authorization: LOW ...` header, the YouTube refresh token, or full OAuth code-exchange responses.
- Errors that abort a batch (auth expired, quota exhausted) should log a clearly-marked separator line so the cause is obvious when scrolling back.

If logging volume ever becomes a problem (it shouldn't, for one user), revisit — but don't pre-optimize.

## Testing strategy

- **Vitest** for unit tests (utility functions like `standardizeDate`, type guards) and integration tests (route handlers via `next-test-api-route-handler` or direct fetch)
- **Playwright** for E2E (real OAuth flow, real upload-fanout, against a test Archive.org account or with mocked APIs)
- Port the test patterns from v1's `flyer-upload.test.ts` and `server-integration.test.ts` — particularly the SSE event-parsing helpers

## What's NOT in this architecture

- No Redis, no message queue. SQLite + in-process is enough for one user.
- No Docker. Native node + sqlite. `npm install && npm run dev` works.
- No microservices, no GraphQL. Plain Route Handlers.
- No multi-tenancy, no auth provider. Local single-user.
- No analytics, no telemetry.
