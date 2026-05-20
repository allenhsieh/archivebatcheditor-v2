import { NextResponse } from 'next/server';
import { getChannelCacheStatus } from '@/lib/youtube/channelCache';

export async function GET() {
  const status = getChannelCacheStatus();
  return NextResponse.json(status);
}
