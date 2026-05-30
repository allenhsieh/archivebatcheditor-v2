import { eq, and } from 'drizzle-orm';
import { db } from '@/db/client';
import { youtubeRetryQueue } from '@/db/schema';
import { getAuthenticatedYouTubeClient, markTokenRevoked } from './client';
import { isYouTubeAuthError, isYouTubeQuotaError } from './errors';

type RetryRow = typeof youtubeRetryQueue.$inferSelect;
type YouTubeClient = Awaited<ReturnType<typeof getAuthenticatedYouTubeClient>>;
type OperationType = typeof youtubeRetryQueue.$inferInsert['operationType'];

export function enqueueForRetry(
  item: {
    operationType: OperationType;
    archiveIdentifier: string;
    youtubeVideoId: string;
    payload: Record<string, unknown>;
  },
  lastError?: string
): void {
  const existing = db
    .select()
    .from(youtubeRetryQueue)
    .where(
      and(
        eq(youtubeRetryQueue.operationType, item.operationType),
        eq(youtubeRetryQueue.youtubeVideoId, item.youtubeVideoId)
      )
    )
    .get();

  if (existing) {
    db.update(youtubeRetryQueue)
      .set({
        archiveIdentifier: item.archiveIdentifier,
        payload: item.payload,
        attempts: existing.attempts + 1,
        lastError: lastError ?? null,
        status: 'pending',
      })
      .where(eq(youtubeRetryQueue.id, existing.id))
      .run();
  } else {
    db.insert(youtubeRetryQueue)
      .values({
        operationType: item.operationType,
        archiveIdentifier: item.archiveIdentifier,
        youtubeVideoId: item.youtubeVideoId,
        payload: item.payload,
        attempts: 0,
        lastError: lastError ?? null,
        status: 'pending',
      })
      .run();
  }
}

export function removeFromRetryQueue(operationType: OperationType, youtubeVideoId: string): void {
  db.delete(youtubeRetryQueue)
    .where(
      and(
        eq(youtubeRetryQueue.operationType, operationType),
        eq(youtubeRetryQueue.youtubeVideoId, youtubeVideoId)
      )
    )
    .run();
}

export function getRetryQueueStatus(): {
  pending: number;
  failed_terminal: number;
  auth_expired: number;
} {
  const all = db.select().from(youtubeRetryQueue).all();
  return {
    pending: all.filter((r) => r.status === 'pending').length,
    failed_terminal: all.filter((r) => r.status === 'failed_terminal').length,
    auth_expired: all.filter((r) => r.status === 'auth_expired').length,
  };
}

function extractStringField(payload: Record<string, unknown>, key: string): string | undefined {
  const v = payload[key];
  return typeof v === 'string' ? v : undefined;
}

function extractStringArray(payload: Record<string, unknown>, key: string): string[] {
  const v = payload[key];
  if (!Array.isArray(v)) return [];
  return v.filter((t): t is string => typeof t === 'string');
}

