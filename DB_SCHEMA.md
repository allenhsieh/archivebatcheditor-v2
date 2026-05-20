# Database Schema

SQLite via better-sqlite3, schema defined in drizzle. Single file at `./data/app.db` (gitignored).

## Tables

### `youtube_oauth_tokens`

Stores the YouTube OAuth refresh token + most recent access token. v1 kept this in `.youtube-tokens.json`.

```ts
export const youtubeOauthTokens = sqliteTable('youtube_oauth_tokens', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  refreshToken: text('refresh_token').notNull(),
  accessToken: text('access_token'),
  accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp' }),
  scope: text('scope').notNull(),
  revoked: integer('revoked', { mode: 'boolean' }).default(false).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
})
```

Single-row table effectively (one user). On `invalid_grant`, set `revoked = true` and surface re-auth in UI.

### `youtube_retry_queue`

Items pending retry after quota exhaustion or transient failure. v1 kept this in `.youtube-retry-queue.json`.

```ts
export const youtubeRetryQueue = sqliteTable('youtube_retry_queue', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  operationType: text('operation_type', {
    enum: ['recording_date', 'tags', 'description']
  }).notNull(),
  archiveIdentifier: text('archive_identifier').notNull(),
  youtubeVideoId: text('youtube_video_id').notNull(),
  payload: text('payload', { mode: 'json' }).notNull(), // operation-specific args
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  status: text('status', {
    enum: ['pending', 'in_progress', 'failed_terminal', 'auth_expired']
  }).notNull().default('pending'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  nextAttemptAt: integer('next_attempt_at', { mode: 'timestamp' }),
})
```

Drain logic (lifted from v1):
- Process `status = 'pending'` items sequentially
- On `isYouTubeAuthError` → set `status = 'auth_expired'` on this and all remaining; abort drain
- On `isYouTubeQuotaError` → leave status `pending`, abort drain (try again tomorrow)
- On terminal failure → set `status = 'failed_terminal'`, log

### `youtube_channel_cache_videos`

The full list of videos on the user's channel, fetched cheaply via `playlistItems`. v1 kept this in `.youtube-channel-cache.json`.

```ts
export const youtubeChannelCacheVideos = sqliteTable('youtube_channel_cache_videos', {
  videoId: text('video_id').primaryKey(),
  title: text('title').notNull(),
  publishedAt: integer('published_at', { mode: 'timestamp' }).notNull(),
  url: text('url').notNull(),
  // Add an FTS5 index on title for fast local matching (drizzle migration)
})

export const youtubeChannelCacheMeta = sqliteTable('youtube_channel_cache_meta', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  channelId: text('channel_id').notNull(),
  fetchedAt: integer('fetched_at', { mode: 'timestamp' }).notNull(),
})
```

TTL handled in app code (default 24h). Refresh endpoint: `POST /api/youtube/channel-cache/refresh`. See [YOUTUBE_NOTES.md](./YOUTUBE_NOTES.md) for the playlistItems flow.

### `operation_runs`

Groups all activity log entries from a single batch operation. Lets the UI show "this batch had 47 successes, 3 failures" and "re-run the failed items from operation X."

```ts
export const operationRuns = sqliteTable('operation_runs', {
  id: text('id').primaryKey(), // uuid
  operationType: text('operation_type', {
    enum: [
      'metadata_update',
      'flyer_fanout',
      'youtube_recording_date',
      'youtube_tags',
      'youtube_description'
    ]
  }).notNull(),
  startedAt: integer('started_at', { mode: 'timestamp' }).notNull(),
  finishedAt: integer('finished_at', { mode: 'timestamp' }),
  totalItems: integer('total_items').notNull(),
  successfulItems: integer('successful_items').notNull().default(0),
  failedItems: integer('failed_items').notNull().default(0),
  parameters: text('parameters', { mode: 'json' }), // e.g., which fields were updated
})
```

### `activity_log_entries`

Per-item record of every write attempt. v1 kept this in React state — lost on refresh.

```ts
export const activityLogEntries = sqliteTable('activity_log_entries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  operationRunId: text('operation_run_id').notNull().references(() => operationRuns.id),
  identifier: text('identifier').notNull(), // archive.org item id (or youtube video id)
  status: text('status', {
    enum: ['success', 'failure', 'skipped', 'no_change']
  }).notNull(),
  message: text('message'),
  errorCode: text('error_code'),    // e.g., 'NO_CHANGES', 'BAND_TAG_CONFLICT', 'AUTH_EXPIRED'
  errorMessage: text('error_message'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
})
```

Indexes on `operation_run_id`, `identifier`, `status`. The UI's "show me only failures from yesterday's metadata update" query becomes a one-liner.

### `archive_items_cache` (optional)

Cache of the user's Archive.org item list to skip refetching on every page load. Plain TanStack Query handles this in memory; only add a DB table if you want it to survive process restarts.

```ts
// Skip unless TanStack Query's in-memory cache proves insufficient.
```

## Migrations

```bash
npm run db:generate   # drizzle-kit generate
npm run db:migrate    # drizzle-kit migrate
npm run db:studio     # drizzle-kit studio (browse data)
```

Run migrations on app startup in dev. In production, run them as a build step.

## Backup

The DB is a single file. `cp data/app.db data/app.db.backup` is the entire backup procedure. Add to gitignore.
