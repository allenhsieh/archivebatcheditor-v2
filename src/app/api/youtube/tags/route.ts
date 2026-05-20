import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createSSEStream, sseHeaders } from '@/lib/sse';
import { createOperationRun, finishOperationRun, addActivityLogEntry } from '@/lib/activityLog';
import { getAuthenticatedYouTubeClient, markTokenRevoked } from '@/lib/youtube/client';
import { enqueueForRetry, removeFromRetryQueue } from '@/lib/youtube/retryQueue';
import { isYouTubeAuthError, isYouTubeQuotaError } from '@/lib/youtube/errors';

const RequestSchema = z.object({
  updates: z
    .array(
      z.object({
        identifier: z.string().min(1),
        videoId: z.string().min(1),
        tags: z.array(z.string()).min(1),
      })
    )
    .min(1)
    .max(500),
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Merges incoming tags with existing tags: existing tags first, case-insensitive dedupe,
// then trims from the end to fit YouTube's 500-char serialized limit.
function mergeTags(existing: string[], incoming: string[]): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const tag of [...existing, ...incoming]) {
    const clean = tag.trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(clean);
  }
  while (merged.join(', ').length > 500 && merged.length > 1) merged.pop();
  return merged;
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: parsed.error.message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { updates } = parsed.data;

  // Validate total tag length per update upfront for a clearer error
  for (const u of updates) {
    if (u.tags.join(', ').length > 500) {
      return new Response(
        JSON.stringify({ error: `Tags for "${u.identifier}" exceed 500-char total` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  const stream = createSSEStream(async (send) => {
    const operationId = createOperationRun({
      operationType: 'youtube_tags',
      totalItems: updates.length,
    });

    console.log(`🏷️  YouTube tag update started: ${updates.length} video(s), operation ${operationId}`);
    send({ type: 'start', total: updates.length, operationId });

    let youtube: Awaited<ReturnType<typeof getAuthenticatedYouTubeClient>>;
    try {
      youtube = await getAuthenticatedYouTubeClient();
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'YouTube not authenticated';
      send({ type: 'error', error: msg });
      finishOperationRun(operationId, { successfulItems: 0, noChangeItems: 0, failedItems: updates.length });
      return;
    }

    let successful = 0;
    let failed = 0;
    let abortReason: 'auth' | 'quota' | null = null;
    const results: Array<{ identifier: string; success: boolean; error?: string }> = [];

    for (let i = 0; i < updates.length; i++) {
      const { identifier, videoId, tags } = updates[i];
      send({ type: 'progress', current: i + 1, total: updates.length, identifier, status: 'processing' });

      if (abortReason) {
        failed++;
        const errMsg = abortReason === 'auth' ? 'Auth expired' : 'Quota exhausted';
        addActivityLogEntry({ operationRunId: operationId, identifier, status: 'failure', errorMessage: errMsg });
        results.push({ identifier, success: false, error: errMsg });
        send({ type: 'progress', current: i + 1, total: updates.length, identifier, status: 'error', error: errMsg });
        continue;
      }

      try {
        // Fetch existing snippet to preserve title/categoryId/description and merge tags
        const listRes = await youtube.videos.list({ part: ['snippet'], id: [videoId] });
        const existing = listRes.data.items?.[0]?.snippet;
        if (!existing) throw new Error('Video not found or not owned by authenticated account');

        const mergedTags = mergeTags(existing.tags ?? [], tags);

        await youtube.videos.update({
          part: ['snippet'],
          requestBody: {
            id: videoId,
            snippet: {
              title: existing.title ?? '',
              categoryId: existing.categoryId ?? '10',
              description: existing.description ?? '',
              defaultLanguage: existing.defaultLanguage ?? undefined,
              tags: mergedTags,
            },
          },
        });

        removeFromRetryQueue('tags', videoId);
        successful++;
        addActivityLogEntry({ operationRunId: operationId, identifier, status: 'success', message: `${mergedTags.length} tags` });
        console.log(`🏷️  ✅ ${identifier} (yt:${videoId}): ${mergedTags.length} tags`);
        send({ type: 'progress', current: i + 1, total: updates.length, identifier, status: 'completed' });
        results.push({ identifier, success: true });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        if (isYouTubeAuthError(error)) {
          abortReason = 'auth';
          void markTokenRevoked();
          console.warn(`🔑 YouTube auth expired during tag update — aborting`);
        } else if (isYouTubeQuotaError(error)) {
          abortReason = 'quota';
          enqueueForRetry({ operationType: 'tags', archiveIdentifier: identifier, youtubeVideoId: videoId, payload: { tags } }, errorMessage);
          console.log(`📊 YouTube quota exhausted — queued ${identifier} for retry`);
        }

        failed++;
        addActivityLogEntry({ operationRunId: operationId, identifier, status: 'failure', errorMessage });
        console.error(`🏷️  ❌ ${identifier} (yt:${videoId}): ${errorMessage}`);
        send({ type: 'progress', current: i + 1, total: updates.length, identifier, status: 'error', error: errorMessage });
        results.push({ identifier, success: false, error: errorMessage });
      }

      if (i < updates.length - 1 && !abortReason) await sleep(200);
    }

    finishOperationRun(operationId, { successfulItems: successful, noChangeItems: 0, failedItems: failed });
    console.log(`🏷️  Tag update complete: ${successful} ok, ${failed} failed`);
    send({ type: 'complete', total: updates.length, successful, failed, noChange: 0, results });
  });

  return new Response(stream, { headers: sseHeaders() });
}
