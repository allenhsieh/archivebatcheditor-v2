import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { searchItems } from '@/lib/archive/client';
import { env } from '@/lib/env';

const querySchema = z.object({
  q: z.string().min(1, 'Query is required'),
  rows: z.coerce.number().int().min(1).max(1000).default(100),
});

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const parsed = querySchema.safeParse({
    q: searchParams.get('q'),
    rows: searchParams.get('rows') ?? undefined,
  });

  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid parameters' },
      { status: 400 }
    );
  }

  // Always scope user searches to the configured uploader — this is a single-user
  // editor for the user's own collection, not a general Archive.org search tool.
  const scopedQuery = `(${parsed.data.q}) AND uploader:${env.ARCHIVE_EMAIL}`;

  try {
    const items = await searchItems(scopedQuery, undefined, parsed.data.rows);
    return Response.json({ items, total: items.length });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Search failed' },
      { status: 500 }
    );
  }
}