async function applyRetryItem(
  youtube: YouTubeClient,
  item: RetryRow
): Promise<{ ok: true } | { ok: false; quotaExceeded?: boolean; authExpired?: boolean; error?: string }> {
  try {
    if (item.operationType === 'recording_date') {
      const recordingDate = extractStringField(item.payload, 'recordingDate');
      if (!recordingDate) return { ok: false, error: 'Missing recordingDate in queued item' };
      await youtube.videos.update({
        part: ['recordingDetails'],
        requestBody: { id: item.youtubeVideoId, recordingDetails: { recordingDate } },
      });
      return { ok: true };
    }

    if (item.operationType === 'tags') {
      const tags = extractStringArray(item.payload, 'tags');
      const listRes = await youtube.videos.list({ part: ['snippet'], id: [item.youtubeVideoId] });
      const existing = listRes.data.items?.[0]?.snippet;
      if (!existing) return { ok: false, error: 'Video not found or not owned by authenticated account' };

      const mergedTags: string[] = [];
      const seen = new Set<string>();
      for (const tag of [...(existing.tags ?? []), ...tags]) {
        const clean = tag.trim();
        if (!clean) continue;
        const key = clean.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        mergedTags.push(clean);
      }
      while (mergedTags.join(', ').length > 500 && mergedTags.length > 1) mergedTags.pop();

      await youtube.videos.update({
        part: ['snippet'],
        requestBody: {
          id: item.youtubeVideoId,
          snippet: {
            title: existing.title ?? '',
            categoryId: existing.categoryId ?? '10',
            description: existing.description ?? '',
            defaultLanguage: existing.defaultLanguage ?? undefined,
            tags: mergedTags,
          },
        },
      });
      return { ok: true };
    }

    if (item.operationType === 'description') {
      const description = extractStringField(item.payload, 'description') ?? '';
      const listRes = await youtube.videos.list({ part: ['snippet'], id: [item.youtubeVideoId] });
      const existing = listRes.data.items?.[0]?.snippet;
      if (!existing) return { ok: false, error: 'Video not found or not owned by authenticated account' };

      await youtube.videos.update({
        part: ['snippet'],
        requestBody: {
          id: item.youtubeVideoId,
          snippet: {
            title: existing.title ?? '',
            categoryId: existing.categoryId ?? '10',
            description,
            defaultLanguage: existing.defaultLanguage ?? undefined,
            tags: existing.tags ?? [],
          },
        },
      });
      return { ok: true };
    }

    return { ok: false, error: `Unknown operation type: ${item.operationType}` };
  } catch (error) {
    if (isYouTubeAuthError(error)) return { ok: false, authExpired: true };
    if (isYouTubeQuotaError(error)) return { ok: false, quotaExceeded: true };
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export interface DrainSummary {
  attempted: number;
  succeeded: number;
  failed: number;
  remaining: number;
  quotaHit: boolean;
  authExpired: boolean;
}

export async function drainRetryQueue(): Promise<DrainSummary> {
  const authExpiredCount = db
    .select()
    .from(youtubeRetryQueue)
    .where(eq(youtubeRetryQueue.status, 'auth_expired'))
    .all().length;

  const initialPending = db
    .select()
    .from(youtubeRetryQueue)
    .where(eq(youtubeRetryQueue.status, 'pending'))
    .all();

  const summary: DrainSummary = {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    remaining: initialPending.length + authExpiredCount,
    quotaHit: false,
    authExpired: false,
  };

  if (initialPending.length === 0 && authExpiredCount === 0) return summary;

  let youtube: YouTubeClient;
  try {
    youtube = await getAuthenticatedYouTubeClient();
  } catch {
    console.warn('Retry queue: YouTube not authenticated, skipping drain');
    return summary;
  }

  // Auth is valid — reset any items blocked on a previous auth failure so they
  // get picked up in this drain.
  const resetCount = db
    .update(youtubeRetryQueue)
    .set({ status: 'pending', lastError: null })
    .where(eq(youtubeRetryQueue.status, 'auth_expired'))
    .run().changes;
  if (resetCount > 0) {
    console.log(`♻️  Reset ${resetCount} auth_expired item(s) to pending`);
  }

  // Re-fetch so auth_expired items (now pending) are included.
  const pending = db
    .select()
    .from(youtubeRetryQueue)
    .where(eq(youtubeRetryQueue.status, 'pending'))
    .all();
  summary.remaining = pending.length;

  console.log(`♻️  Retry queue: ${pending.length} item(s) pending, starting drain...`);

  for (const item of pending) {
    if (summary.quotaHit || summary.authExpired) continue;

    summary.attempted++;
    const result = await applyRetryItem(youtube, item);

    if (result.ok) {
      db.delete(youtubeRetryQueue).where(eq(youtubeRetryQueue.id, item.id)).run();
      summary.succeeded++;
      console.log(`  ✅ [${item.operationType}] ${item.archiveIdentifier} (yt:${item.youtubeVideoId})`);
    } else if (result.authExpired) {
      summary.authExpired = true;
      db.update(youtubeRetryQueue)
        .set({ status: 'auth_expired', lastError: 'invalid_grant' })
        .where(eq(youtubeRetryQueue.status, 'pending'))
        .run();
      void markTokenRevoked();
      console.warn(`  🔑 [${item.operationType}] ${item.archiveIdentifier} — auth expired, aborting drain`);
    } else if (result.quotaExceeded) {
      summary.quotaHit = true;
      console.log(`  📊 [${item.operationType}] ${item.archiveIdentifier} — quota exhausted, stopping drain`);
    } else {
      const nextAttempts = item.attempts + 1;
      const terminal = nextAttempts >= 5;
      db.update(youtubeRetryQueue)
        .set({
          attempts: nextAttempts,
          lastError: result.error ?? 'Unknown error',
          status: terminal ? 'failed_terminal' : 'pending',
        })
        .where(eq(youtubeRetryQueue.id, item.id))
        .run();
      summary.failed++;
      console.warn(
        `  ❌ [${item.operationType}] ${item.archiveIdentifier} attempt #${nextAttempts}: ${result.error ?? 'unknown error'}`
      );
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 200));
  }

  const remaining = db
    .select({ id: youtubeRetryQueue.id })
    .from(youtubeRetryQueue)
    .where(eq(youtubeRetryQueue.status, 'pending'))
    .all();
  summary.remaining = remaining.length;

  console.log(
    `♻️  Drain done: ${summary.succeeded} succeeded, ${summary.failed} failed, ${summary.remaining} remaining`
  );
  return summary;
}
