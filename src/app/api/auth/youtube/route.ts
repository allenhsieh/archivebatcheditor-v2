import { NextResponse } from 'next/server';
import { generateAuthUrl } from '@/lib/youtube/client';
import { env } from '@/lib/env';

export async function GET() {
  if (!env.YOUTUBE_CLIENT_ID || !env.YOUTUBE_CLIENT_SECRET) {
    return NextResponse.json({ error: 'YouTube OAuth credentials not configured' }, { status: 501 });
  }
  const url = generateAuthUrl();
  return NextResponse.redirect(url);
}
