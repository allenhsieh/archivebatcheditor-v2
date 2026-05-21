import { NextRequest, NextResponse } from 'next/server';
import { exchangeCodeForTokens, persistTokens } from '@/lib/youtube/client';

function redirectWithError(req: NextRequest, reason: string): NextResponse {
  const url = new URL('/', req.url);
  url.searchParams.set('youtube_auth', 'error');
  url.searchParams.set('reason', reason);
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  const oauthError = searchParams.get('error');
  if (oauthError) {
    return redirectWithError(req, `Google returned: ${oauthError}`);
  }

  const code = searchParams.get('code');
  if (!code) {
    return redirectWithError(req, 'Missing authorization code');
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    await persistTokens(tokens);
    return NextResponse.redirect(new URL('/?youtube_auth=success', req.url));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OAuth callback failed';
    console.error('YouTube OAuth callback error:', message);
    return redirectWithError(req, message);
  }
}
