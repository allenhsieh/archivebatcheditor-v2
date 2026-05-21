import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createSSEStream, sseHeaders } from '@/lib/sse';
import { createOperationRun, finishOperationRun, addActivityLogEntry } from '@/lib/activityLog';
import { getAuthenticatedYouTubeClient, markTokenRevoked } from '@/lib/youtube/client';
import { removeFromRetryQueue } from '@/lib/youtube/retryQueue';
import { enqueueRemainingForRetry } from '@/lib/youtube/abortBatch';
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
    let queuedForRetry = 0;
    const results: Array<{ identifier: string; success: boolean; error?: string }> = [];

    for (let i = 0; i < updates.length; i++) {
      const { identifier, videoId, description } = updates[i];
      send({ type: 'progress', current: i + 1, total: updates.length, identifier, status: 'processing' });

      try {
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
          void markTokenRevoked();
          failed++;
          addActivityLogEntry({ operationRunId: operationId, identifier, status: 'failure', errorMessage: 'Auth expired — re-authorize YouTube' });
          results.push({ identifier, success: false, error: 'Auth expired' });
          send({ type: 'progress', current: i + 1, total: updates.length, identifier, status: 'error', error: 'Auth expired — re-authorize YouTube' });
          console.warn(`🔑 YouTube auth expired during description update — aborting batch (${updates.length - i - 1} item(s) skipped)`);
          break;
        }

        if (isYouTubeQuotaError(error)) {
          const remaining = updates.slice(i).map((u) => ({
            archiveIdentifier: u.identifier,
            youtubeVideoId: u.videoId,
            payload: { description: u.description },
          }));
          queuedForRetry = enqueueRemainingForRetry('description', remaining, errorMessage);
          addActivityLogEntry({
            operationRunId: operationId,
            identifier,
            status: 'failure',
            errorMessage: `Quota exhausted — ${queuedForRetry} item(s) queued for retry`,
          });
          results.push({ identifier, success: false, error: 'Quota exhausted' });
          send({
            type: 'progress',
            current: i + 1,
            total: updates.length,
            identifier,
            status: 'error',
            error: `Quota exhausted — ${queuedForRetry} item${queuedForRetry !== 1 ? 's' : ''} queued for retry`,
          });
          console.log(`📊 YouTube quota exhausted at item ${i + 1}/${updates.length} — queued ${queuedForRetry} for retry`);
          break;
        }

        failed++;
        addActivityLogEntry({ operationRunId: operationId, identifier, status: 'failure', errorMessage });
        console.error(`📝 ❌ ${identifier} (yt:${videoId}): ${errorMessage}`);
        send({ type: 'progress', current: i + 1, total: updates.length, identifier, status: 'error', error: errorMessage });
        results.push({ identifier, success: false, error: errorMessage });
      }

      if (i < updates.length - 1) await sleep(200);
    }

    finishOperationRun(operationId, { successfulItems: successful, noChangeItems: 0, failedItems: failed + queuedForRetry });
    console.log(`📝 Description update complete: ${successful} ok, ${failed} failed${queuedForRetry > 0 ? `, ${queuedForRetry} queued for retry` : ''}`);
    send({ type: 'complete', total: updates.length, successful, failed: failed + queuedForRetry, noChange: 0, results });
  });

  return new Response(stream, { headers: sseHeaders() });
}
