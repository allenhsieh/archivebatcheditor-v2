import { isApiError, isRateLimitError } from './errors';
import type { ArchiveApiResult } from './errors';

export interface ArchiveCallResult extends ArchiveApiResult {
  noChanges?: boolean;
}

const MAX_RETRIES = 3;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Translates v1's makeArchiveApiCall. Key invariant: Archive.org's
// "no changes to _meta.xml" 400 is a SUCCESS — item is already up to date.
export async function withRetry(
  apiCall: () => Promise<ArchiveCallResult>,
  context: string
): Promise<ArchiveCallResult> {
  let lastError: Error = new Error('Unknown error');

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await apiCall();
      if (attempt > 1) {
        console.log(`✅ ${context} succeeded on attempt ${attempt}`);
      }
      return result;
    } catch (error) {
      if (error instanceof Error) lastError = error;

      if (isApiError(error)) {
        const archiveError = error.response?.result?.error ?? '';
        if (archiveError === 'no changes to _meta.xml') {
          console.log(`✅ ${context}: no changes needed (already up to date)`);
          return { success: true, noChanges: true };
        }
      }

      console.warn(
        `⚠️  ${context} failed on attempt ${attempt}:`,
        error instanceof Error ? error.message : error
      );

      if (attempt < MAX_RETRIES) {
        if (isRateLimitError(error)) {
          console.log(`🕒 Rate limited, waiting ${attempt * 2} seconds before retry…`);
          await delay(attempt * 2000);
        } else {
          await delay(attempt * 1000);
        }
      }
    }
  }

  console.error(`❌ ${context} failed after ${MAX_RETRIES} attempts, giving up`);
  throw lastError;
}
