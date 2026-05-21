import { NextRequest } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { createSSEStream, sseHeaders } from '@/lib/sse';
import { createOperationRun, finishOperationRun, addActivityLogEntry } from '@/lib/activityLog';
import { getAuthenticatedYouTubeClient, markTokenRevoked } from '@/lib/youtube/client';
import { isYouTubeAuthError, isYouTubeQuotaError } from '@/lib/youtube/errors';
import { db } from '@/db/client';
import { youtubeChannelCacheVideos } from '@/db/schema';

// Bulk find-and-replace on YouTube video descriptions. For each video:
//   1. Fetch the current snippet from YouTube (1 quota unit each).
//   2. Compute new = old.replaceAll(find, replace) — case-sensitive by default,
//      or use `caseInsensitive: true` to do a /find/gi replace.
//   3. If new === old, no-op.
//   4. Otherwise PUT the updated snippet (50 units each — videos.update).
// On quota exhaustion the batch aborts cleanly; on auth expiry it aborts and
// marks the token revoked (same shape as the other YouTube write routes).

const RequestSchema = z.object({
  videoIds: z.array(z.string().min(1)).min(1).max(200),
  find: z.string().min(1),
  replace: z.string(),
  caseInsensitive: z.boolean().optional().default(false),
  // When true, any line containing the match is removed entirely (with its
  // trailing newline). Useful for catching variations like "please visit
  // ilovescifi.net" / "As always, http://www.ilovescifi.net" with one pattern.
  removeWholeLine: z.boolean().optional().default(false),
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

  const { videoIds, find, replace, caseInsensitive, removeWholeLine } = parsed.data;
  const flags = (caseInsensitive ? 'i' : '') + 'g';
  // Substring mode: just replace the matched chars.
  // Line mode: match the line (any chars except CR/LF) that contains the find,
  //   plus its trailing line break. We then collapse runs of blank lines so
  //   removing a middle line doesn't leave a double-blank gap.
  const finder = removeWholeLine
    ? new RegExp(`^[^\\r\\n]*${escapeRegex(find)}[^\\r\\n]*(?:\\r?\\n)?`, 'm' + flags)
    : new RegExp(escapeRegex(find), flags);

  const stream = createSSEStream(async (send) => {
    const operationId = createOperationRun({
      operationType: 'youtube_description',
      totalItems: videoIds.length,
      parameters: { find, replace, caseInsensitive, scope: 'bulk_cleanup' },
    });

    console.log(`📝 YouTube description cleanup started: ${videoIds.length} video(s), op ${operationId}`);
    send({ type: 'start', total: videoIds.length, operationId });

    let youtube: Awaited<ReturnType<typeof getAuthenticatedYouTubeClient>>;
    try {
      youtube = await getAuthenticatedYouTubeClient();
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'YouTube not authenticated';
      send({ type: 'error', error: msg });
      finishOperationRun(operationId, { successfulItems: 0, noChangeItems: 0, failedItems: videoIds.length });
      return;
    }

    let successful = 0;
    let failed = 0;
    let noChange = 0;
    let abortReason: 'auth' | 'quota' | null = null;
    const results: Array<{ identifier: string; success: boolean; noChange?: boolean; error?: string }> = [];

    for (let i = 0; i < videoIds.length; i++) {
      const videoId = videoIds[i];
      send({ type: 'progress', current: i + 1, total: videoIds.length, identifier: videoId, status: 'processing' });

      if (abortReason) {
        failed++;
        const errMsg = abortReason === 'auth' ? 'Auth expired' : 'Quota exhausted';
        addActivityLogEntry({ operationRunId: operationId, identifier: videoId, status: 'failure', errorMessage: errMsg });
        results.push({ identifier: videoId, success: false, error: errMsg });
        send({ type: 'progress', current: i + 1, total: videoIds.length, identifier: videoId, status: 'error', error: errMsg });
        continue;
      }

      try {
        const listRes = await youtube.videos.list({ part: ['snippet'], id: [videoId] });
        const existing = listRes.data.items?.[0]?.snippet;
        if (!existing) throw new Error('Video not found or not owned by authenticated account');

        const oldDesc = existing.description ?? '';
        let newDesc = oldDesc.replace(finder, replace);
        if (removeWholeLine) {
          // Collapse 3+ consecutive newlines down to 2, then trim leading/trailing
          // whitespace — the line-removal pattern leaves visible gaps otherwise.
          newDesc = newDesc.replace(/(\r?\n){3,}/g, '\n\n').replace(/^\s+|\s+$/g, '');
        }

        if (newDesc === oldDesc) {
          noChange++;
          // Keep cache in sync if the live description didn't contain the
          // pattern (cache may have been stale).
          db.update(youtubeChannelCacheVideos)
            .set({ description: oldDesc })
            .where(eq(youtubeChannelCacheVideos.videoId, videoId))
            .run();
          addActivityLogEntry({ operationRunId: operationId, identifier: videoId, status: 'no_change', message: 'Pattern not present in current description' });
          console.log(`⏭  yt:${videoId}: pattern not present`);
          send({ type: 'progress', current: i + 1, total: videoIds.length, identifier: videoId, status: 'no_change' });
          results.push({ identifier: videoId, success: true, noChange: true });
        } else {
          await youtube.videos.update({
            part: ['snippet'],
            requestBody: {
              id: videoId,
              snippet: {
                title: existing.title ?? '',
                categoryId: existing.categoryId ?? '10',
                description: newDesc,
                defaultLanguage: existing.defaultLanguage ?? undefined,
                tags: existing.tags ?? [],
              },
            },
          });

          // Refresh the local cache so subsequent searches don't re-match the
          // pattern we just removed.
          db.update(youtubeChannelCacheVideos)
            .set({ description: newDesc })
            .where(eq(youtubeChannelCacheVideos.videoId, videoId))
            .run();

          successful++;
          const summary = removeWholeLine
            ? `Removed line(s) containing "${find}"${caseInsensitive ? ' (i)' : ''}`
            : `Replaced "${find}"${caseInsensitive ? ' (i)' : ''}`;
          addActivityLogEntry({ operationRunId: operationId, identifier: videoId, status: 'success', message: summary });
          console.log(`📝 ✅ yt:${videoId}: cleaned description`);
          send({ type: 'progress', current: i + 1, total: videoIds.length, identifier: videoId, status: 'completed' });
          results.push({ identifier: videoId, success: true });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        if (isYouTubeAuthError(error)) {
          abortReason = 'auth';
          void markTokenRevoked();
          console.warn(`🔑 YouTube auth expired during description cleanup — aborting`);
        } else if (isYouTubeQuotaError(error)) {
          abortReason = 'quota';
          console.log(`📊 YouTube quota exhausted — aborting cleanup at video ${videoId}`);
        }

        failed++;
        addActivityLogEntry({ operationRunId: operationId, identifier: videoId, status: 'failure', errorMessage });
        console.error(`📝 ❌ yt:${videoId}: ${errorMessage}`);
        send({ type: 'progress', current: i + 1, total: videoIds.length, identifier: videoId, status: 'error', error: errorMessage });
        results.push({ identifier: videoId, success: false, error: errorMessage });
      }

      if (i < videoIds.length - 1 && !abortReason) await sleep(200);
    }

    finishOperationRun(operationId, { successfulItems: successful, noChangeItems: noChange, failedItems: failed });
    console.log(`📝 Description cleanup complete: ${successful} updated, ${noChange} unchanged, ${failed} failed`);
    send({ type: 'complete', total: videoIds.length, successful, failed, noChange, results });
  });

  return new Response(stream, { headers: sseHeaders() });
}
