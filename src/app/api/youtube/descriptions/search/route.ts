import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { youtubeChannelCacheVideos } from '@/db/schema';

// Searches the local channel cache for videos whose description contains
// the given substring (case-insensitive). Returns the matching videos with
// their current descriptions so the UI can preview before bulk-applying a
// find/replace.

export async function GET(req: NextRequest) {
  // Don't trim: a trailing/leading space is significant. Searching "download @  "
  // (two spaces) must match ONLY the double-spaced descriptions, not every
  // "download @" — otherwise the cleanup apply reads (and burns quota on) a pile
  // of single-space videos that just no-op. Reject only an all-whitespace query.
  const q = req.nextUrl.searchParams.get('q') ?? '';
  if (q.trim() === '') {
    return NextResponse.json({ error: 'Query parameter "q" is required' }, { status: 400 });
  }

  const all = db.select().from(youtubeChannelCacheVideos).all();
  const needle = q.toLowerCase();
  const matches = all
    .filter((v) => v.description != null && v.description.toLowerCase().includes(needle))
    .map((v) => ({
      videoId: v.videoId,
      title: v.title,
      url: v.url,
      publishedAt: v.publishedAt,
      description: v.description,
    }));

  return NextResponse.json({
    query: q,
    totalCached: all.length,
    withDescriptionField: all.filter((v) => v.description != null).length,
    matches,
  });
}
