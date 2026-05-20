import { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';
import { eq, desc } from 'drizzle-orm';
import { db } from '@/db/client';
import { youtubeOauthTokens } from '@/db/schema';
import { env } from '@/lib/env';

function createOAuth2Client(): OAuth2Client {
  return new OAuth2Client(
    env.YOUTUBE_CLIENT_ID,
    env.YOUTUBE_CLIENT_SECRET,
    env.YOUTUBE_REDIRECT_URI
  );
}

export function generateAuthUrl(): string {
  const client = createOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/youtube.force-ssl'],
    prompt: 'consent',
  });
}

export async function exchangeCodeForTokens(code: string): Promise<{
  refreshToken: string;
  accessToken: string | null;
  expiresAt: Date | null;
  scope: string;
}> {
  const client = createOAuth2Client();
  const { tokens } = await client.getToken(code);

  if (!tokens.refresh_token) {
    throw new Error(
      'No refresh token returned. Revoke the app at https://myaccount.google.com/permissions and retry.'
    );
  }

  return {
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token ?? null,
    expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    scope: tokens.scope ?? 'https://www.googleapis.com/auth/youtube.force-ssl',
  };
}

export async function getAuthStatus(): Promise<{
  authenticated: boolean;
  configured: boolean;
  revoked?: boolean;
}> {
  const configured = Boolean(env.YOUTUBE_CLIENT_ID && env.YOUTUBE_CLIENT_SECRET);
  if (!configured) return { authenticated: false, configured: false };

  const row = db.select().from(youtubeOauthTokens).orderBy(desc(youtubeOauthTokens.id)).limit(1).get();
  if (!row) return { authenticated: false, configured };
  if (row.revoked) return { authenticated: false, configured, revoked: true };
  return { authenticated: true, configured };
}

export async function persistTokens(params: {
  refreshToken: string;
  accessToken: string | null;
  expiresAt: Date | null;
  scope: string;
}): Promise<void> {
  // Revoke any existing rows before inserting (single-user app)
  db.update(youtubeOauthTokens).set({ revoked: true }).run();
  db.insert(youtubeOauthTokens).values({
    refreshToken: params.refreshToken,
    accessToken: params.accessToken ?? undefined,
    accessTokenExpiresAt: params.expiresAt ?? undefined,
    scope: params.scope,
    revoked: false,
  }).run();
}

export async function markTokenRevoked(): Promise<void> {
  db.update(youtubeOauthTokens).set({ revoked: true }).run();
}

export async function getAuthenticatedYouTubeClient() {
  const row = db
    .select()
    .from(youtubeOauthTokens)
    .where(eq(youtubeOauthTokens.revoked, false))
    .orderBy(desc(youtubeOauthTokens.id))
    .limit(1)
    .get();

  if (!row?.refreshToken) {
    throw new Error('YouTube not authenticated — visit /api/auth/youtube to authorize');
  }

  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({
    refresh_token: row.refreshToken,
    access_token: row.accessToken ?? undefined,
    expiry_date: row.accessTokenExpiresAt?.getTime() ?? undefined,
  });

  // Persist rotated tokens so we keep the latest access token
  oauth2Client.on('tokens', (rotated) => {
    if (rotated.access_token) {
      db.update(youtubeOauthTokens)
        .set({
          accessToken: rotated.access_token,
          accessTokenExpiresAt: rotated.expiry_date ? new Date(rotated.expiry_date) : undefined,
          updatedAt: new Date(),
        })
        .where(eq(youtubeOauthTokens.id, row.id))
        .run();
    }
  });

  return google.youtube({ version: 'v3', auth: oauth2Client });
}
