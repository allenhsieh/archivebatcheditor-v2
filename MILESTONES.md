# Milestones

The build plan, in order. Each milestone is a clean session boundary — commit, then start a fresh Claude session for the next one. This keeps context windows healthy and makes each milestone independently reviewable.

## Milestone 0: Repo scaffold

**Goal**: New repo runs `npm run dev` and serves an empty Next.js page.

- Create new repo (already done if you're reading this)
- Copy `rebuild-bootstrap/` contents to repo root
- `npx create-next-app@latest . --typescript --app --tailwind --eslint`
- Add deps: `better-sqlite3`, `drizzle-orm`, `drizzle-kit`, `@tanstack/react-query`, `zustand`, `zod`, `googleapis`, `google-auth-library`
- Add devDeps: `vitest`, `@playwright/test`, `prettier`, `tsx`
- Set up `.env.example` with all vars from `CLAUDE.md`
- Set up Zod-validated env loader at `src/lib/env.ts`
- Configure path aliases (`@/lib`, `@/components`, etc.)
- Wire up Prettier + ESLint to match v1's zero-warnings policy
- `.gitignore`: `data/`, `.env`, `node_modules/`, `.next/`, `playwright-report/`

**Acceptance**: `npm run dev` opens `localhost:3000` to a placeholder page. `npm run type-check`, `npm run lint`, `npm test` (with one trivial test) all pass.

## Milestone 1: Database + activity log foundation

**Goal**: SQLite is set up, all tables defined, activity log can be written and read.

- Create drizzle schema files per [DB_SCHEMA.md](./DB_SCHEMA.md)
- Generate and run initial migration
- `src/db/client.ts` — singleton DB instance with WAL mode enabled
- `src/lib/activityLog.ts` — write/read helpers for `operation_runs` + `activity_log_entries`
- One smoke test that creates an operation_run, writes 3 activity_log_entries, queries them back

**Acceptance**: Smoke test passes. `npm run db:studio` opens drizzle studio with all tables visible.

## Milestone 2: Archive.org client + error handling foundation

**Goal**: All Archive.org-talking code lives in one well-tested module. Type guards in place.

- Lift type guards (`isApiError`, `isRateLimitError`) per [LIFT_LIST.md](./LIFT_LIST.md)
- Lift `ArchiveApiResult` / `ApiError` types
- Lift `standardizeDate`, `extractDateFromTitle`, `extractBandFromTitle`, `extractVenueFromTitle` and their tests
- Build `src/lib/archive/client.ts` with:
  - `searchItems(query, fields, rows)`
  - `getItemMetadata(identifier)`
  - `updateMetadata(identifier, jsonPatch)` with retry wrapper
  - The `"no changes to _meta.xml"` success early-return
- All requests use `fetch`, set `X-Accept-Reduced-Priority: 1` on writes
- All env vars validated; missing creds throw at module-load

**Acceptance**: Lifted tests for utilities pass. Manual smoke: `npx tsx scripts/smoke-archive.ts` searches for the user's items and prints the count.

## Milestone 3: Items list UI

**Goal**: User can search Archive.org, see their items in a multi-select grid.

- `src/app/api/archive/search/route.ts` — wraps `searchItems`
- `src/app/api/archive/user-items/route.ts` — searches by `uploader:<email>`
- `src/components/SearchSection.tsx` — search input
- `src/components/ItemSelector.tsx` — multi-select grid with per-item status badges
- `src/stores/ui.ts` — Zustand store with `selectedIdentifiers: Set<string>`
- TanStack Query for data fetching + caching
- Tailwind for styling (no inline styles)

**Acceptance**: Open the app, click "Load my items," see your Archive.org collection. Select items, see selection count.

## Milestone 4: Bulk metadata update with SSE + partial-success handling

**Goal**: Select N items, update a metadata field across all of them, see per-item progress, see persistent activity log.

- `src/lib/sse.ts` — server-side SSE helper using `ReadableStream`
- `src/hooks/useSSEStream.ts` — client-side consumer (lift the buffer-parsing pattern from v1)
- `src/app/api/archive/update-metadata/route.ts` — SSE endpoint, sequential per-item, per-item try/catch
- `src/components/editors/MetadataEditor.tsx` — field picker, value input, "Update N items" button
- `src/components/LogViewer.tsx` — activity log with filter by status + "retry failed items" affordance
- Each batch creates an `operation_runs` row; each item creates an `activity_log_entries` row
- "no_change" status displayed distinctly from "success"

**Acceptance**: Update a low-stakes field (e.g., add a test subject tag) across 5 items. See per-item progress. Refresh the page — activity log persists. Trigger a deliberate failure (e.g., put junk in a numeric field), confirm UI shows the per-item error.

## Milestone 5: Flyer fanout

**Goal**: Upload one image, fan it out as cover/thumbnail to N selected items.

- Lift `generateFlyerFilename` and tests per LIFT_LIST.md
- `src/app/api/upload/flyer-fanout/route.ts` — SSE endpoint, sequential per-item PUT to IA-S3
  - Headers: `Authorization: LOW`, `x-amz-auto-make-bucket: 1`, `x-archive-queue-derive: 0`, `X-Accept-Reduced-Priority: 1`, `x-archive-meta-*`
  - **Verify empirically that `x-archive-queue-derive: 0` actually suppresses derivatives** before declaring milestone done. If it doesn't, add the v1 `_rules.conf` fallback.
- Server-side file size limit (10MB) matching the client's
- `src/components/editors/BatchImageUpload.tsx` — file picker (single file, JPEG/PNG/GIF/WebP), confirm dialog, upload button, SSE progress
- Persist results to activity log

**Acceptance**: Upload one flyer, confirm it appears as the cover on all selected items, confirm Archive.org didn't generate derivatives. Test a deliberate failure (bad credentials in one item's bucket) and confirm partial-success behavior.

