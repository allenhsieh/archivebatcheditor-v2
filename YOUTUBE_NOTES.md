# YouTube Integration Notes

Domain knowledge collected from building v1. Consult before touching the YouTube integration layer.

## Two API surfaces

YouTube has two distinct APIs we use:

1. **Public Data API v3** with API key (read-only, low quota cost)
2. **OAuth-authorized Data API** (write to your own videos, higher quota cost)

API key calls (1) and OAuth calls (2) consume from the **same daily 10,000-unit quota**.

## Quota math (memorize this)

| Operation | Quota cost | What it does |
|-----------|------------|--------------|
| `search` | **100** | DO NOT USE — too expensive |
| `playlistItems.list` | **1** per page (50 items/page) | Cheap channel video list |
| `videos.list` | **1** per video | Get full video metadata |
| `videos.update` | **50** | Update recording date or other metadata |
| `videos.update` (with tags) | **51** (list + update) | Tag updates |

10,000 / 100 = **100 search calls per day** — this is why search is banned.
10,000 / 50 = **200 writes per day** — your real ceiling.
A 638-video channel cache costs **~13 quota units total** (638 / 50 = 13 pages).

## Channel cache approach (replaces search)

Instead of searching YouTube every time we want to match an Archive.org item to a video, we cache the entire channel video list once a day.

```ts
async function fetchAndCacheChannelVideos(): Promise<void> {
  const uploadsPlaylistId = channelIdToUploadsPlaylistId(YOUTUBE_CHANNEL_ID)
  // Convert UC... → UU...
  
  let pageToken: string | undefined
  const videos: CachedVideo[] = []
  
  do {
    const url = new URL('https://www.googleapis.com/youtube/v3/playlistItems')
    url.searchParams.set('key', YOUTUBE_API_KEY)
    url.searchParams.set('playlistId', uploadsPlaylistId)
    url.searchParams.set('part', 'snippet')
    url.searchParams.set('maxResults', '50')
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    
    const res = await fetch(url)
    const data = await res.json()
    
    for (const item of data.items) {
      videos.push({
        videoId: item.snippet.resourceId.videoId,
        title: item.snippet.title,
        publishedAt: new Date(item.snippet.publishedAt),
        url: `https://youtu.be/${item.snippet.resourceId.videoId}`,
      })
    }
    
    pageToken = data.nextPageToken
  } while (pageToken)
  
  // Persist all videos to youtube_channel_cache_videos table (replace, not merge)
  await db.transaction(async (tx) => {
    await tx.delete(youtubeChannelCacheVideos)
    await tx.insert(youtubeChannelCacheVideos).values(videos)
    await tx.insert(youtubeChannelCacheMeta).values({
      channelId: YOUTUBE_CHANNEL_ID,
      fetchedAt: new Date(),
    })
  })
}
```

**Channel ID → uploads playlist ID trick**: Replace the second character of `UC...` with `U` to get `UU...`. That playlist contains every uploaded video.

## Local matching

Once cached, matching an Archive.org item to a YouTube video is free:

```ts
function matchArchiveItemToVideo(
  cache: CachedVideo[],
  archiveTitle: string,
  archiveDate?: string,
): CachedVideo | null {
  // Score each video by title similarity + date proximity
  // (port the scoring function from v1's `scoreVideoAgainstQuery`)
}
```

Even better: when a match is confirmed, write the YouTube video URL into the Archive.org item's `youtube` metadata field so future operations don't need to re-match.

## Alternatives to the Data API for reads

For the read path (getting video titles + dates), you don't need the Data API at all:

- **YouTube RSS feed**: `https://www.youtube.com/feeds/videos.xml?channel_id=<UC...>` — returns the latest 15 videos, no key required, no quota
- **`yt-dlp --flat-playlist <channel-url>`** — returns the full channel video list, free, but adds a Python dependency

For this app: the Data API channel cache is fine because it costs ~13 units/day (well under quota) and avoids the Python dependency. Keep RSS / yt-dlp in mind only if quota becomes a problem.

## OAuth flow

Required for write operations (recording date updates, tag updates, description updates). Read operations work with just the API key.

Routes:
- `GET /api/auth/youtube` — generates Google authorize URL with `access_type=offline&prompt=consent`, redirects user to it
- `GET /api/auth/youtube/callback?code=...` — exchanges code for refresh + access token, persists to `youtube_oauth_tokens`, redirects to `/?youtube_auth=success`
- `GET /api/auth/youtube/status` — returns `{ authenticated, expiresAt? }`

Use the `googleapis` Node library — it handles automatic access-token refresh from the refresh token.

## `invalid_grant` handling — abort, don't retry

If the YouTube API returns `invalid_grant`, the refresh token has been revoked or expired. **No further API calls will succeed until the user re-authorizes.** v1 was not handling this and would burn 31 retry attempts in a row, all failing.

