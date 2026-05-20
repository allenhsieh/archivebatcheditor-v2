import { NextResponse } from 'next/server';
import { fetchAndCacheChannelVideos } from '@/lib/youtube/channelCache';

export async function POST() {
  try {
    const result = await fetchAndCacheChannelVideos();
    return NextResponse.json({ success: true, videoCount: result.videoCount });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to refresh channel cache';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
