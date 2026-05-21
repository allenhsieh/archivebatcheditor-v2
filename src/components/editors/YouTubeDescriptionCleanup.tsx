'use client';

import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLogStore } from '@/stores/log';
import { useSSEStream } from '@/hooks/useSSEStream';
import type { SSEEvent, SSECompleteEvent } from '@/lib/sse';

interface MatchRow {
  videoId: string;
  title: string;
  url: string;
  publishedAt: string;
  description: string | null;
}

interface SearchResponse {
  query: string;
  totalCached: number;
  withDescriptionField: number;
  matches: MatchRow[];
}

type ItemProgress = { status: 'pending' | 'processing' | 'completed' | 'error' | 'no_change'; error?: string };

function isSSECompleteEvent(e: SSEEvent): e is SSECompleteEvent {
  return e.type === 'complete';
}

function previewSnippet(description: string | null, find: string, caseInsensitive: boolean): string {
  if (!description) return '';
  const flags = caseInsensitive ? 'i' : '';
  const idx = description.search(new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags));
  if (idx === -1) return description.slice(0, 120);
  const start = Math.max(0, idx - 40);
  const end = Math.min(description.length, idx + find.length + 60);
  return (start > 0 ? '…' : '') + description.slice(start, end).replace(/\n/g, ' ') + (end < description.length ? '…' : '');
}

