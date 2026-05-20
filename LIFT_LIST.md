# Lift List

Code from the v1 repo (at `/Users/allenhsieh/code/archivebatcheditor`) that should be **copied verbatim** into the rebuild rather than rewritten. Each item has been validated against real Archive.org / YouTube behavior; rewriting risks losing that knowledge.

When you start a milestone, check this list. If a function you need is here, port it before writing new code.

## Pure utilities (high confidence, lift as-is)

### `standardizeDate`
- **From**: `server/utils.ts:18`
- **To**: `src/lib/archive/dates.ts`
- **Why lift**: handles 7+ date formats including the user's actual filename convention (`DD.MM.YY`)
- **Tests to lift**: matching cases from `tests/utils.test.ts`

### `extractDateFromTitle`
- **From**: `server/utils.ts:129`
- **To**: `src/lib/archive/dates.ts`
- **Why lift**: paired with `standardizeDate`; tested for various title formats
- **Quirk to preserve**: dotted dates like `12.03.14` are interpreted as **DD.MM.YY** (so `12.03.14` → `2014-03-12`), NOT MM.DD.YY. v1 has a misleading inline comment that says "MM.DD.YY" but the implementation and tests agree on DD.MM.YY — this matches the user's filename convention. When porting, fix the comment but keep the behavior. Verify against `tests/utils.test.ts` cases before changing anything.

### `extractBandFromTitle`
- **From**: `server/utils.ts:76`
- **To**: `src/lib/archive/text.ts`
- **Why lift**: heuristics tuned to user's title conventions

### `extractVenueFromTitle`
- **From**: `server/utils.ts:103`
- **To**: `src/lib/archive/text.ts`
- **Why lift**: same as above

### `generateFlyerFilename`
- **From**: `server/utils.ts:268`
- **To**: `src/lib/flyer/filename.ts`
- **Why lift**: encodes the `{YYYY-MM-DD}-flyer_itemimage.{ext}` convention with the multi-source date fallback chain. Critical for the flyer fanout feature.
- **Dependencies**: `standardizeDate`, `extractDateFromTitle`

### `standardizeYouTubeUrl`
- **From**: `server/utils.ts:238`
- **To**: `src/lib/youtube/urls.ts`
- **Why lift**: normalizes the many YouTube URL formats to `https://youtu.be/<id>`

### `createYouTubeUrl`
- **From**: `server/utils.ts:230`
- **To**: `src/lib/youtube/urls.ts`

### `buildArchiveSearchUrl`
- **From**: `server/utils.ts:191`
- **To**: `src/lib/archive/client.ts` (inline as a helper)

### `buildArchiveMetadataUrl`
- **From**: `server/utils.ts:207`
- **To**: `src/lib/archive/client.ts`

## Type guards (port verbatim)

### `isApiError`
- **From**: `src/types.ts:96`
- **To**: `src/lib/archive/errors.ts`
- **Depends on**: `ArchiveApiResult` interface (also lift, see below)

### `isYouTubeAuthError`
- **From**: `server/utils.ts:168`
- **To**: `src/lib/youtube/errors.ts`
- **Why lift**: detects `invalid_grant` exactly the way YouTube reports it

### `isYouTubeQuotaError`
- **From**: `server/utils.ts:177`
- **To**: `src/lib/youtube/errors.ts`

### `isRateLimitError`
- **From**: `server/utils.ts:153`
- **To**: `src/lib/archive/errors.ts`

## Type definitions

### `ArchiveApiResult`, `ApiError`
- **From**: `src/types.ts:78-94`
- **To**: `src/lib/archive/errors.ts`

### `ArchiveItem`, `MetadataUpdate`, `UpdateRequest`
- **From**: `src/types.ts:1-32`
- **To**: `src/types.ts`

### `YouTubeMatch`, `YouTubeSuggestionResponse`
- **From**: `src/types.ts:41-68`
- **To**: `src/types.ts`

## Logic to port (translate, don't lift verbatim — context changes)

### Retry wrapper with "no changes" early-return
- **From**: `server/index.ts:makeArchiveApiCall` (search the file for the function)
- **To**: `src/lib/archive/retry.ts`
- **Critical detail**: when error is `"no changes to _meta.xml"`, return `{ success: true, noChanges: true }` immediately — do NOT retry. Treat as success in the caller. Log to activity_log_entries with `status = 'no_change'`.

