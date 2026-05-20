// Lifted verbatim from v1 server/utils.ts:228-260

export function createYouTubeUrl(videoId: string): string {
  return `https://youtu.be/${videoId}`;
}

export function extractVideoIdFromUrl(url: string): string | null {
  const standardized = standardizeYouTubeUrl(url);
  const m = standardized.match(/youtu\.be\/([a-zA-Z0-9_-]+)/);
  return m?.[1] ?? null;
}

export function standardizeYouTubeUrl(url: string): string {
  if (!url) return url;

  const videoIdPatterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]+)/,
    /youtube\.com\/watch\?.*v=([a-zA-Z0-9_-]+)/,
  ];

  for (const pattern of videoIdPatterns) {
    const match = url.match(pattern);
    if (match?.[1]) return `https://youtu.be/${match[1]}`;
  }

  return url;
}