## Milestone 6: YouTube OAuth + channel cache

**Goal**: User can authorize YouTube once; channel video list is cached locally.

- `src/app/api/auth/youtube/route.ts` — generates Google authorize URL, redirects
- `src/app/api/auth/youtube/callback/route.ts` — exchanges code for tokens, persists to `youtube_oauth_tokens`, redirects to `/?youtube_auth=success`
- `src/app/api/auth/youtube/status/route.ts` — returns auth state
- `src/lib/youtube/client.ts` — wraps `googleapis` with auto-refresh, throws on `invalid_grant`
- Lift `isYouTubeAuthError`, `isYouTubeQuotaError`
- `src/lib/youtube/channelCache.ts` — `fetchAndCacheChannelVideos()` paginates `playlistItems`, persists to DB
- `src/app/api/youtube/channel-cache/refresh/route.ts` — POST triggers refresh
- `src/app/api/youtube/channel-cache/status/route.ts` — GET returns count + last-fetched
- UI: "Re-authorize YouTube" CTA when token revoked

**Acceptance**: Click "Sign in with YouTube," complete OAuth, see "connected." Click "Refresh channel cache," see ~13 quota units consumed (or whatever's appropriate for the channel size), see all videos in DB. Revoke at myaccount.google.com/permissions, confirm UI surfaces the re-auth CTA on next operation.

## Milestone 7: YouTube matching

**Goal**: For each selected Archive.org item, find the best YouTube video match from the cache.

- Lift `searchChannelCache` / `scoreVideoAgainstQuery`
- `src/app/api/youtube/match/route.ts` — given identifiers, returns matches from cache
- `src/components/editors/YouTubeMatcher.tsx` — shows matches, lets user accept/reject, "Add YouTube Links" button writes URL to Archive.org `youtube` field
- The local match is FREE (no API quota) since cache is local

**Acceptance**: Select 5 items, click "Find YouTube Matches," see matches. Click "Add YouTube Links" — confirm `youtube` field appears on items in Archive.org.

## Milestone 8: YouTube write operations

**Goal**: Push recording date, tags, and descriptions from Archive.org items to matched YouTube videos.

- `src/app/api/youtube/recording-dates/route.ts` — SSE, batch updates `recordingDetails.recordingDate`
- `src/app/api/youtube/tags/route.ts` — SSE, batch updates tags (must merge with existing, dedupe case-insensitive, respect 500-char limit)
- `src/app/api/youtube/descriptions/route.ts` — SSE, batch push/pull descriptions
- All three: sequential per-item, per-item try/catch, on `isYouTubeAuthError` or `isYouTubeQuotaError` abort batch and move remaining to retry queue
- `src/lib/youtube/retryQueue.ts` — drain logic per [YOUTUBE_NOTES.md](./YOUTUBE_NOTES.md)
- `src/app/api/youtube/retry-queue/route.ts` — GET status
- `src/app/api/youtube/retry-queue/drain/route.ts` — POST triggers drain
- UI components for each editor

**Acceptance**: Update recording date on a few items, confirm in YouTube Studio. Force a quota exhaustion (or simulate), confirm items move to retry queue, confirm drain works after quota resets.

## Milestone 9: Polish

**Goal**: The app feels finished.

- Activity log filters: by status, by date, by operation type
- "Re-run failed items from this batch" — one-click affordance
- Dry-run mode for metadata updates: show diff, don't apply
- HEIC support in flyer upload validator
- Loading states + error toasts everywhere
- Keyboard shortcuts for select-all, deselect-all
- E2E tests with Playwright covering: load items, select, update metadata, see activity log persist across refresh, OAuth flow

**Acceptance**: Daily-driver quality. The user can do a typical session (load items, select, update, fanout flyer, sync to YouTube) without hitting friction.

## Out of scope (do not build)

- General file uploader / drag-drop multi-file
- Old-version retention for flyers
- Multi-target atomic metadata writes
- Concurrency knob for batch operations
- Multi-user / hosted version
- Dark/light mode toggle (Tailwind defaults are fine)
- Mobile-responsive (desktop-only is fine for this user)
- Export / import collection backups (Archive.org IS the backup)

## Time estimate

With Sonnet pair-programming and pre-existing v1 code to reference:

| Milestone | Estimate |
|-----------|----------|
| 0. Scaffold | 30 min |
| 1. DB foundation | 1 hr |
| 2. Archive.org client | 2 hr |
| 3. Items list UI | 2 hr |
| 4. Bulk metadata update + SSE | 4 hr |
| 5. Flyer fanout | 2 hr |
| 6. YouTube OAuth + cache | 3 hr |
| 7. YouTube matching | 2 hr |
| 8. YouTube writes | 4 hr |
| 9. Polish | open-ended |

Total foundation: ~20 hours. Spread across multiple sessions, with commits between milestones.