Detection (port from v1):

```ts
export function isYouTubeAuthError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const msg = error.message.toLowerCase()
  return msg.includes('invalid_grant') || msg.includes('token has been expired or revoked')
}
```

When detected anywhere in a batch operation:
1. Mark the OAuth token row as `revoked = true`
2. Mark all remaining queued items in this batch (and the retry queue) as `status = 'auth_expired'`
3. Surface "Re-authorize YouTube" CTA in the UI
4. Do NOT increment retry counts on `auth_expired` items — they're not retryable until re-auth happens

## Quota exhaustion handling

When the Data API returns 403 with `quotaExceeded`:
1. Stop the current batch immediately (continuing would just produce more errors)
2. Surface "YouTube quota exhausted, resets midnight Pacific" to the UI
3. Move remaining items to the retry queue with `status = 'pending'`

Detection (port from v1):

```ts
import { isApiError } from '@/lib/archive/errors'

export function isYouTubeQuotaError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  const status = isApiError(error) ? (error.status ?? error.response?.status) : undefined
  return status === 403 ||
    message.includes('quota') ||
    message.includes('exceeded your quota')
}
```

## Retry queue drain logic (v1-tested pattern)

```ts
async function drainRetryQueue() {
  const pending = await db.select().from(youtubeRetryQueue)
    .where(eq(youtubeRetryQueue.status, 'pending'))
  
  console.log(`Retry queue: ${pending.length} item(s) pending, attempting drain...`)
  
  let succeeded = 0, failed = 0, authExpired = false, quotaHit = false
  
  for (const item of pending) {
    if (authExpired || quotaHit) {
      console.log(`⏸️  Skipping ${item.archiveIdentifier}: ${authExpired ? 'auth expired' : 'quota exhausted'}`)
      continue
    }
    
    try {
      await applyRetryItem(item)
      console.log(`✅ Drained ${item.archiveIdentifier}`)
      await db.delete(youtubeRetryQueue).where(eq(youtubeRetryQueue.id, item.id))
      succeeded++
    } catch (error) {
      if (isYouTubeAuthError(error)) {
        console.log(`🔑 Auth expired during drain — aborting`)
        await db.update(youtubeRetryQueue)
          .set({ status: 'auth_expired', lastError: 'invalid_grant' })
          .where(or(eq(youtubeRetryQueue.id, item.id), eq(youtubeRetryQueue.status, 'pending')))
        authExpired = true
      } else if (isYouTubeQuotaError(error)) {
        console.log(`📊 Quota exhausted during drain — aborting (will retry later)`)
        quotaHit = true
      } else {
        console.log(`❌ Failed ${item.archiveIdentifier}: ${error}`)
        await db.update(youtubeRetryQueue)
          .set({
            attempts: item.attempts + 1,
            lastError: String(error),
            status: item.attempts + 1 >= 5 ? 'failed_terminal' : 'pending',
          })
          .where(eq(youtubeRetryQueue.id, item.id))
        failed++
      }
    }
  }
  
  const remaining = await db.select({ count: count() }).from(youtubeRetryQueue)
    .where(eq(youtubeRetryQueue.status, 'pending'))
  
  console.log(`Drain done: ${succeeded} succeeded, ${failed} failed, ${remaining[0].count} remaining`)
}
```

Key points:
- One drain attempt per invocation. Don't loop trying again — let the user trigger or schedule.
- Abort cleanly on auth or quota errors. Don't keep trying.
- Use descriptive per-item logs (✅ / ❌ / ⏸️ / 🔑 / 📊).

## Write operations available

| Operation | Endpoint | Quota | Notes |
|-----------|----------|-------|-------|
| Recording date | `videos.update?part=recordingDetails` | 50 | Sets `recordingDetails.recordingDate` |
| Tags | `videos.update?part=snippet` | 50 + `videos.list` 1 | Must merge with existing tags (case-insensitive dedupe), respect 500-char limit |
| Description | `videos.update?part=snippet` | 50 + `videos.list` 1 | Must preserve title (snippet update requires it) |

The location half of YouTube Studio's "Recording date and location" is **not writable** via the public API — deprecated since 2017. Don't try.

## Required env vars

```bash
YOUTUBE_API_KEY=...                 # Data API key (read operations + channel cache)
YOUTUBE_CHANNEL_ID=UC...            # User's channel ID
YOUTUBE_CLIENT_ID=...               # OAuth client (write operations)
YOUTUBE_CLIENT_SECRET=...
YOUTUBE_REDIRECT_URI=http://localhost:3000/api/auth/youtube/callback
```

## What's optional

The entire YouTube integration is optional. If `YOUTUBE_API_KEY` is missing, all YouTube features should gracefully disable in the UI with a helpful "set YOUTUBE_API_KEY to enable." The Archive.org core features must still work.
