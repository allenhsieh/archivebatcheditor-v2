import { standardizeDate, extractDateFromTitle } from '@/lib/archive/dates';

// Lifted verbatim from v1 server/utils.ts:268
// Generates {YYYY-MM-DD}-flyer_itemimage.{ext} using a multi-source date fallback chain.
// overrideExtension (e.g. '.jpg') takes precedence over the original filename's extension —
// used when the server has already converted the file to a different format.
export function generateFlyerFilename(
  identifier: string,
  title: string,
  date: string | undefined,
  originalFilename: string,
  overrideExtension?: string
): string {
  const lastDotIndex = originalFilename.lastIndexOf('.');
  const extension = overrideExtension ?? (lastDotIndex !== -1 ? originalFilename.slice(lastDotIndex) : '.jpg');

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
