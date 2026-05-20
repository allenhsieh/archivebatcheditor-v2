import { NextResponse } from 'next/server';
import { getAuthStatus } from '@/lib/youtube/client';

export async function GET() {
  const status = await getAuthStatus();
  return NextResponse.json(status);
}
