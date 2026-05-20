// Critical regression: Archive.org "no changes to _meta.xml" 400 must be treated
// as success, not an error. Verified against real Archive.org behavior in v1.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withRetry } from '@/lib/archive/retry';
import type { ApiError } from '@/lib/archive/errors';
import type { ArchiveCallResult } from '@/lib/archive/retry';

function makeApiError(status: number, archiveError: string): ApiError {
  const err = new Error(`Archive.org API error: ${status}`) as ApiError;
  err.response = { status, result: { success: false, error: archiveError } };
  return err;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('withRetry', () => {
  it('returns result immediately on success', async () => {
    const apiCall = vi.fn<() => Promise<ArchiveCallResult>>().mockResolvedValue({ success: true });
    const result = await withRetry(apiCall, 'test');
    expect(result.success).toBe(true);
    expect(apiCall).toHaveBeenCalledTimes(1);
  });

  it('treats "no changes to _meta.xml" as success without retrying', async () => {
    const apiCall = vi
      .fn<() => Promise<ArchiveCallResult>>()
      .mockRejectedValue(makeApiError(400, 'no changes to _meta.xml'));

    const result = await withRetry(apiCall, 'test');

    expect(result.success).toBe(true);
    expect(result.noChanges).toBe(true);
    expect(apiCall).toHaveBeenCalledTimes(1); // no retries — this is the core regression guard
  });

  it('retries transient errors and succeeds on second attempt', async () => {
    const apiCall = vi
      .fn<() => Promise<ArchiveCallResult>>()
      .mockRejectedValueOnce(new Error('transient network error'))
      .mockResolvedValue({ success: true });

    const resultPromise = withRetry(apiCall, 'test');
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.success).toBe(true);
    expect(apiCall).toHaveBeenCalledTimes(2);
  });

  it('throws after max retries are exhausted', async () => {
    const err = new Error('persistent failure');
    const apiCall = vi.fn<() => Promise<ArchiveCallResult>>().mockRejectedValue(err);

    const resultPromise = withRetry(apiCall, 'test');
    // Attach rejection handler BEFORE advancing timers to avoid unhandled-rejection warning
    const assertion = expect(resultPromise).rejects.toThrow('persistent failure');
    await vi.runAllTimersAsync();
    await assertion;

    expect(apiCall).toHaveBeenCalledTimes(3);
  });
});
