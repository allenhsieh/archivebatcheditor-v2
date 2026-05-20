// Ported from v1 tests/utils.test.ts — verifies standardizeDate and extractDateFromTitle
// against the user's actual recording filename conventions.
import { describe, it, expect } from 'vitest';
import { standardizeDate, extractDateFromTitle } from '@/lib/archive/dates';

describe('standardizeDate', () => {
  it('handles MM/DD/YY format', () => {
    expect(standardizeDate('12/25/23')).toBe('2023-12-25');
    expect(standardizeDate('1/5/23')).toBe('2023-01-05');
    expect(standardizeDate('3/15/99')).toBe('2099-03-15'); // assumes 21st century
  });

  it('handles MM/DD/YYYY format', () => {
    expect(standardizeDate('12/25/2023')).toBe('2023-12-25');
    expect(standardizeDate('1/5/2022')).toBe('2022-01-05');
    expect(standardizeDate('03/15/2024')).toBe('2024-03-15');
  });

  it('handles DD.MM.YY European format (user file convention)', () => {
    expect(standardizeDate('25.12.23')).toBe('2023-12-25');
    expect(standardizeDate('5.1.23')).toBe('2023-01-05');
    expect(standardizeDate('15.03.99')).toBe('2099-03-15');
    expect(standardizeDate('31.12.23')).toBe('2023-12-31');
  });

  it('handles DD.MM.YYYY European format', () => {
    expect(standardizeDate('25.12.2023')).toBe('2023-12-25');
    expect(standardizeDate('5.1.2022')).toBe('2022-01-05');
    expect(standardizeDate('15.03.2024')).toBe('2024-03-15');
  });

  it('passes through YYYY-MM-DD unchanged', () => {
    expect(standardizeDate('2023-12-25')).toBe('2023-12-25');
    expect(standardizeDate('2022-01-05')).toBe('2022-01-05');
  });

  it('strips ISO timestamp to date part', () => {
    expect(standardizeDate('2016-02-28T00:00:00Z')).toBe('2016-02-28');
    expect(standardizeDate('2023-12-25T15:30:45.123Z')).toBe('2023-12-25');
    expect(standardizeDate('2022-01-05T08:00:00')).toBe('2022-01-05');
  });

  it('expands year-only to Jan 1', () => {
    expect(standardizeDate('2023')).toBe('2023-01-01');
    expect(standardizeDate('1999')).toBe('1999-01-01');
  });

  it('returns empty string and unrecognized strings as-is', () => {
    expect(standardizeDate('')).toBe('');
    expect(standardizeDate('invalid-date')).toBe('invalid-date');
  });
});

describe('extractDateFromTitle', () => {
  it('extracts YYYY-MM-DD dates', () => {
    expect(extractDateFromTitle('Grateful Dead 2023-12-25 Christmas Show')).toBe('2023-12-25');
    expect(extractDateFromTitle('Concert 1999-05-15 Spring Tour')).toBe('1999-05-15');
  });

  it('extracts and standardizes slash-format dates', () => {
    expect(extractDateFromTitle('Show 12/25/23 Holiday Concert')).toBe('2023-12-25');
    expect(extractDateFromTitle('Tour 5/15/23 Spring Shows')).toBe('2023-05-15');
    expect(extractDateFromTitle('Concert 12/25/2023 Christmas')).toBe('2023-12-25');
  });

  it('extracts dates from Archive.org-style identifiers', () => {
    expect(extractDateFromTitle('gd1977-05-08.sbd.miller.97065.shnf')).toBe('1977-05-08');
  });

  it('falls back to year-only extraction', () => {
    expect(extractDateFromTitle('Concert 2023 Holiday')).toBe('2023-01-01');
  });

  it('returns null for empty or null input', () => {
    expect(extractDateFromTitle('')).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(extractDateFromTitle(null as any)).toBeNull();
  });

  it('returns null when no date pattern found', () => {
    expect(extractDateFromTitle('Just a regular title')).toBeNull();
    expect(extractDateFromTitle('Band Name - Song Title')).toBeNull();
  });

  it('returns the first date found when multiple are present', () => {
    expect(extractDateFromTitle('Tour 2023-12-25 and 2023-12-26')).toBe('2023-12-25');
  });
});
