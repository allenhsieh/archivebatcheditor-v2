// Ported from v1 tests/utils.test.ts
import { describe, it, expect } from 'vitest';
import { extractBandFromTitle, extractVenueFromTitle } from '@/lib/archive/text';

describe('extractBandFromTitle', () => {
  it('extracts band from dash format', () => {
    expect(extractBandFromTitle('Grateful Dead - Fire on the Mountain')).toBe('Grateful Dead');
    expect(extractBandFromTitle('The Beatles - Hey Jude')).toBe('The Beatles');
    expect(extractBandFromTitle('Phish - You Enjoy Myself')).toBe('Phish');
  });

  it('extracts band from colon format', () => {
    expect(extractBandFromTitle('Led Zeppelin: Stairway to Heaven')).toBe('Led Zeppelin');
    expect(extractBandFromTitle('Pink Floyd: Comfortably Numb')).toBe('Pink Floyd');
  });

  it('extracts band from parentheses format', () => {
    expect(extractBandFromTitle('Dead & Company (Live at MSG)')).toBe('Dead & Company');
    expect(extractBandFromTitle('Radiohead (2023 Tour)')).toBe('Radiohead');
  });

  it('filters out common non-band keywords and short names', () => {
    expect(extractBandFromTitle('Live - Performance')).toBeNull();
    expect(extractBandFromTitle('AB')).toBeNull();
  });

  it('returns null for empty or null input', () => {
    expect(extractBandFromTitle('')).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(extractBandFromTitle(null as any)).toBeNull();
  });

  it('returns null when no pattern matches', () => {
    expect(extractBandFromTitle('Just a regular title')).toBeNull();
    expect(extractBandFromTitle('No patterns here')).toBeNull();
  });
});

describe('extractVenueFromTitle', () => {
  it('extracts venue from "at" pattern', () => {
    expect(extractVenueFromTitle('Grateful Dead at The Fillmore')).toBe('The Fillmore');
    expect(extractVenueFromTitle('Concert at Madison Square Garden')).toBe('Madison Square Garden');
  });

  it('extracts venue from "live at" pattern', () => {
    expect(extractVenueFromTitle('Live at Red Rocks')).toBe('Red Rocks');
    expect(extractVenueFromTitle('Phish Live at Berkeley')).toBe('Berkeley');
  });

  it('extracts venue from @ symbol', () => {
    expect(extractVenueFromTitle('Dead & Company @ The Greek Theatre')).toBe('The Greek Theatre');
    expect(extractVenueFromTitle('Show @ Shoreline Amphitheatre')).toBe('Shoreline Amphitheatre');
  });

  it('stops at commas and parentheses', () => {
    expect(extractVenueFromTitle('Concert at The Fillmore, SF')).toBe('The Fillmore');
    expect(extractVenueFromTitle('Live at Red Rocks (CO)')).toBe('Red Rocks');
  });

  it('returns null for short venue names', () => {
    expect(extractVenueFromTitle('Show at XY')).toBeNull();
  });

  it('returns null for empty or null input', () => {
    expect(extractVenueFromTitle('')).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(extractVenueFromTitle(null as any)).toBeNull();
  });

  it('returns null when no pattern matches', () => {
    expect(extractVenueFromTitle('Just a regular title')).toBeNull();
    expect(extractVenueFromTitle('Band Name - Song Title')).toBeNull();
  });
});
