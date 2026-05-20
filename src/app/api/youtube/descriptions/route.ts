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
        description: z.string(),
      })
    )
    .min(1)
    .max(500),
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  const stream = createSSEStream(async (send) => {
    const operationId = createOperationRun({
      operationType: 'youtube_description',
      totalItems: updates.length,
    });

    console.log(`📝 YouTube description update started: ${updates.length} video(s), operation ${operationId}`);
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
      const { identifier, videoId, description } = updates[i];
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
        // Fetch existing snippet to preserve title/categoryId/tags
        const listRes = await youtube.videos.list({ part: ['snippet'], id: [videoId] });
        const existing = listRes.data.items?.[0]?.snippet;
        if (!existing) throw new Error('Video not found or not owned by authenticated account');

        await youtube.videos.update({
          part: ['snippet'],
          requestBody: {
            id: videoId,
            snippet: {
              title: existing.title ?? '',
              categoryId: existing.categoryId ?? '10',
              description,
              defaultLanguage: existing.defaultLanguage ?? undefined,
              tags: existing.tags ?? [],
            },
          },
        });

        removeFromRetryQueue('description', videoId);
        successful++;
        addActivityLogEntry({ operationRunId: operationId, identifier, status: 'success' });
        console.log(`📝 ✅ ${identifier} (yt:${videoId}): description updated`);
        send({ type: 'progress', current: i + 1, total: updates.length, identifier, status: 'completed' });
        results.push({ identifier, success: true });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        if (isYouTubeAuthError(error)) {
          abortReason = 'auth';
          void markTokenRevoked();
          console.warn(`🔑 YouTube auth expired during description update — aborting`);
        } else if (isYouTubeQuotaError(error)) {
          abortReason = 'quota';
          enqueueForRetry({ operationType: 'description', archiveIdentifier: identifier, youtubeVideoId: videoId, payload: { description } }, errorMessage);
          console.log(`📊 YouTube quota exhausted — queued ${identifier} for retry`);
        }

        failed++;
        addActivityLogEntry({ operationRunId: operationId, identifier, status: 'failure', errorMessage });
        console.error(`📝 ❌ ${identifier} (yt:${videoId}): ${errorMessage}`);
        send({ type: 'progress', current: i + 1, total: updates.length, identifier, status: 'error', error: errorMessage });
        results.push({ identifier, success: false, error: errorMessage });
      }

      if (i < updates.length - 1 && !abortReason) await sleep(200);
    }

    finishOperationRun(operationId, { successfulItems: successful, noChangeItems: 0, failedItems: failed });
    console.log(`📝 Description update complete: ${successful} ok, ${failed} failed`);
    send({ type: 'complete', total: updates.length, successful, failed, noChange: 0, results });
  });

  return new Response(stream, { headers: sseHeaders() });
}
