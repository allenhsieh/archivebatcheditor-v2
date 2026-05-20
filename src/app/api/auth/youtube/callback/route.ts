import { NextRequest, NextResponse } from 'next/server';
import { exchangeCodeForTokens, persistTokens } from '@/lib/youtube/client';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  const oauthError = searchParams.get('error');
  if (oauthError) {
    return new Response(`OAuth error: ${oauthError}`, { status: 400 });
  }

  const code = searchParams.get('code');
  if (!code) {
    return new Response('Missing authorization code', { status: 400 });
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    await persistTokens(tokens);
    return NextResponse.redirect(new URL('/?youtube_auth=success', req.url));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OAuth callback failed';
    return new Response(message, { status: 500 });
  }
}
