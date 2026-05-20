import { db } from '@/db/client';
import { youtubeChannelCacheVideos } from '@/db/schema';
import { extractBandFromTitle, extractVenueFromTitle } from '@/lib/archive/text';
import { extractDateFromTitle } from '@/lib/archive/dates';

// Lifted and adapted from v1 server/index.ts:332
// Scoring constants tuned to the user's actual archive (concerts published days/weeks after recording)
const DATE_CLOSE_DAYS = 30;
const DATE_MEDIUM_DAYS = 90;
const DATE_FAR_DAYS = 365;

interface CachedVideo {
  videoId: string;
  title: string;
  publishedAt: Date;
  url: string;
}

export interface MatchResult {
  videoId: string;
  url: string;
  title: string;
  publishedAt: Date;
  score: number;
  extractedBand: string | null;
  extractedVenue: string | null;
  extractedDate: string | null;
  topMatches: Array<{ videoId: string; url: string; title: string; score: number; publishedAt: Date }>;
}

function scoreVideoAgainstQuery(video: CachedVideo, archiveTitle: string, archiveDate?: string): number {
  const vt = video.title.toLowerCase();
  const at = archiveTitle.toLowerCase();
  let score = 0;

  if (vt === at) {
    score += 100;
  } else if (vt.includes(at) || at.includes(vt)) {
    score += 50;
  }

  const vWords = vt.split(/\s+/).filter((w) => w.length > 2);
  const aWords = at.split(/\s+/).filter((w) => w.length > 2);
  const common = vWords.filter((w) => aWords.some((a) => w.includes(a) || a.includes(w)));
  score += common.length * 10;

  if (archiveDate) {
    const diff = Math.abs(
      (video.publishedAt.getTime() - new Date(archiveDate).getTime()) / (1000 * 60 * 60 * 24)
    );
    if (diff <= DATE_CLOSE_DAYS) score += 20;
    else if (diff <= DATE_MEDIUM_DAYS) score += 10;
    else if (diff <= DATE_FAR_DAYS) score += 5;
  }

  return score;
}

// Adapted from v1: queries DB instead of in-memory JSON cache
export function matchItemToVideo(
  archiveTitle: string,
  archiveDate?: string
): MatchResult | null {
  const videos = db.select().from(youtubeChannelCacheVideos).all();
  if (videos.length === 0) return null;

  const scored = videos
    .map((v) => ({ ...v, score: scoreVideoAgainstQuery(v, archiveTitle, archiveDate) }))
    .filter((v) => v.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return null;

  const best = scored[0];
  return {
    videoId: best.videoId,
    url: best.url,
    title: best.title,
    publishedAt: best.publishedAt,
    score: best.score,
    extractedBand: extractBandFromTitle(best.title),
    extractedVenue: extractVenueFromTitle(best.title),
    extractedDate: extractDateFromTitle(best.title),
    topMatches: scored.slice(0, 5).map((v) => ({
      videoId: v.videoId,
      url: v.url,
      title: v.title,
      score: v.score,
      publishedAt: v.publishedAt,
    })),
  };
}
