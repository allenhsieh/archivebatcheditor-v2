import { NextRequest } from 'next/server';
import sharp from 'sharp';
import { env } from '@/lib/env';
import { createSSEStream, sseHeaders } from '@/lib/sse';
import { generateFlyerFilename } from '@/lib/flyer/filename';
import { API_DELAY_MS } from '@/lib/archive/client';
import { createOperationRun, finishOperationRun, addActivityLogEntry } from '@/lib/activityLog';

const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif',
]);
const ALLOWED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif']);
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

// Browsers sometimes report empty/generic MIME for HEIC — fall back to extension
function resolveFileType(file: File): string {
  if (file.type && ALLOWED_TYPES.has(file.type)) return file.type;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const extToMime: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg',
    png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', heic: 'image/heic', heif: 'image/heif',
  };
  return extToMime[ext] ?? file.type;
}

// Convert any non-JPEG input to maximum-quality JPEG.
// JPEG q=100 via libjpeg is the highest-fidelity lossy encoding available.
// Archive.org's thumbnail/cover pipeline handles JPEG universally.
async function toJpegIfNeeded(
  bytes: ArrayBuffer,
  mimeType: string
): Promise<{ buffer: ArrayBuffer; mimeType: string; extOverride: '.jpg' | null }> {
  if (mimeType === 'image/jpeg') {
    return { buffer: bytes, mimeType, extOverride: null };
  }
  const converted = await sharp(Buffer.from(bytes))
    .jpeg({ quality: 100, mozjpeg: false })
    .toBuffer();
  // Copy into a fresh ArrayBuffer to avoid sharing sharp's internal buffer pool
  const result = new ArrayBuffer(converted.byteLength);
  new Uint8Array(result).set(converted);
  return { buffer: result, mimeType: 'image/jpeg', extOverride: '.jpg' };
}

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

  const resolvedType = resolveFileType(file);
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!ALLOWED_TYPES.has(resolvedType) && !ALLOWED_EXTENSIONS.has(ext)) {
    return new Response(JSON.stringify({ error: `Unsupported file type: ${file.type || ext}. Use JPEG, PNG, GIF, WebP, or HEIC.` }), {
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

  // Buffer and convert to JPEG (highest quality) for universal Archive.org compatibility
  const rawBytes = await file.arrayBuffer();
  const resolvedMimeType = resolveFileType(file);
  const { buffer: fileBytes, mimeType: uploadMimeType, extOverride } = await toJpegIfNeeded(rawBytes, resolvedMimeType);

  if (extOverride) {
    console.log(`🖼  Converted ${file.name} (${resolvedMimeType}) → JPEG for upload (${(fileBytes.byteLength / 1024).toFixed(0)} KB)`);
  }

  const stream = createSSEStream(async (send) => {
    const operationId = createOperationRun({
      operationType: 'flyer_fanout',
      totalItems: items.length,
      parameters: { originalFilename: file.name, fileType: uploadMimeType, fileSize: fileBytes.byteLength },
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
          file.name,
          extOverride ?? undefined
        );

        const uploadUrl = `https://s3.us.archive.org/${encodeURIComponent(item.identifier)}/${encodeURIComponent(filename)}`;

        const res = await fetch(uploadUrl, {
          method: 'PUT',
          headers: {
            Authorization: `LOW ${env.ARCHIVE_ACCESS_KEY}:${env.ARCHIVE_SECRET_KEY}`,
            'Content-Type': uploadMimeType,
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
