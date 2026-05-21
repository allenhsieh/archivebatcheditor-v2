import { describe, it, expect } from 'vitest';

// Mirrors the regex construction in
// src/app/api/youtube/descriptions/cleanup/route.ts. Kept here so the
// removeWholeLine behavior is locked down — it's the core knob the user
// relies on for "remove every line that mentions ilovescifi".

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanup(input: string, find: string, opts: { caseInsensitive?: boolean; removeWholeLine?: boolean; replace?: string } = {}): string {
  const flags = (opts.caseInsensitive ? 'i' : '') + 'g';
  const finder = opts.removeWholeLine
    ? new RegExp(`^[^\\r\\n]*${escapeRegex(find)}[^\\r\\n]*(?:\\r?\\n)?`, 'm' + flags)
    : new RegExp(escapeRegex(find), flags);
  let out = input.replace(finder, opts.replace ?? '');
  if (opts.removeWholeLine) {
    out = out.replace(/(\r?\n){3,}/g, '\n\n').replace(/^\s+|\s+$/g, '');
  }
  return out;
}

describe('description cleanup: removeWholeLine', () => {
  it('removes the whole line containing the match (single occurrence)', () => {
    const before = 'Show recording\nFull @ http://www.archive.org/details/foo\n\nAs always, http://www.ilovescifi.net';
    const after = cleanup(before, 'ilovescifi', { caseInsensitive: true, removeWholeLine: true });
    expect(after).toBe('Show recording\nFull @ http://www.archive.org/details/foo');
  });

  it('removes every line containing the match', () => {
    const before = 'Intro\nplease visit ilovescifi.net for more\nMiddle line\nAs always, ilovescifi\nOutro';
    const after = cleanup(before, 'ilovescifi', { caseInsensitive: true, removeWholeLine: true });
    expect(after).toBe('Intro\nMiddle line\nOutro');
  });

  it('handles \\r\\n line endings (YouTube descriptions often have these)', () => {
    const before = 'Line A\r\nplease visit ilovescifi.net\r\nLine B';
    const after = cleanup(before, 'ilovescifi', { caseInsensitive: true, removeWholeLine: true });
    expect(after).toBe('Line A\r\nLine B');
  });

  it('case-insensitive flag catches mixed case', () => {
    const before = 'A\nVisit ILoveSciFi.net today\nB';
    const after = cleanup(before, 'ilovescifi', { caseInsensitive: true, removeWholeLine: true });
    expect(after).toBe('A\nB');
  });

  it('collapses 3+ consecutive newlines after removal to a single blank line', () => {
    const before = 'A\n\nilovescifi mention\n\nB';
    const after = cleanup(before, 'ilovescifi', { caseInsensitive: true, removeWholeLine: true });
    // Without collapsing this would be "A\n\n\n\nB"; we want "A\n\nB"
    expect(after).toBe('A\n\nB');
  });

  it('trims leading/trailing whitespace introduced by removal at edges', () => {
    const before = 'ilovescifi top line\nReal content here\n';
    const after = cleanup(before, 'ilovescifi', { caseInsensitive: true, removeWholeLine: true });
    expect(after).toBe('Real content here');
  });

  it('leaves the description unchanged when nothing matches', () => {
    const before = 'Show recording from 2014. No external mentions.';
    const after = cleanup(before, 'ilovescifi', { caseInsensitive: true, removeWholeLine: true });
    expect(after).toBe(before);
  });
});

describe('description cleanup: substring mode (default)', () => {
  it('removes only the literal substring, leaves the rest of the line intact', () => {
    const before = 'As always, http://www.ilovescifi.net for updates';
    const after = cleanup(before, 'ilovescifi', { caseInsensitive: true });
    expect(after).toBe('As always, http://www..net for updates');
  });

  it('supports a non-empty replacement', () => {
    const before = 'old.example.com is dead';
    const after = cleanup(before, 'old.example.com', { replace: 'new.example.com' });
    expect(after).toBe('new.example.com is dead');
  });

  it('escapes regex metacharacters in the find pattern', () => {
    // Without escaping, "." would match anything → false positives.
    const before = 'visit a.b.c and a-b-c';
    const after = cleanup(before, 'a.b.c', { replace: 'X' });
    expect(after).toBe('visit X and a-b-c');
  });
});
