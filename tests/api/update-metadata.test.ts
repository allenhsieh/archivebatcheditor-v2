// Adapted from v1 tests/server-integration.test.ts. Two regressions:
//   1. Archive.org's "no changes to _meta.xml" 400 must be treated as SUCCESS
//      (status no_change), not an error, and must not abort the stream.
//   2. Metadata writes must use the LOW credential scheme (CLAUDE.md / v1 auth
//      regression), never Basic, and must never be logged.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/archive/update-metadata/route';
import type { SSEEvent } from '@/lib/sse';

type Complete = Extract<SSEEvent, { type: 'complete' }>;

function parseSSE(text: string): SSEEvent[] {
  return text
    .split('\n')
    .filter((l) => l.startsWith('data: '))
    .map((l) => JSON.parse(l.slice(6)) as SSEEvent);
}

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/archive/update-metadata', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('POST /api/archive/update-metadata', () => {
  it('treats "no changes to _meta.xml" 400 as success and uses the LOW auth scheme', async () => {
    let authHeader: string | null = null;
    global.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') {
        authHeader = new Headers(init.headers).get('Authorization');
        // The write made no actual change — Archive.org's "already current" 400.
        return new Response(JSON.stringify({ success: false, error: 'no changes to _meta.xml' }), {
          status: 400,
          statusText: 'Bad Request',
        });
      }
      // Pre-read of current metadata: a different title so a replace IS planned
      // (otherwise planPatches would no-op it before any write happens).
      return new Response(JSON.stringify({ metadata: { identifier: 'test-item', title: 'Old Title' } }), {
        status: 200,
      });
    });

    const res = await POST(
      makeRequest({ items: ['test-item'], updates: [{ field: 'title', value: 'New Title', operation: 'replace' }] }),
    );
    const events = parseSSE(await res.text());

    expect(events.some((e) => e.type === 'complete')).toBe(true);
    // The core regression: no error status event for an already-current item.
    expect(events.some((e) => e.type === 'progress' && e.status === 'error')).toBe(false);

    const complete = events.find((e): e is Complete => e.type === 'complete');
    expect(complete?.noChange).toBe(1);
    expect(complete?.failed).toBe(0);

    expect(authHeader).toMatch(/^LOW /);
    expect(authHeader).not.toMatch(/^Basic /);
  });

  it('rejects an invalid body shape with a 400 before opening a stream', async () => {
    const res = await POST(makeRequest({ items: 'not-an-array', updates: [] }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBeDefined();
  });
});
