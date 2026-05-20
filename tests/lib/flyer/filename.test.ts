import { describe, test, expect } from 'vitest';
import { generateFlyerFilename } from '@/lib/flyer/filename';

describe('generateFlyerFilename', () => {
  test('uses explicit date field when provided', () => {
    expect(generateFlyerFilename('test-item-123', 'Concert Title', '2023-07-04', 'random.jpg'))
      .toBe('2023-07-04-flyer_itemimage.jpg');
  });

  test('falls back to date extracted from title', () => {
    expect(generateFlyerFilename('test-item-123', 'Concert 2023-12-25 Holiday Show', undefined, 'myfile.png'))
      .toBe('2023-12-25-flyer_itemimage.png');
  });

  test('falls back to date extracted from identifier', () => {
    expect(generateFlyerFilename('gd1977-05-08.sbd.miller', 'Some Title', undefined, 'photo.jpeg'))
      .toBe('1977-05-08-flyer_itemimage.jpeg');
  });

  test('falls back to year-only from identifier', () => {
    expect(generateFlyerFilename('deadshow1995-something', 'No Date In Title', undefined, 'image.gif'))
      .toBe('1995-01-01-flyer_itemimage.gif');
  });

  test('defaults to .jpg when original has no extension', () => {
    expect(generateFlyerFilename('test-item', 'Concert 2023-07-04', undefined, 'filename_no_ext'))
      .toBe('2023-07-04-flyer_itemimage.jpg');
  });

  test('preserves original file extension', () => {
    for (const ext of ['.jpg', '.png', '.gif', '.webp']) {
      expect(generateFlyerFilename('test-item', 'Concert 2023-07-04', undefined, `file${ext}`))
        .toBe(`2023-07-04-flyer_itemimage${ext}`);
    }
  });

  test('falls back to current year when no date found anywhere', () => {
    const year = new Date().getFullYear();
    expect(generateFlyerFilename('no-date-item', 'No Date Anywhere', undefined, 'file.jpg'))
      .toBe(`${year}-01-01-flyer_itemimage.jpg`);
  });

  test('handles malformed date input gracefully', () => {
    const result = generateFlyerFilename('test-item', 'Title', '13/45/2023', 'file.jpg');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}-flyer_itemimage\.jpg$/);
  });
});
