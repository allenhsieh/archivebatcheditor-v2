import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { matchItemToVideo } from '@/lib/youtube/match';

const RequestSchema = z.object({
  items: z.array(z.object({
    identifier: z.string().min(1),
    title: z.string(),
    date: z.string().optional(),
  })).min(1).max(1000),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const matches = parsed.data.items.map((item) => ({
    identifier: item.identifier,
    match: matchItemToVideo(item.title, item.date),
  }));

  return NextResponse.json({ matches });
}
