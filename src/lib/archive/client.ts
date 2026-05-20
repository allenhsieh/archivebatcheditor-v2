import { env } from '@/lib/env';
import type { ArchiveItem, JsonPatchOperation } from '@/types';
import { isApiError } from './errors';
import type { ApiError } from './errors';
import { withRetry } from './retry';
import type { ArchiveCallResult } from './retry';

const ARCHIVE_SEARCH_BASE = 'https://archive.org/advancedsearch.php';
const ARCHIVE_METADATA_BASE = 'https://archive.org/metadata';

const DEFAULT_FIELDS = [
  'identifier',
  'title',
  'creator',
  'description',
  'date',
  'mediatype',
  'collection',
  'subject',
  'uploader',
  'youtube',
];

export const API_DELAY_MS = 1000;

function buildSearchUrl(query: string, fields: string[], rows: number): string {
  const url = new URL(ARCHIVE_SEARCH_BASE);
  url.searchParams.set('q', query);
  url.searchParams.set('fl', fields.join(','));
  url.searchParams.set('rows', rows.toString());
  url.searchParams.set('output', 'json');
  url.searchParams.set('sort', 'addeddate desc');
  return url.toString();
}

function isArchiveItem(value: unknown): value is ArchiveItem {
  return (
    typeof value === 'object' &&
    value !== null &&
    'identifier' in value &&
    typeof value.identifier === 'string'
  );
}

export async function searchItems(
  query: string,
  fields: string[] = DEFAULT_FIELDS,
  rows = 1000
): Promise<ArchiveItem[]> {
  const url = buildSearchUrl(query, fields, rows);
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Archive.org search failed: ${response.status} ${response.statusText}`);
  }

  const json = await response.json();
  const docs: unknown[] = Array.isArray(json?.response?.docs) ? json.response.docs : [];
  return docs.filter(isArchiveItem);
}

export async function getItemMetadata(identifier: string): Promise<ArchiveItem> {
  const url = `${ARCHIVE_METADATA_BASE}/${identifier}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Archive.org metadata fetch failed for "${identifier}": ${response.status} ${response.statusText}`
    );
  }

  const json = await response.json();
  const metadata: unknown = json?.metadata;

  if (!isArchiveItem(metadata)) {
    throw new Error(`Unexpected metadata shape for "${identifier}"`);
  }

  return metadata;
}

export async function updateMetadata(
  identifier: string,
  patches: JsonPatchOperation[],
  target = 'metadata'
): Promise<ArchiveCallResult> {
  return withRetry(async () => {
    const url = `${ARCHIVE_METADATA_BASE}/${identifier}`;
    const body = new URLSearchParams();
    body.append('-target', target);
    body.append('-patch', JSON.stringify(patches));

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `LOW ${env.ARCHIVE_ACCESS_KEY}:${env.ARCHIVE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Accept-Reduced-Priority': '1',
      },
      body,
    });

    const result = await response.json();

    if (!response.ok) {
      const err: ApiError = new Error(
        `Archive.org API error: ${response.status} ${response.statusText}`
      );
      err.response = { status: response.status, result };
      throw err;
    }

    return result as ArchiveCallResult;
  }, `Metadata update for ${identifier}`);
}

export { isApiError };
