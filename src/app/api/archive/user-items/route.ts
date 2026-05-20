import { searchItems } from '@/lib/archive/client';
import { env } from '@/lib/env';

export async function GET() {
  try {
    const items = await searchItems(
      `uploader:${env.ARCHIVE_EMAIL}`,
      undefined,
      1000
    );
    return Response.json({ items, total: items.length });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to load items' },
      { status: 500 }
    );
  }
}