export function YouTubeDescriptionCleanup() {
  const qc = useQueryClient();
  const addLine = useLogStore((s) => s.addLine);

  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const [caseInsensitive, setCaseInsensitive] = useState(true);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<Record<string, ItemProgress>>({});
  const [summary, setSummary] = useState<SSECompleteEvent | null>(null);

  const handleEvent = useCallback(
    (event: SSEEvent) => {
      if (event.type === 'progress') {
        setProgress((prev) => ({
          ...prev,
          [event.identifier]: { status: event.status as ItemProgress['status'], error: event.error },
        }));
      } else if (isSSECompleteEvent(event)) {
        setSummary(event);
        addLine({
          type: 'info',
          message: `Description cleanup — ${event.successful} updated, ${event.noChange} unchanged, ${event.failed} failed`,
        });
        void qc.invalidateQueries({ queryKey: ['activity-log'] });
      } else if (event.type === 'start') {
        addLine({ type: 'info', message: `Cleaning ${event.total} YouTube description${event.total !== 1 ? 's' : ''}…` });
      }
    },
    [qc, addLine],
  );

  const { status: applyStatus, startStream } = useSSEStream(handleEvent);
  const isApplying = applyStatus === 'streaming';

  async function search() {
    if (!find.trim()) return;
    setSearching(true);
    setSearchError(null);
    setMatches([]);
    setSearched(false);
    setProgress({});
    setSummary(null);
    try {
      const res = await fetch(`/api/youtube/descriptions/search?q=${encodeURIComponent(find)}`);
      const body = await res.json() as SearchResponse | { error?: string };
      if (!res.ok) throw new Error('error' in body && body.error ? body.error : `Search failed: ${res.status}`);
      const data = body as SearchResponse;
      setMatches(data.matches);
      setAccepted(new Set(data.matches.map((m) => m.videoId)));
      setSearched(true);
      if (data.withDescriptionField === 0) {
        setSearchError('No descriptions in cache. Click "Refresh cache" in the YouTube section first.');
      }
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setSearching(false);
    }
  }

  function toggleAccepted(videoId: string) {
    setAccepted((prev) => {
      const next = new Set(prev);
      if (next.has(videoId)) next.delete(videoId);
      else next.add(videoId);
      return next;
    });
  }

  function applyCleanup() {
    const ids = Array.from(accepted);
    if (ids.length === 0) return;
    setProgress({});
    setSummary(null);
    startStream('/api/youtube/descriptions/cleanup', {
      videoIds: ids,
      find,
      replace,
      caseInsensitive,
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-900 p-4 shadow-sm">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold text-zinc-100">Bulk YouTube Description Cleanup</h2>
        <p className="text-xs text-zinc-400">
          Find a substring across all your channel&apos;s video descriptions, then replace or remove it.
          Searches the local cache (refresh first if you haven&apos;t pulled descriptions yet); writes
          go through the YouTube API (51 quota units per video updated).
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-zinc-400">Find (substring)</label>
          <input
            type="text"
            value={find}
            onChange={(e) => setFind(e.target.value)}
            placeholder="e.g. ilovescifi"
            className="rounded-md border border-zinc-700 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-400"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-zinc-400">
            Replace with <span className="text-zinc-500">(leave empty to delete)</span>
          </label>
          <input
            type="text"
            value={replace}
            onChange={(e) => setReplace(e.target.value)}
            placeholder="(empty)"
            className="rounded-md border border-zinc-700 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-400"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={caseInsensitive}
            onChange={(e) => setCaseInsensitive(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-zinc-700 accent-blue-500"
          />
          <span className="text-xs text-zinc-400">Case-insensitive</span>
        </label>
        <button
          onClick={() => void search()}
          disabled={!find.trim() || searching || isApplying}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {searching ? 'Searching…' : 'Find matching descriptions'}
        </button>
        {accepted.size > 0 && (
          <button
            onClick={applyCleanup}
            disabled={isApplying}
            className="rounded-md border border-red-700 bg-red-950/40 px-4 py-2 text-sm font-medium text-red-200 transition-colors hover:bg-red-900/60 disabled:opacity-50"
          >
            {isApplying ? 'Applying…' : `Apply to ${accepted.size} video${accepted.size !== 1 ? 's' : ''}`}
          </button>
        )}
      </div>

      {searchError && <p className="text-sm text-red-400">{searchError}</p>}

      {searched && matches.length === 0 && !searchError && (
        <p className="text-sm text-zinc-500">No descriptions matched &quot;{find}&quot;.</p>
      )}

      {matches.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-zinc-400">
            {matches.length} match{matches.length !== 1 ? 'es' : ''} ·{' '}
            <span className="text-zinc-500">click rows to include/exclude before applying</span>
          </p>
          <ul className="max-h-80 overflow-y-auto divide-y divide-zinc-800 rounded-md border border-zinc-800">
            {matches.map((m) => {
              const itemProgress = progress[m.videoId];
              const isAccepted = accepted.has(m.videoId);
              return (
                <li
                  key={m.videoId}
                  className={[
                    'flex items-start gap-3 px-3 py-2.5 transition-colors',
                    isAccepted ? '' : 'opacity-40',
                  ].join(' ')}
                >
                  {!itemProgress && (
                    <input
                      type="checkbox"
                      checked={isAccepted}
                      onChange={() => toggleAccepted(m.videoId)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-blue-500"
                    />
                  )}
                  {itemProgress && <span className="mt-0.5 h-4 w-4 shrink-0" />}

                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <a
                      href={m.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="truncate text-xs text-blue-400 hover:underline"
                    >
                      {m.title}
                    </a>
                    <span className="text-[11px] text-zinc-500 truncate">
                      {previewSnippet(m.description, find, caseInsensitive)}
                    </span>
                    {itemProgress && (
                      <span className="text-[11px]">
                        {itemProgress.status === 'processing' && <span className="text-blue-400 animate-pulse">Writing…</span>}
                        {itemProgress.status === 'completed' && <span className="text-green-400">✅ Updated</span>}
                        {itemProgress.status === 'no_change' && <span className="text-zinc-500">No change (pattern absent live)</span>}
                        {itemProgress.status === 'error' && <span className="text-red-400">❌ {itemProgress.error}</span>}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {summary && (
        <div className="rounded-md border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm">
          <span className="font-medium text-zinc-100">Done: </span>
          <span className="text-green-300">{summary.successful} updated</span>
          {summary.noChange > 0 && <span className="text-zinc-400"> · {summary.noChange} unchanged</span>}
          {summary.failed > 0 && <span className="text-red-400"> · {summary.failed} failed</span>}
        </div>
      )}
    </div>
  );
}
