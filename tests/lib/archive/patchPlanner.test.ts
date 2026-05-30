import { describe, it, expect } from 'vitest';
import { planPatches } from '@/lib/archive/patchPlanner';
import type { ArchiveItem } from '@/types';

// Regression coverage for the v1 "replace-first-then-add" pattern.
// Archive.org's JSON Patch endpoint returns 400 if you `replace` a missing
// field. v1 worked around this with a try-then-retry; v2 reads current
// metadata up front and plans the right op.
//
// The v1 test that covered this behavior was
// tests/add-before-replace.test.ts → "add is used as fallback when replace fails".

const baseItem: ArchiveItem = {
  identifier: 'test-item',
  title: 'Test',
};

describe('planPatches: replace → add coercion (v1 regression)', () => {
  it('coerces replace → add when the target field is missing', () => {
    // The youtube-matcher bug: items missing `youtube` were sent `replace`,
    // Archive.org 400'd, every match attempt failed. The fix is to coerce.
    const patches = planPatches(
      [{ field: 'youtube', value: 'https://youtu.be/abc', operation: 'replace' }],
      baseItem,
    );
    expect(patches).toEqual([{ op: 'add', path: '/youtube', value: 'https://youtu.be/abc' }]);
  });

  it('keeps replace as replace when the field exists with a different value', () => {
    const patches = planPatches(
      [{ field: 'title', value: 'New Title', operation: 'replace' }],
      { ...baseItem, title: 'Old Title' },
    );
    expect(patches).toEqual([{ op: 'replace', path: '/title', value: 'New Title' }]);
  });

  it('drops replace when the field already equals the value (no-op)', () => {
    const patches = planPatches(
      [{ field: 'title', value: 'Same', operation: 'replace' }],
      { ...baseItem, title: 'Same' },
    );
    expect(patches).toEqual([]);
  });

  it('drops replace when an array field already contains only that value', () => {
    const patches = planPatches(
      [{ field: 'subject', value: 'punk', operation: 'replace' }],
      { ...baseItem, subject: ['punk'] },
    );
    expect(patches).toEqual([]);
  });

  it('keeps replace on a multi-value array field (intentional overwrite)', () => {
    const patches = planPatches(
      [{ field: 'subject', value: 'punk', operation: 'replace' }],
      { ...baseItem, subject: ['hardcore', 'live'] },
    );
    expect(patches).toEqual([{ op: 'replace', path: '/subject', value: 'punk' }]);
  });
});

describe('planPatches: add semantics', () => {
  it('add on missing field stays add', () => {
    const patches = planPatches(
      [{ field: 'venue', value: 'The Che Cafe', operation: 'add' }],
      baseItem,
    );
    expect(patches).toEqual([{ op: 'add', path: '/venue', value: 'The Che Cafe' }]);
  });

  it('drops add when an array field already contains the value', () => {
    const patches = planPatches(
      [{ field: 'subject', value: 'punk', operation: 'add' }],
      { ...baseItem, subject: ['hardcore', 'punk'] },
    );
    expect(patches).toEqual([]);
  });

  it('drops add when a scalar field already equals the value', () => {
    const patches = planPatches(
      [{ field: 'language', value: 'eng', operation: 'add' }],
      { ...baseItem, language: 'eng' },
    );
    expect(patches).toEqual([]);
  });
});

describe('planPatches: remove semantics', () => {
  it('drops remove when the field is missing', () => {
    const patches = planPatches(
      [{ field: 'subject', value: 'punk', operation: 'remove' }],
      baseItem,
    );
    expect(patches).toEqual([]);
  });

  it('drops remove when array does not contain the value', () => {
    const patches = planPatches(
      [{ field: 'subject', value: 'jazz', operation: 'remove' }],
      { ...baseItem, subject: ['punk', 'hardcore'] },
    );
    expect(patches).toEqual([]);
  });

  it('removes only the matching index from a multi-value array (not the whole field)', () => {
    const patches = planPatches(
      [{ field: 'subject', value: 'punk', operation: 'remove' }],
      { ...baseItem, subject: ['punk', 'hardcore'] },
    );
    // 'punk' is at index 0 — target it specifically so 'hardcore' survives.
    expect(patches).toEqual([{ op: 'remove', path: '/subject/0', value: 'punk' }]);
  });

  it('targets the correct index when the value is not first', () => {
    const patches = planPatches(
      [{ field: 'subject', value: 'hardcore', operation: 'remove' }],
      { ...baseItem, subject: ['punk', 'hardcore', 'emo'] },
    );
    expect(patches).toEqual([{ op: 'remove', path: '/subject/1', value: 'hardcore' }]);
  });

  it('removes the whole field when the value is the sole array element', () => {
    const patches = planPatches(
      [{ field: 'subject', value: 'punk', operation: 'remove' }],
      { ...baseItem, subject: ['punk'] },
    );
    expect(patches).toEqual([{ op: 'remove', path: '/subject', value: 'punk' }]);
  });

  it('keeps remove when scalar equals the value', () => {
    const patches = planPatches(
      [{ field: 'title', value: 'Bad', operation: 'remove' }],
      { ...baseItem, title: 'Bad' },
    );
    expect(patches).toEqual([{ op: 'remove', path: '/title', value: 'Bad' }]);
  });

  it('removes the whole field when value is empty (UI "remove field" case)', () => {
    const patches = planPatches(
      [{ field: 'title', value: '', operation: 'remove' }],
      { ...baseItem, title: 'Some Title' },
    );
    expect(patches).toEqual([{ op: 'remove', path: '/title', value: '' }]);
  });

  it('drops empty-value remove when the field is already absent', () => {
    const patches = planPatches(
      [{ field: 'venue', value: '', operation: 'remove' }],
      baseItem,
    );
    expect(patches).toEqual([]);
  });
});

describe('planPatches: batch of mixed ops', () => {
  it('returns only the operations that would change state, each with the right op', () => {
    const patches = planPatches(
      [
        // missing field — coerce to add
        { field: 'youtube', value: 'https://youtu.be/abc', operation: 'replace' },
        // already equal — drop
        { field: 'title', value: 'Same', operation: 'replace' },
        // present, different — keep as replace
        { field: 'description', value: 'New desc', operation: 'replace' },
        // array already contains — drop
        { field: 'subject', value: 'punk', operation: 'add' },
        // array missing the value — keep as add
        { field: 'subject', value: 'jazz', operation: 'add' },
      ],
      {
        ...baseItem,
        title: 'Same',
        description: 'Old desc',
        subject: ['punk'],
      },
    );
    expect(patches).toEqual([
      { op: 'add', path: '/youtube', value: 'https://youtu.be/abc' },
      { op: 'replace', path: '/description', value: 'New desc' },
      { op: 'add', path: '/subject', value: 'jazz' },
    ]);
  });
});
