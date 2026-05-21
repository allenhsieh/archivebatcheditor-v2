import { describe, it, expect, beforeEach } from 'vitest';
import { useUIStore } from '@/stores/ui';

const reset = () => useUIStore.setState({ selectedIdentifiers: new Set() });
const get = () => Array.from(useUIStore.getState().selectedIdentifiers);

describe('useUIStore.selectRange', () => {
  beforeEach(reset);

  const ids = ['a', 'b', 'c', 'd', 'e'];

  it('adds the inclusive range from anchor to target', () => {
    useUIStore.getState().selectRange(ids, 'b', 'd');
    expect(get().sort()).toEqual(['b', 'c', 'd']);
  });

  it('works when the anchor is after the target (reverse range)', () => {
    useUIStore.getState().selectRange(ids, 'd', 'b');
    expect(get().sort()).toEqual(['b', 'c', 'd']);
  });

  it('preserves prior selections instead of replacing them', () => {
    useUIStore.getState().toggleSelection('a');
    useUIStore.getState().selectRange(ids, 'c', 'd');
    expect(get().sort()).toEqual(['a', 'c', 'd']);
  });

  it('is a no-op if either id is not in the ordered list', () => {
    useUIStore.getState().selectRange(ids, 'a', 'zzz');
    expect(get()).toEqual([]);
  });
});
