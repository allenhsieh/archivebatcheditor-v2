'use client';

import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useUIStore } from '@/stores/ui';
import { useLogStore } from '@/stores/log';
import { extractVideoIdFromUrl } from '@/lib/youtube/urls';
import { useSSEStream } from '@/hooks/useSSEStream';
import type { SSEEvent, SSECompleteEvent } from '@/lib/sse';
import type { MatchResult } from '@/lib/youtube/match';

interface ItemMatch {
  identifier: string;
  match: MatchResult | null;
}

interface MatchResponse {
  matches: ItemMatch[];
}

type ItemProgress = { status: 'pending' | 'processing' | 'completed' | 'error' | 'no_change'; error?: string };

function isSSECompleteEvent(e: SSEEvent): e is SSECompleteEvent {
  return e.type === 'complete';
}

export function YouTubeMatcher() {
  const { selectedIdentifiers, itemsCache, setYoutubeMatches } = useUIStore();
  const queryClient = useQueryClient();
  const addLine = useLogStore((s) => s.addLine);

  const [matches, setMatches] = useState<ItemMatch[]>([]);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [isFinding, setIsFinding] = useState(false);
  const [findError, setFindError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, ItemProgress>>({});
  const [summary, setSummary] = useState<SSECompleteEvent | null>(null);

  const selectedList = Array.from(selectedIdentifiers);

  // SSE stream for applying matches back to Archive.org
  const handleApplyEvent = useCallback(
    (event: SSEEvent) => {
      if (event.type === 'progress') {
        setProgress((prev) => ({
          ...prev,
          [event.identifier]: { status: event.status as ItemProgress['status'], error: event.error },
        }));
        if (event.status === 'completed') {
          addLine({ type: 'success', message: 'YouTube URL written to Archive.org', identifier: event.identifier });
        } else if (event.status === 'error') {
          addLine({ type: 'error', message: event.error ?? 'Failed to write YouTube URL', identifier: event.identifier });
        } else if (event.status === 'no_change') {
          addLine({ type: 'no_change', message: 'YouTube URL already set', identifier: event.identifier });
        }
      } else if (isSSECompleteEvent(event)) {
        setSummary(event);
        addLine({
          type: 'info',
          message: `YouTube links applied — ${event.successful} set, ${event.failed} failed${event.noChange > 0 ? `, ${event.noChange} no change` : ''}`,
        });
        void queryClient.invalidateQueries({ queryKey: ['activity-log'] });
      } else if (event.type === 'start') {
        addLine({ type: 'info', message: `Applying ${event.total} YouTube link${event.total !== 1 ? 's' : ''} to Archive.org…` });
      }
    },
    [queryClient, addLine]
  );

  const { status: applyStatus, startStream } = useSSEStream(handleApplyEvent);
  const isApplying = applyStatus === 'streaming';

  async function findMatches() {
    setIsFinding(true);
    setFindError(null);
    setMatches([]);
    setAccepted(new Set());
    setSummary(null);
    setProgress({});
    addLine({ type: 'info', message: `Finding YouTube matches for ${selectedList.length} item${selectedList.length !== 1 ? 's' : ''}…` });

    try {
      const items = selectedList.map((id) => {
        const meta = itemsCache.get(id);
        return {
          identifier: id,
          title: meta?.title ?? id,
          date: typeof meta?.date === 'string' ? meta.date : undefined,
        };
      });

      const res = await fetch('/api/youtube/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });

      if (!res.ok) {
        const body = await res.json() as { error?: string };
        throw new Error(body.error ?? `Request failed: ${res.status}`);
      }

      const data = await res.json() as MatchResponse;
      setMatches(data.matches);

      // Auto-accept all non-null matches
      const autoAccepted = new Set(
        data.matches.filter((m) => m.match !== null).map((m) => m.identifier)
      );
      setAccepted(autoAccepted);

      // Populate the store so YouTube write editors can use these video IDs
      const matchMap = new Map<string, string>();
      for (const { identifier, match } of data.matches) {
        if (match?.url) {
          const vid = extractVideoIdFromUrl(match.url);
          if (vid) matchMap.set(identifier, vid);
        }
      }
      setYoutubeMatches(matchMap);

      const found = data.matches.filter((m) => m.match !== null).length;
      addLine({ type: 'info', message: `Found ${found} match${found !== 1 ? 'es' : ''} out of ${data.matches.length} items` });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Match failed';
      setFindError(msg);
      addLine({ type: 'error', message: `Match failed: ${msg}` });
    } finally {
      setIsFinding(false);
    }
  }

  function applyMatches() {
    const toApply = matches
      .filter((m) => m.match !== null && accepted.has(m.identifier))
      .map((m) => ({ identifier: m.identifier, url: m.match!.url }));

    if (toApply.length === 0) return;
    setProgress({});
    setSummary(null);
    startStream('/api/youtube/apply-matches', { matches: toApply });
  }

  function toggleAccepted(id: string) {
    setAccepted((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const acceptedCount = matches.filter((m) => m.match !== null && accepted.has(m.identifier)).length;

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-900">YouTube Matcher</h2>
        <p className="text-xs text-zinc-400">Matches from local cache — no API quota used</p>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => void findMatches()}
          disabled={isFinding || isApplying || selectedList.length === 0}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isFinding ? 'Finding…' : `Find matches for ${selectedList.length} item${selectedList.length !== 1 ? 's' : ''}`}
        </button>

        {acceptedCount > 0 && (
          <button
            onClick={applyMatches}
            disabled={isApplying}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50"
          >
            {isApplying ? 'Applying…' : `Add ${acceptedCount} YouTube link${acceptedCount !== 1 ? 's' : ''} to Archive.org`}
          </button>
        )}
      </div>

      {findError && (
        <p className="text-sm text-red-600">{findError}</p>
      )}

      {/* Match results */}
      {matches.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="mb-1 text-xs font-medium text-zinc-500">
            {matches.filter((m) => m.match !== null).length} / {matches.length} matched
            {acceptedCount > 0 && ` · ${acceptedCount} accepted`}
          </div>

          <ul className="divide-y divide-zinc-100 rounded-md border border-zinc-100">
            {matches.map(({ identifier, match }) => {
              const itemProgress = progress[identifier];
              return (
                <li key={identifier} className="flex items-start gap-3 px-3 py-2.5">
                  {/* Accept/reject checkbox */}
                  {match && !itemProgress && (
                    <input
                      type="checkbox"
                      checked={accepted.has(identifier)}
                      onChange={() => toggleAccepted(identifier)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-zinc-900"
                    />
                  )}
                  {(!match || itemProgress) && (
                    <span className="mt-0.5 h-4 w-4 shrink-0" />
                  )}

                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-xs font-medium text-zinc-800">{identifier}</span>

                    {itemProgress ? (
                      <ProgressBadge status={itemProgress.status} error={itemProgress.error} />
                    ) : match ? (
                      <div className="flex items-center gap-2">
                        <a
                          href={match.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="truncate text-xs text-blue-600 hover:underline"
                        >
                          {match.title}
                        </a>
                        <span className="shrink-0 rounded bg-zinc-100 px-1 py-0.5 text-xs text-zinc-500">
                          score {match.score}
                        </span>
                        {match.extractedDate && (
                          <span className="text-xs text-zinc-400">{match.extractedDate}</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-zinc-400">No match found</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {summary && (
        <div className="rounded-md border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm">
          <span className="font-medium text-zinc-900">Done: </span>
          <span className="text-green-700">{summary.successful} set</span>
          {summary.noChange > 0 && <span className="text-zinc-500"> · {summary.noChange} no change</span>}
          {summary.failed > 0 && <span className="text-red-600"> · {summary.failed} failed</span>}
        </div>
      )}
    </div>
  );
}

function ProgressBadge({ status, error }: { status: ItemProgress['status']; error?: string }) {
  if (status === 'processing') return <span className="text-xs text-blue-500 animate-pulse">Writing…</span>;
  if (status === 'completed') return <span className="text-xs text-green-600">✅ Written</span>;
  if (status === 'no_change') return <span className="text-xs text-zinc-400">Already set</span>;
  if (status === 'error') return <span className="text-xs text-red-600">❌ {error}</span>;
  return null;
}
