import { db } from '@/db/client';
import { youtubeChannelCacheVideos, youtubeChannelCacheMeta } from '@/db/schema';
import { env } from '@/lib/env';
import { createYouTubeUrl } from './urls';
import { desc } from 'drizzle-orm';

interface PlaylistItem {
  snippet: {
    resourceId: { videoId: string };
    title: string;
    publishedAt: string;
    description?: string;
  };
}

interface PlaylistResponse {
  items: PlaylistItem[];
  nextPageToken?: string;
}

function isPlaylistResponse(v: unknown): v is PlaylistResponse {
  return (
    typeof v === 'object' &&
    v !== null &&
    'items' in v &&
    Array.isArray((v as Record<string, unknown>).items)
  );
}

// Adapted from v1 server/index.ts:272
// Fetches all videos from the channel's uploads playlist (UC→UU prefix swap),
// then replaces the DB cache. Cost: ~1 quota unit per 50 videos.
export async function fetchAndCacheChannelVideos(): Promise<{ videoCount: number }> {
  const channelId = env.YOUTUBE_CHANNEL_ID;
  const apiKey = env.YOUTUBE_API_KEY;

  if (!channelId || !apiKey) {
    throw new Error('YOUTUBE_CHANNEL_ID and YOUTUBE_API_KEY must be set to refresh the channel cache');
  }

  // UC→UU gives the uploads playlist for any channel
  const uploadsPlaylistId = channelId.replace(/^UC/, 'UU');
  const videos: { videoId: string; title: string; publishedAt: Date; url: string; description: string | null }[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      part: 'snippet',
      playlistId: uploadsPlaylistId,
      maxResults: '50',
      key: apiKey,
      ...(pageToken ? { pageToken } : {}),
    });

    const res = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?${params.toString()}`);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`YouTube playlistItems error ${res.status}: ${body}`);
    }

    const data: unknown = await res.json();
    if (!isPlaylistResponse(data)) throw new Error('Unexpected playlistItems response shape');

    for (const item of data.items) {
      videos.push({
        videoId: item.snippet.resourceId.videoId,
        title: item.snippet.title,
        publishedAt: new Date(item.snippet.publishedAt),
        url: createYouTubeUrl(item.snippet.resourceId.videoId),
        description: item.snippet.description ?? null,
      });
    }

    pageToken = data.nextPageToken;
  } while (pageToken);

  // Replace cache atomically: clear then insert
  db.delete(youtubeChannelCacheVideos).run();
  if (videos.length > 0) {
    // Insert in chunks to stay within SQLite variable limits
    const CHUNK = 500;
    for (let i = 0; i < videos.length; i += CHUNK) {
      db.insert(youtubeChannelCacheVideos).values(videos.slice(i, i + CHUNK)).run();
    }
  }

  db.insert(youtubeChannelCacheMeta).values({ channelId, fetchedAt: new Date() }).run();

  return { videoCount: videos.length };
}

export function getChannelCacheStatus(): {
  videoCount: number;
  lastFetchedAt: Date | null;
  channelId: string | null;
} {
  const videoCount = db.select().from(youtubeChannelCacheVideos).all().length;
  const meta = db
    .select()
    .from(youtubeChannelCacheMeta)
    .orderBy(desc(youtubeChannelCacheMeta.id))
    .limit(1)
    .get();

  return {
    videoCount,
    lastFetchedAt: meta?.fetchedAt ?? null,
    channelId: meta?.channelId ?? null,
  };
}
