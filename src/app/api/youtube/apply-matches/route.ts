import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createSSEStream, sseHeaders } from '@/lib/sse';
import { updateMetadata, API_DELAY_MS } from '@/lib/archive/client';
import { createOperationRun, finishOperationRun, addActivityLogEntry } from '@/lib/activityLog';

const RequestSchema = z.object({
  matches: z.array(z.object({
    identifier: z.string().min(1),
    url: z.string().url(),
  })).min(1).max(1000),
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

  const { matches } = parsed.data;

  const stream = createSSEStream(async (send) => {
    const operationId = createOperationRun({
      operationType: 'metadata_update',
      totalItems: matches.length,
      parameters: { operation: 'apply-youtube-matches' },
    });

    console.log(`🔄 Applying ${matches.length} YouTube match(es), operation ${operationId}`);
    send({ type: 'start', total: matches.length, operationId });

    let successful = 0;
    let failed = 0;
    let noChange = 0;
    const results: Array<{ identifier: string; success: boolean; noChange?: boolean; error?: string }> = [];

    for (let i = 0; i < matches.length; i++) {
      const { identifier, url } = matches[i];
      send({ type: 'progress', current: i + 1, total: matches.length, identifier, status: 'processing' });

      try {
        const result = await updateMetadata(identifier, [{ op: 'replace', path: '/youtube', value: url }]);

        if (result.noChanges) {
          noChange++;
          addActivityLogEntry({ operationRunId: operationId, identifier, status: 'no_change', message: 'YouTube URL already set' });
          console.log(`⏭  ${identifier}: YouTube URL already set`);
          send({ type: 'progress', current: i + 1, total: matches.length, identifier, status: 'no_change' });
          results.push({ identifier, success: true, noChange: true });
        } else {
          successful++;
          addActivityLogEntry({ operationRunId: operationId, identifier, status: 'success', message: url });
          console.log(`✅ ${identifier}: YouTube URL set to ${url}`);
          send({ type: 'progress', current: i + 1, total: matches.length, identifier, status: 'completed' });
          results.push({ identifier, success: true });
        }
      } catch (error) {
        failed++;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        addActivityLogEntry({ operationRunId: operationId, identifier, status: 'failure', errorMessage });
        console.error(`❌ ${identifier}: ${errorMessage}`);
        send({ type: 'progress', current: i + 1, total: matches.length, identifier, status: 'error', error: errorMessage });
        results.push({ identifier, success: false, error: errorMessage });
      }

      if (i < matches.length - 1) await sleep(API_DELAY_MS);
    }

    finishOperationRun(operationId, { successfulItems: successful, noChangeItems: noChange, failedItems: failed });
    console.log(`🏁 YouTube matches applied: ${successful} set, ${noChange} no change, ${failed} failed`);
    send({ type: 'complete', total: matches.length, successful, failed, noChange, results });
  });

  return new Response(stream, { headers: sseHeaders() });
}
