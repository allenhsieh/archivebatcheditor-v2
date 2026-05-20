import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createSSEStream, sseHeaders } from '@/lib/sse';
import { updateMetadata, getItemMetadata, API_DELAY_MS } from '@/lib/archive/client';
import { createOperationRun, finishOperationRun, addActivityLogEntry } from '@/lib/activityLog';
import type { ArchiveItem } from '@/types';

const MetadataUpdateSchema = z.object({
  field: z.string().min(1),
  value: z.string(),
  operation: z.enum(['add', 'replace', 'remove']),
});

const RequestSchema = z.object({
  items: z.array(z.string().min(1)).min(1).max(1000),
  updates: z.array(MetadataUpdateSchema).min(1).max(50),
  dryRun: z.boolean().optional().default(false),
});

type Update = z.infer<typeof MetadataUpdateSchema>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Returns only the subset of updates that would actually change the item's metadata,
// preventing "value already exists" failures and needless writes.
function filterRedundantUpdates(updates: Update[], current: ArchiveItem): Update[] {
  return updates.filter((u) => {
    const currentVal = current[u.field];

    if (u.operation === 'replace') {
      if (typeof currentVal === 'string') return currentVal !== u.value;
      if (Array.isArray(currentVal)) {
        // replace on an array field sets it to a single value — skip only if it's already the sole value
        return !(currentVal.length === 1 && currentVal[0] === u.value);
      }
      return true; // field absent — apply
    }

    if (u.operation === 'add') {
      if (typeof currentVal === 'string') return currentVal !== u.value;
      if (Array.isArray(currentVal)) return !currentVal.includes(u.value);
      return true; // field absent — apply
    }

    if (u.operation === 'remove') {
      if (!currentVal) return false; // nothing to remove
      if (typeof currentVal === 'string') return currentVal === u.value;
      if (Array.isArray(currentVal)) return currentVal.includes(u.value);
      return false;
    }

    return true;
  });
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

  const { items, updates, dryRun } = parsed.data;

  const stream = createSSEStream(async (send) => {
    const operationId = dryRun
      ? 'dry-run'
      : createOperationRun({
          operationType: 'metadata_update',
          totalItems: items.length,
          parameters: { updates },
        });

    console.log(`${dryRun ? '🔍 Dry-run preview' : '🔄 Metadata update'}: ${items.length} item(s)${dryRun ? '' : `, operation ${operationId}`}`);
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
        // Pre-read: fetch current metadata and filter out patches that would be no-ops.
        // This prevents "value already exists" 400s from aborting the whole patch.
        let activePatchOps = updates;
        let preReadSucceeded = false;
        let currentMeta: ArchiveItem | null = null;
        try {
          currentMeta = await getItemMetadata(identifier);
          activePatchOps = filterRedundantUpdates(updates, currentMeta);
          preReadSucceeded = true;
        } catch {
          // Pre-read failed — proceed with all patches and let Archive.org decide
        }

        if (activePatchOps.length === 0) {
          noChange++;
          if (!dryRun) {
            addActivityLogEntry({ operationRunId: operationId, identifier, status: 'no_change', message: 'Already up to date' });
          }
          console.log(`⏭  ${identifier}: all values already current`);
          send({ type: 'progress', current: i + 1, total: items.length, identifier, status: 'no_change', message: 'Already up to date' });
          results.push({ identifier, success: true, noChange: true });
        } else if (dryRun) {
          // Dry-run: report would-change without writing
          successful++;
          const diffMsg = preReadSucceeded && currentMeta !== null
            ? activePatchOps.map((u) => {
                const cur = currentMeta![u.field];
                const curStr = Array.isArray(cur) ? cur.join(', ') : (typeof cur === 'string' ? cur : '(none)');
                return `${u.field}: ${curStr} → ${u.value}`;
              }).join('; ')
            : activePatchOps.map((u) => `${u.field} → ${u.value}`).join('; ');
          console.log(`🔍 ${identifier}: would update — ${diffMsg}`);
          send({ type: 'progress', current: i + 1, total: items.length, identifier, status: 'completed', message: diffMsg });
          results.push({ identifier, success: true });
        } else {
          const patches = activePatchOps.map((u) => ({ op: u.operation, path: `/${u.field}`, value: u.value }));
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
            console.log(`✅ ${identifier}: metadata updated (${activePatchOps.length} field${activePatchOps.length !== 1 ? 's' : ''})`);
            send({ type: 'progress', current: i + 1, total: items.length, identifier, status: 'completed' });
            results.push({ identifier, success: true });
          }
        }
      } catch (error) {
        failed++;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        if (!dryRun) {
          addActivityLogEntry({ operationRunId: operationId, identifier, status: 'failure', errorMessage });
        }
        console.error(`❌ ${identifier}: ${errorMessage}`);
        send({ type: 'progress', current: i + 1, total: items.length, identifier, status: 'error', error: errorMessage });
        results.push({ identifier, success: false, error: errorMessage });
      }

      if (i < items.length - 1) await sleep(API_DELAY_MS);
    }

    if (!dryRun) {
      finishOperationRun(operationId, { successfulItems: successful, noChangeItems: noChange, failedItems: failed });
    }
    console.log(`🏁 ${dryRun ? 'Dry-run preview' : 'Metadata update'} complete: ${successful} ${dryRun ? 'would update' : 'updated'}, ${noChange} no change, ${failed} failed`);
    send({ type: 'complete', total: items.length, successful, failed, noChange, results, dryRun });
  });

  return new Response(stream, { headers: sseHeaders() });
}
