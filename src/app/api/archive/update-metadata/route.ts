import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createSSEStream, sseHeaders } from '@/lib/sse';
import { updateMetadata, API_DELAY_MS } from '@/lib/archive/client';
import { createOperationRun, finishOperationRun, addActivityLogEntry } from '@/lib/activityLog';

const MetadataUpdateSchema = z.object({
  field: z.string().min(1),
  value: z.string(),
  operation: z.enum(['add', 'replace', 'remove']),
});

const RequestSchema = z.object({
  items: z.array(z.string().min(1)).min(1).max(1000),
  updates: z.array(MetadataUpdateSchema).min(1).max(50),
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

  const { items, updates } = parsed.data;

  const stream = createSSEStream(async (send) => {
    const operationId = createOperationRun({
      operationType: 'metadata_update',
      totalItems: items.length,
      parameters: { updates },
    });

    console.log(`🔄 Metadata update started: ${items.length} item(s), operation ${operationId}`);
    send({ type: 'start', total: items.length, operationId });

    let successful = 0;
    let failed = 0;
    let noChange = 0;
    const results: Array<{
      identifier: string;
      success: boolean;
      noChange?: boolean;
      error?: string;
    }> = [];

    for (let i = 0; i < items.length; i++) {
      const identifier = items[i];
      send({ type: 'progress', current: i + 1, total: items.length, identifier, status: 'processing' });

      try {
        const patches = updates.map((u) => ({ op: u.operation, path: `/${u.field}`, value: u.value }));
        const result = await updateMetadata(identifier, patches);

        if (result.noChanges) {
          noChange++;
          addActivityLogEntry({ operationRunId: operationId, identifier, status: 'no_change', message: 'Already up to date' });
          console.log(`⏭  ${identifier}: no changes needed`);
          send({ type: 'progress', current: i + 1, total: items.length, identifier, status: 'no_change' });
          results.push({ identifier, success: true, noChange: true });
        } else {
          successful++;
          addActivityLogEntry({ operationRunId: operationId, identifier, status: 'success' });
          console.log(`✅ ${identifier}: metadata updated`);
          send({ type: 'progress', current: i + 1, total: items.length, identifier, status: 'completed' });
          results.push({ identifier, success: true });
        }
      } catch (error) {
        failed++;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        addActivityLogEntry({ operationRunId: operationId, identifier, status: 'failure', errorMessage });
        console.error(`❌ ${identifier}: ${errorMessage}`);
        send({ type: 'progress', current: i + 1, total: items.length, identifier, status: 'error', error: errorMessage });
        results.push({ identifier, success: false, error: errorMessage });
      }

      if (i < items.length - 1) await sleep(API_DELAY_MS);
    }

    finishOperationRun(operationId, { successfulItems: successful, noChangeItems: noChange, failedItems: failed });
    console.log(`🏁 Metadata update complete: ${successful} updated, ${noChange} no change, ${failed} failed`);
    send({ type: 'complete', total: items.length, successful, failed, noChange, results });
  });

  return new Response(stream, { headers: sseHeaders() });
}
