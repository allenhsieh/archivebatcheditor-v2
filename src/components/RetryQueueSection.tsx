'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLogStore } from '@/stores/log';

interface RetryStatus {
  pending: number;
  failed_terminal: number;
  auth_expired: number;
}

interface DrainSummary {
  attempted: number;
  succeeded: number;
  failed: number;
  remaining: number;
  quotaHit: boolean;
  authExpired: boolean;
}

async function fetchStatus(): Promise<RetryStatus> {
  const res = await fetch('/api/youtube/retry-queue');
  if (!res.ok) throw new Error('Failed to load retry queue status');
  return res.json() as Promise<RetryStatus>;
}

async function drain(): Promise<DrainSummary> {
  const res = await fetch('/api/youtube/retry-queue', { method: 'POST' });
  const body = await res.json() as DrainSummary | { error?: string };
  if (!res.ok) throw new Error('error' in body && body.error ? body.error : 'Drain failed');
  return body as DrainSummary;
}

export function RetryQueueSection() {
  const qc = useQueryClient();
  const addLine = useLogStore((s) => s.addLine);

  const { data: status } = useQuery({
    queryKey: ['youtube-retry-queue'],
    queryFn: fetchStatus,
    refetchInterval: 15_000,
  });

  const drainMut = useMutation({
    mutationFn: drain,
    onMutate: () => {
      addLine({ type: 'info', message: 'Draining YouTube retry queue…' });
    },
    onSuccess: (summary) => {
      const parts: string[] = [];
      parts.push(`attempted ${summary.attempted}`);
      parts.push(`${summary.succeeded} ok`);
      if (summary.failed > 0) parts.push(`${summary.failed} failed`);
      if (summary.remaining > 0) parts.push(`${summary.remaining} remaining`);
      if (summary.quotaHit) parts.push('quota hit again');
      if (summary.authExpired) parts.push('auth expired');
      addLine({ type: summary.succeeded > 0 ? 'success' : 'info', message: `Drain done — ${parts.join(', ')}` });
      void qc.invalidateQueries({ queryKey: ['youtube-retry-queue'] });
      void qc.invalidateQueries({ queryKey: ['activity-log'] });
    },
    onError: (error) => {
      addLine({ type: 'error', message: `Drain failed: ${error instanceof Error ? error.message : 'Unknown error'}` });
    },
  });

  const totalPending = status?.pending ?? 0;
  const stuck = (status?.failed_terminal ?? 0) + (status?.auth_expired ?? 0);

  // Hide entirely when there's nothing to retry — keeps the page quiet.
  if (totalPending === 0 && stuck === 0) return null;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-zinc-100">YouTube Retry Queue</h2>
          <span className="rounded-full bg-amber-900/40 px-2 py-0.5 text-xs font-medium text-amber-300">
            {totalPending} pending
          </span>
          {(status?.failed_terminal ?? 0) > 0 && (
            <span className="rounded-full bg-red-900/40 px-2 py-0.5 text-xs font-medium text-red-300" title="Items that failed 5+ retries — won't auto-retry">
              {status?.failed_terminal} terminal
            </span>
          )}
          {(status?.auth_expired ?? 0) > 0 && (
            <span className="rounded-full bg-red-900/40 px-2 py-0.5 text-xs font-medium text-red-300" title="Token expired during a previous drain — re-authorize then retry">
              {status?.auth_expired} blocked on auth
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {totalPending > 0 && (
            <button
              onClick={() => drainMut.mutate()}
              disabled={drainMut.isPending}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {drainMut.isPending ? 'Retrying…' : `Retry ${totalPending} pending`}
            </button>
          )}
        </div>
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        Items that hit YouTube&apos;s daily quota are parked here. The quota resets at midnight
        Pacific Time. Click &ldquo;Retry pending&rdquo; after the reset (or any time) to drain.
      </p>
    </div>
  );
}
