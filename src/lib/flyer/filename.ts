import { standardizeDate, extractDateFromTitle } from '@/lib/archive/dates';

// Lifted verbatim from v1 server/utils.ts:268
// Generates {YYYY-MM-DD}-flyer_itemimage.{ext} using a multi-source date fallback chain.
export function generateFlyerFilename(
  identifier: string,
  title: string,
  date: string | undefined,
  originalFilename: string
): string {
  const lastDotIndex = originalFilename.lastIndexOf('.');
  const extension = lastDotIndex !== -1 ? originalFilename.slice(lastDotIndex) : '.jpg';

  let extractedDate: string | null = null;

  if (date) extractedDate = standardizeDate(date);
  if (!extractedDate) extractedDate = extractDateFromTitle(title);
  if (!extractedDate) extractedDate = extractDateFromTitle(identifier);

  if (!extractedDate) {
    const yearMatch = identifier.match(/\b(19|20)\d{2}\b/);
    if (yearMatch) extractedDate = `${yearMatch[0]}-01-01`;
  }

  if (!extractedDate) {
    extractedDate = `${new Date().getFullYear()}-01-01`;
  }

  return `${extractedDate}-flyer_itemimage${extension}`;
}
