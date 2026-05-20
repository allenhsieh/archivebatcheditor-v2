import { NextRequest } from 'next/server';
import { env } from '@/lib/env';
import { createSSEStream, sseHeaders } from '@/lib/sse';
import { generateFlyerFilename } from '@/lib/flyer/filename';
import { API_DELAY_MS } from '@/lib/archive/client';
import { createOperationRun, finishOperationRun, addActivityLogEntry } from '@/lib/activityLog';

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

interface ItemMeta {
  identifier: string;
  title?: string;
  date?: string;
}

function isItemMeta(v: unknown): v is ItemMeta {
  return typeof v === 'object' && v !== null && 'identifier' in v && typeof (v as Record<string, unknown>).identifier === 'string';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(req: NextRequest) {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return new Response(JSON.stringify({ error: 'Failed to parse form data' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return new Response(JSON.stringify({ error: 'No image file uploaded' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return new Response(JSON.stringify({ error: `Unsupported file type: ${file.type}. Use JPEG, PNG, GIF, or WebP.` }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (file.size > MAX_FILE_BYTES) {
    return new Response(JSON.stringify({ error: `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 10 MB.` }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const itemsRaw = formData.get('items');
  if (typeof itemsRaw !== 'string') {
    return new Response(JSON.stringify({ error: 'Missing items field' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let items: ItemMeta[];
  try {
    const parsed: unknown = JSON.parse(itemsRaw);
    if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every(isItemMeta)) {
      throw new Error('invalid shape');
    }
    items = parsed;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid items field — expected JSON array of {identifier, title?, date?}' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Buffer the file once for reuse across all items
  const fileBytes = await file.arrayBuffer();

  const stream = createSSEStream(async (send) => {
    const operationId = createOperationRun({
      operationType: 'flyer_fanout',
      totalItems: items.length,
      parameters: { originalFilename: file.name, fileType: file.type, fileSize: file.size },
    });

    console.log(`🔄 Flyer fanout started: ${items.length} item(s), file "${file.name}", operation ${operationId}`);
    send({ type: 'start', total: items.length, operationId });

    let successful = 0;
    let failed = 0;
    const results: Array<{ identifier: string; success: boolean; error?: string }> = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      send({ type: 'progress', current: i + 1, total: items.length, identifier: item.identifier, status: 'processing' });

      try {
        const filename = generateFlyerFilename(
          item.identifier,
          item.title ?? item.identifier,
          item.date,
          file.name
        );

        const uploadUrl = `https://s3.us.archive.org/${encodeURIComponent(item.identifier)}/${encodeURIComponent(filename)}`;

        const res = await fetch(uploadUrl, {
          method: 'PUT',
          headers: {
            Authorization: `LOW ${env.ARCHIVE_ACCESS_KEY}:${env.ARCHIVE_SECRET_KEY}`,
            'Content-Type': file.type,
            'Content-Length': fileBytes.byteLength.toString(),
            'x-amz-auto-make-bucket': '1',
            'x-archive-queue-derive': '0',
            'X-Accept-Reduced-Priority': '1',
          },
          body: fileBytes,
        });

        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new Error(`Archive.org upload failed: ${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 200)}` : ''}`);
        }

        successful++;
        addActivityLogEntry({ operationRunId: operationId, identifier: item.identifier, status: 'success', message: filename });
        console.log(`✅ ${item.identifier}: flyer uploaded as ${filename}`);
        send({ type: 'progress', current: i + 1, total: items.length, identifier: item.identifier, status: 'completed' });
        results.push({ identifier: item.identifier, success: true });
      } catch (error) {
        failed++;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        addActivityLogEntry({ operationRunId: operationId, identifier: item.identifier, status: 'failure', errorMessage });
        console.error(`❌ ${item.identifier}: ${errorMessage}`);
        send({ type: 'progress', current: i + 1, total: items.length, identifier: item.identifier, status: 'error', error: errorMessage });
        results.push({ identifier: item.identifier, success: false, error: errorMessage });
      }

      if (i < items.length - 1) await sleep(API_DELAY_MS);
    }

    finishOperationRun(operationId, { successfulItems: successful, noChangeItems: 0, failedItems: failed });
    console.log(`🏁 Flyer fanout complete: ${successful} uploaded, ${failed} failed`);
    send({ type: 'complete', total: items.length, successful, failed, noChange: 0, results });
  });

  return new Response(stream, { headers: sseHeaders() });
}