### YouTube channel cache: `fetchAndCacheChannelVideos`
- **From**: `server/index.ts` (search for `fetchAndCacheChannelVideos`)
- **To**: `src/lib/youtube/channelCache.ts`
- **Adapt**: replace JSON-file persistence with drizzle inserts into `youtube_channel_cache_videos`
- **Keep**: the `playlistItems` paging logic, the `UC` → `UU` conversion, the cache TTL pattern

### YouTube channel cache: `searchChannelCache` / `scoreVideoAgainstQuery`
- **From**: `server/index.ts` (search by name)
- **To**: `src/lib/youtube/match.ts`
- **Adapt**: query the DB instead of an in-memory JSON list

### Retry queue drain logic
- **From**: `server/index.ts:drainRetryQueue`
- **To**: `src/lib/youtube/retryQueue.ts`
- **Adapt**: file-based queue → DB table. The control flow (abort on auth/quota errors, increment attempts on transient errors) stays exactly the same. See [YOUTUBE_NOTES.md](./YOUTUBE_NOTES.md) for the canonical pattern.

### SSE event emitter
- **From**: `server/index.ts` (`sendProgress` helper inside route handlers)
- **To**: `src/lib/sse.ts` (one shared helper)
- **Event shape**: see ARCHITECTURE.md "SSE event contract"

### Flyer upload route logic
- **From**: `server/index.ts:1545` (`POST /api/batch-upload-image-stream`)
- **To**: `src/app/api/upload/flyer-fanout/route.ts`
- **Adapt**:
  - Replace the second `_rules.conf` PUT with a `x-archive-queue-derive: 0` header on the main upload PUT (verify empirically first — see ARCHIVE_ORG_NOTES.md)
  - Keep the per-item try/catch pattern unchanged
  - Keep the `generateFlyerFilename` invocation
  - Persist results to `activity_log_entries`

### Frontend SSE consumption pattern
- **From**: `src/components/MetadataEditor.tsx:2104-2150` (the `while (true) { reader.read() }` loop with buffer parsing)
- **To**: `src/hooks/useSSEStream.ts` (one shared hook)
- **Why lift**: the buffer parsing handles incomplete SSE messages correctly; reuse it.

## Tests to port

### `tests/flyer-upload.test.ts`
- **To**: `tests/api/upload-flyer-fanout.test.ts`
- **Why lift**: golden source for the SSE event contract; covers happy path, multi-item, missing file, missing metadata, Archive.org error response

### `tests/server-integration.test.ts`
- **To**: split across `tests/api/*` per route
- **Critical case**: the "no changes to _meta.xml" → success regression test

### `tests/utils.test.ts`
- **To**: split into `tests/lib/archive/dates.test.ts`, `tests/lib/archive/errors.test.ts`, `tests/lib/youtube/errors.test.ts`
- **Critical cases**: `standardizeDate` for every date format, `isYouTubeAuthError` cases

### `tests/archive-auth-regression.test.ts`
- **To**: `tests/lib/archive/auth.test.ts`
- **Why lift**: prevents reintroducing past auth bugs

### `tests/add-before-replace.test.ts`
- **To**: `tests/lib/archive/patches.test.ts`
- **Why lift**: covers the JSON-Patch ordering quirk where `add` must precede `replace` for some Archive.org fields

## Things NOT to lift

These were either dead code, broken, or replaced by the new architecture:

- **`/api/batch-upload-image`** (the non-streaming twin in `server/index.ts:1758`) — never called by frontend; delete from v1's mental model
- **`FRONTEND_URL` env var workaround** for OAuth callback — Next.js single-server eliminates this entirely
- **The 411-line `useArchive.ts` god-hook** — replaced by TanStack Query + Zustand
- **Inline `style={{...}}` props** throughout `MetadataEditor.tsx` — replaced by Tailwind
- **`node:https` direct calls** — replaced by `fetch` everywhere
- **`.youtube-tokens.json` / `.youtube-retry-queue.json` / `.youtube-channel-cache.json` file persistence** — replaced by SQLite tables
- **`_rules.conf` `CAT.ALL` upload** — replaced by `x-archive-queue-derive: 0` header (after empirical verification)
- **`x-archive-keep-old-version`** if it appears anywhere — user does not want version retention
- **The Python `archive-metadata-tools/` directory** — out of scope for the Node app; reimplement as TS scripts in `scripts/` if needed later

## How to do a port

1. Open both repos side-by-side
2. Read the v1 source for the function you're lifting
3. Read its tests in v1's `tests/`
4. Copy the function and its tests to the new repo
5. Adjust imports, types, and persistence layer (file → DB) as needed
6. Run the ported tests, fix until green
7. Then build the new code that calls it
