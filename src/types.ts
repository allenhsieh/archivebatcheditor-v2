export interface ArchiveItem {
  identifier: string;
  title: string;
  description?: string;
  creator?: string;
  date?: string;
  mediatype?: string;
  // Archive.org returns these as a string, array, or absent — always use type guards
  collection?: string | string[];
  subject?: string | string[];
  [key: string]: unknown;
}

export interface MetadataUpdate {
  field: string;
  value: string;
  operation: 'add' | 'replace' | 'remove';
}

export interface UpdateRequest {
  items: string[];
  updates: MetadataUpdate[];
}

export interface JsonPatchOperation {
  op: 'add' | 'replace' | 'remove';
  path: string;
  value: string;
}

export interface YouTubeMatch {
  videoId: string;
  title: string;
  url: string;
  publishedAt: string;
  extractedBand: string | null;
  extractedVenue: string | null;
  extractedDate: string | null;
}

export interface YouTubeSuggestionResponse {
  success: boolean;
  match?: YouTubeMatch;
  suggestions?: {
    youtube: string;
    band: string | null;
    venue: string | null;
    date: string | null;
  };
  message?: string;
  quotaExhausted?: boolean;
  quotaStatus?: {
    used: number;
    limit: number;
    remaining: number;
    percentage: number;
  };
}
