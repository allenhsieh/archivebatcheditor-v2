# CLAUDE.md

Rules and reference for working in this repo. Loaded every session.
For deeper context, read [ARCHITECTURE.md](./ARCHITECTURE.md), [ARCHIVE_ORG_NOTES.md](./ARCHIVE_ORG_NOTES.md), [YOUTUBE_NOTES.md](./YOUTUBE_NOTES.md), or [LIFT_LIST.md](./LIFT_LIST.md) on demand.

## What This App Does

A bulk metadata editor for the user's Archive.org collection.

- **Primary**: select N items, apply metadata updates (title, creator, description, date, subject, etc.) to all of them, with per-item progress and per-item failure reporting
- **Secondary**: apply ONE flyer image as the cover/thumbnail across N selected items (regular item uploads happen via Archive.org's own uploader, NOT this app)
- **Bonus**: push/pull metadata between Archive.org items and YouTube videos (recording date, tags, descriptions)

Single-user, runs on localhost. No app-level auth.

## Tech Stack (committed — do not redebate)

- **Next.js 15 (App Router)** — eliminates the dual-server issue from v1; native API routes and SSE
- **TypeScript strict mode** — `as any` and `as` casting are forbidden; use type guards
- **SQLite via better-sqlite3 + drizzle ORM** — single source of truth for OAuth tokens, retry queue, channel cache, activity log. NO sidecar JSON files.
- **TanStack Query** — server state (Archive.org items list, YouTube cache, activity log queries)
- **Zustand** — UI state (selections, current view)
- **Tailwind CSS** — no inline `style={{}}` props
- **Zod** — every API route body validated at the boundary
- **Vitest** — unit + integration tests
- **Playwright** — E2E tests
- **`fetch` everywhere** — no `node:https`

## Commands

```bash
npm run dev          # Next.js dev server (one process, port 3000)
npm run build        # Production build
npm run start        # Production server

npm run lint         # ESLint, zero warnings
npm run type-check   # tsc --noEmit
npm run format       # Prettier

npm test             # Vitest
npm run test:watch
npm run e2e          # Playwright
```

## Required Env Vars

```bash
# Archive.org credentials (REQUIRED)
ARCHIVE_ACCESS_KEY=...
ARCHIVE_SECRET_KEY=...
ARCHIVE_EMAIL=...

# YouTube integration (OPTIONAL)
YOUTUBE_API_KEY=...
YOUTUBE_CHANNEL_ID=UC...

# YouTube OAuth (only for write operations to YouTube)
YOUTUBE_CLIENT_ID=...
YOUTUBE_CLIENT_SECRET=...
YOUTUBE_REDIRECT_URI=http://localhost:3000/api/auth/youtube/callback
```

Validate all env vars at startup with Zod (see ARCHITECTURE.md). Crash on missing required vars; warn on missing optional.

## Hard Rules

These exist because v1 violated them and we paid for it. Do not relitigate.

### 1. Partial success is the COMMON case
When writing to Archive.org, items reject individually for many reasons (band tag conflict, value already present, schema violation, malformed value). The user MUST see per-item success/failure with reasons.
- Use **sequential per-item writes** with try/catch around each one
- Stream **per-item SSE progress events** to the UI (`{type, current, total, identifier, status, error?}`)
- Persist per-item outcomes to the activity log so the user can revisit failures later
- **NEVER use Archive.org's atomic multi-target writes** (`-changes` field) — they all-or-nothing rollback, destroying partial-success behavior

### 2. No `as any`. No `as` type casting.
Use type guards. Catalog (port from v1 — see [LIFT_LIST.md](./LIFT_LIST.md)):
- `isApiError(error)` — Archive.org API error response shape
- `isYouTubeAuthError(error)` — `invalid_grant` / token expired
- `isYouTubeQuotaError(error)` — quotaExceeded
- `isRateLimitError(error)` — 429s

### 3. "no changes to _meta.xml" 400 means already-current — not a write, not an error
Archive.org returns this when your patch didn't actually change anything. The retry wrapper must treat it as already-current and return immediately — no retries, no error log. Log the item as `status: 'no_change'` in the activity log, and count it in `noChangeItems` (not `successfulItems`) in `operation_runs`.

### 4. YouTube Data API `search` endpoint is BANNED
Costs 100 quota units per call; daily limit 10K = only 100 searches/day. Use:
- The **channel cache** (built from `playlistItems`, ~1 unit per 50 videos = ~13 units for a 638-video channel)
- **yt-dlp** or **RSS** for free read paths
- OAuth Data API only for **writes** to your own videos (recording date, tags, descriptions)

See [YOUTUBE_NOTES.md](./YOUTUBE_NOTES.md) for the full quota math.

### 5. Suppress flyer derivatives via header, not sidecar file
Use `x-archive-queue-derive: 0` on the flyer upload PUT. Do NOT upload a `_rules.conf` sidecar (the v1 approach). The header is single-request and unambiguous; `_rules.conf` with `CAT.ALL` was narrowed at some point to mean only `CAT.lossy`.
**Verification step before shipping**: do one test upload, confirm Archive.org doesn't generate derivatives. If it still does, see [ARCHIVE_ORG_NOTES.md](./ARCHIVE_ORG_NOTES.md) for fallback options.

### 6. Don't keep old flyer versions
NO `x-archive-keep-old-version` header. Overwrites are fine. The user explicitly does not want version history.

### 7. No `x-archive-size-hint`
Only relevant for multi-GB items. Flyers are ~10MB. Skip.

### 8. No bulk uploader, no multi-flyer drag-drop, no folder upload
Archive.org's IA-S3 has no "many items in one request" endpoint. The only flyer flow is **one image, fanned out to N items**. The user uses Archive.org's own uploader for everything else. Do not propose otherwise.

### 9. `X-Accept-Reduced-Priority: 1` on batch writes
Drops you in a slower queue instead of getting 429'd. Default for all batch operations.

### 10. Activity log persists across refreshes
Lives in SQLite. The user reviews failed items and re-runs them later. This is critical because partial-fail is normal.

### 11. Sequential, not concurrent
Process items one at a time with `API_DELAY_MS = 1000` between calls. Concurrency would multiply rate-limit pressure and complicate per-item error reporting. Don't add a concurrency knob.

### 12. Use type guards before relying on optional fields
Many Archive.org item fields are inconsistently present. Don't assume `item.subject` is an array — sometimes it's a string, sometimes missing. Always check.

## File Layout

```
src/
├── app/
│   ├── (ui)/
│   │   ├── page.tsx                    # Main app page
│   │   └── layout.tsx
│   └── api/
│       ├── archive/
│       │   ├── search/route.ts
│       │   ├── user-items/route.ts
│       │   ├── update-metadata/route.ts # SSE
│       │   └── metadata/[id]/route.ts
│       ├── upload/
│       │   └── flyer-fanout/route.ts    # SSE — one image to N items
│       ├── youtube/
│       │   ├── channel-cache/route.ts
│       │   ├── match/route.ts
│       │   ├── recording-dates/route.ts # SSE
│       │   ├── tags/route.ts             # SSE
│       │   ├── descriptions/route.ts     # SSE
│       │   └── retry-queue/route.ts
│       ├── auth/youtube/
│       │   ├── route.ts                  # OAuth start
│       │   └── callback/route.ts         # OAuth callback
│       └── activity-log/route.ts
├── components/
│   ├── SearchSection.tsx
│   ├── ItemSelector.tsx
│   ├── editors/
│   │   ├── MetadataEditor.tsx
│   │   ├── BatchImageUpload.tsx
│   │   ├── YouTubeMatcher.tsx
│   │   ├── YouTubeRecordingDateEditor.tsx
│   │   ├── YouTubeTagsSync.tsx
│   │   └── YouTubeDescriptionSync.tsx
│   └── LogViewer.tsx
├── hooks/
│   └── useSSEStream.ts                   # Shared SSE consumer
├── lib/
│   ├── archive/
│   │   ├── client.ts                     # fetch wrappers, headers, auth
│   │   ├── retry.ts                      # retry wrapper with "no changes" handling
│   │   ├── errors.ts                     # type guards
│   │   └── dates.ts                      # standardizeDate, extractDateFromTitle
│   ├── youtube/
│   │   ├── client.ts
│   │   ├── channelCache.ts
│   │   ├── retryQueue.ts
│   │   └── errors.ts
│   ├── flyer/
│   │   └── filename.ts                   # generateFlyerFilename
│   ├── sse.ts                            # server-side SSE helper
│   └── env.ts                            # zod-validated env
├── db/
│   ├── schema.ts                         # drizzle tables
│   ├── client.ts
│   └── migrations/
├── stores/
│   └── ui.ts                             # zustand
└── types.ts
```

## Memory of v1's mistakes (encoded as code rules)

Don't:
- Cram routes in one file (v1's `server/index.ts` was 2,592 lines)
- Cram UI sections in one component (v1's `MetadataEditor.tsx` was 2,705 lines)
- Persist app state in JSON files alongside the source code
- Mix `node:https` and `fetch` (pick one — `fetch`)
- Rely on Vite proxy + cross-port redirects for OAuth (Next.js single-server kills this)
- Ship a "non-streaming twin" of any SSE endpoint (v1 had `/api/batch-upload-image` next to `/api/batch-upload-image-stream` — only the streaming version was ever called)

## How to use the lift list

When implementing a feature, first check [LIFT_LIST.md](./LIFT_LIST.md). If a v1 function is listed there, copy it verbatim from `/Users/allenhsieh/code/archivebatcheditor/<file>:<line>` rather than rewriting from scratch. The lifted code has been validated against real Archive.org and YouTube behavior; rewriting risks losing that knowledge.
