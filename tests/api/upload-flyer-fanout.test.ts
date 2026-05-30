// Ported from v1 tests/flyer-upload.test.ts — the golden source for the SSE
// event contract. Asserts the start → per-item progress → complete sequence and,
// critically, partial-success isolation: one item failing must NOT abort the
// rest of the batch (CLAUDE.md hard rule #1).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/upload/flyer-fanout/route';
import type { SSEEvent } from '@/lib/sse';

type Complete = Extract<SSEEvent, { type: 'complete' }>;
type Start = Extract<SSEEvent, { type: 'start' }>;

function parseSSE(text: string): SSEEvent[] {
  return text
    .split('\n')
    .filter((l) => l.startsWith('data: '))
    .map((l) => JSON.parse(l.slice(6)) as SSEEvent);
}

function makeRequest(items: Array<{ identifier: string; title?: string; date?: string }>): NextRequest {
  const fd = new FormData();
  // image/jpeg short-circuits the sharp conversion path — any bytes are fine.
  fd.append('file', new File([new Uint8Array([0xff, 0xd8, 0xff])], 'flyer.jpg', { type: 'image/jpeg' }));
  fd.append('items', JSON.stringify(items));
  return new NextRequest('http://localhost/api/upload/flyer-fanout', { method: 'POST', body: fd });
}

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('POST /api/upload/flyer-fanout — SSE contract', () => {
  it('emits start → per-item progress → complete for a happy-path multi-item fanout', async () => {
    global.fetch = vi.fn(async () => new Response('', { status: 200 }));

    const res = await POST(makeRequest([{ identifier: 'item-a' }, { identifier: 'item-b' }]));
    const events = parseSSE(await res.text());

    const start = events.find((e): e is Start => e.type === 'start');
    expect(start?.total).toBe(2);

    expect(
      events.some((e) => e.type === 'progress' && e.identifier === 'item-a' && e.status === 'completed'),
    ).toBe(true);
    expect(
      events.some((e) => e.type === 'progress' && e.identifier === 'item-b' && e.status === 'completed'),
    ).toBe(true);

    const complete = events.find((e): e is Complete => e.type === 'complete');
    expect(complete?.successful).toBe(2);
    expect(complete?.failed).toBe(0);
  });

  it('isolates a per-item failure — the batch continues past the failed item', async () => {
    // item-a's PUT fails; the batch must still upload item-b afterward.
    global.fetch = vi.fn(async (url: string | URL | Request) => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u.includes('item-a')) return new Response('bucket locked', { status: 503, statusText: 'Slow Down' });
      return new Response('', { status: 200 });
    });

    const res = await POST(makeRequest([{ identifier: 'item-a' }, { identifier: 'item-b' }]));
    const events = parseSSE(await res.text());

    expect(
      events.some((e) => e.type === 'progress' && e.identifier === 'item-a' && e.status === 'error'),
    ).toBe(true);
    expect(
      events.some((e) => e.type === 'progress' && e.identifier === 'item-b' && e.status === 'completed'),
    ).toBe(true);

    const complete = events.find((e): e is Complete => e.type === 'complete');
    expect(complete?.successful).toBe(1);
    expect(complete?.failed).toBe(1);
  });

  it('sends the LOW credential scheme on the upload PUT (never Basic)', async () => {
    let authHeader: string | null = null;
    global.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      authHeader = new Headers(init?.headers).get('Authorization');
      return new Response('', { status: 200 });
    });

    await POST(makeRequest([{ identifier: 'item-a' }])).then((r) => r.text());

    expect(authHeader).toMatch(/^LOW /);
    expect(authHeader).not.toMatch(/^Basic /);
  });

  it('rejects a request with no file (400, not an SSE stream)', async () => {
    const fd = new FormData();
    fd.append('items', JSON.stringify([{ identifier: 'x' }]));
    const res = await POST(
      new NextRequest('http://localhost/api/upload/flyer-fanout', { method: 'POST', body: fd }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/no image file/i);
  });
});
