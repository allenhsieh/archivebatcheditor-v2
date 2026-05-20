// Ported from v1 tests/utils.test.ts
import { describe, it, expect } from 'vitest';
import { isApiError, isRateLimitError } from '@/lib/archive/errors';
import type { ApiError } from '@/lib/archive/errors';

describe('isApiError', () => {
  it('returns true for Error instances with a response property', () => {
    const err: ApiError = new Error('test') as ApiError;
    err.response = { status: 400, result: { success: false, error: 'test error' } };
    expect(isApiError(err)).toBe(true);
  });

  it('returns false for plain Error instances', () => {
    expect(isApiError(new Error('plain error'))).toBe(false);
  });

  it('returns false for non-Error values', () => {
    expect(isApiError(null)).toBe(false);
    expect(isApiError({ status: 400 })).toBe(false);
    expect(isApiError('string error')).toBe(false);
  });
});

describe('isRateLimitError', () => {
  it('detects 429 status directly on error', () => {
    expect(isRateLimitError({ status: 429 })).toBe(true);
  });

  it('detects 429 status nested in response', () => {
    expect(isRateLimitError({ response: { status: 429 } })).toBe(true);
  });

  it('detects rate limit from message strings', () => {
    expect(isRateLimitError({ message: 'Rate limit exceeded' })).toBe(true);
    expect(isRateLimitError({ message: 'Too many requests' })).toBe(true);
    expect(isRateLimitError({ message: 'Quota exceeded' })).toBe(true);
  });

  it('returns false for non-rate-limit errors', () => {
    expect(isRateLimitError({ status: 404 })).toBe(false);
    expect(isRateLimitError({ message: 'Not found' })).toBe(false);
    expect(isRateLimitError({})).toBe(false);
    expect(isRateLimitError(null)).toBe(false);
  });
});
