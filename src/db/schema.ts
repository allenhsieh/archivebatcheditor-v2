import { sqliteTable, integer, text, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const youtubeOauthTokens = sqliteTable('youtube_oauth_tokens', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  refreshToken: text('refresh_token').notNull(),
  accessToken: text('access_token'),
  accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp' }),
  scope: text('scope').notNull(),
  revoked: integer('revoked', { mode: 'boolean' }).default(false).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const youtubeRetryQueue = sqliteTable('youtube_retry_queue', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  operationType: text('operation_type', {
    enum: ['recording_date', 'tags', 'description'],
  }).notNull(),
  archiveIdentifier: text('archive_identifier').notNull(),
  youtubeVideoId: text('youtube_video_id').notNull(),
  payload: text('payload', { mode: 'json' })
    .notNull()
    .$type<Record<string, unknown>>(),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  status: text('status', {
    enum: ['pending', 'in_progress', 'failed_terminal', 'auth_expired'],
  })
    .notNull()
    .default('pending'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  nextAttemptAt: integer('next_attempt_at', { mode: 'timestamp' }),
});

export const youtubeChannelCacheVideos = sqliteTable(
  'youtube_channel_cache_videos',
  {
    videoId: text('video_id').primaryKey(),
    title: text('title').notNull(),
    publishedAt: integer('published_at', { mode: 'timestamp' }).notNull(),
    url: text('url').notNull(),
    // Stored so bulk find/replace on descriptions can run client-side without
    // re-querying YouTube. Pulled from playlistItems.snippet.description (free,
    // same quota as the rest of the cache build).
    description: text('description'),
  }
);

export const youtubeChannelCacheMeta = sqliteTable('youtube_channel_cache_meta', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  channelId: text('channel_id').notNull(),
  fetchedAt: integer('fetched_at', { mode: 'timestamp' }).notNull(),
});

export const operationRuns = sqliteTable('operation_runs', {
  id: text('id').primaryKey(),
  operationType: text('operation_type', {
    enum: [
      'metadata_update',
      'flyer_fanout',
      'youtube_recording_date',
      'youtube_tags',
      'youtube_description',
    ],
  }).notNull(),
  startedAt: integer('started_at', { mode: 'timestamp' }).notNull(),
  finishedAt: integer('finished_at', { mode: 'timestamp' }),
  totalItems: integer('total_items').notNull(),
  successfulItems: integer('successful_items').notNull().default(0),
  noChangeItems: integer('no_change_items').notNull().default(0),
  failedItems: integer('failed_items').notNull().default(0),
  parameters: text('parameters', { mode: 'json' }).$type<Record<string, unknown>>(),
});

export const activityLogEntries = sqliteTable(
  'activity_log_entries',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    operationRunId: text('operation_run_id')
      .notNull()
      .references(() => operationRuns.id),
    identifier: text('identifier').notNull(),
    status: text('status', {
      enum: ['success', 'failure', 'skipped', 'no_change'],
    }).notNull(),
    message: text('message'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    index('ale_operation_run_id_idx').on(table.operationRunId),
    index('ale_identifier_idx').on(table.identifier),
    index('ale_status_idx').on(table.status),
  ]
);
