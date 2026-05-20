'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useUIStore } from '@/stores/ui';
import type { operationRuns, activityLogEntries } from '@/db/schema';

type OperationRun = typeof operationRuns.$inferSelect;
type ActivityLogEntry = typeof activityLogEntries.$inferSelect;

type StatusFilter = 'all' | 'failure' | 'success' | 'no_change';

async function fetchRuns(): Promise<{ runs: OperationRun[] }> {
  const res = await fetch('/api/activity-log?limit=20');
  if (!res.ok) throw new Error('Failed to load activity log');
  return res.json() as Promise<{ runs: OperationRun[] }>;
}

async function fetchEntries(runId: string): Promise<{ entries: ActivityLogEntry[] }> {
  const res = await fetch(`/api/activity-log?runId=${encodeURIComponent(runId)}`);
  if (!res.ok) throw new Error('Failed to load run entries');
  return res.json() as Promise<{ entries: ActivityLogEntry[] }>;
}

export function LogViewer() {
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const selectAll = useUIStore((s) => s.selectAll);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['activity-log'],
    queryFn: fetchRuns,
  });

  const { data: entriesData } = useQuery({
    queryKey: ['activity-log', expandedRunId],
    queryFn: () => fetchEntries(expandedRunId!),
    enabled: expandedRunId !== null,
  });

  const runs = data?.runs ?? [];

  const entries = (entriesData?.entries ?? []).filter((e) => {
    if (statusFilter === 'all') return true;
    return e.status === statusFilter;
  });

  const failedIdentifiers = (entriesData?.entries ?? [])
    .filter((e) => e.status === 'failure')
    .map((e) => e.identifier);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-900">Activity Log</h2>
        <button
          onClick={() => void refetch()}
          className="text-xs text-zinc-500 hover:text-zinc-900"
        >
          Refresh
        </button>
      </div>

      {isLoading && (
        <p className="text-sm text-zinc-400">Loading…</p>
      )}

      {error && (
        <p className="text-sm text-red-600">Failed to load activity log</p>
      )}

      {!isLoading && runs.length === 0 && (
        <p className="text-sm text-zinc-400">No operations yet</p>
      )}

      <ul className="flex flex-col gap-2">
        {runs.map((run) => {
          const isExpanded = expandedRunId === run.id;
          return (
            <li key={run.id} className="rounded-md border border-zinc-100">
              <button
                onClick={() => setExpandedRunId(isExpanded ? null : run.id)}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-zinc-50"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-zinc-900">
                    {formatOperationType(run.operationType)}
                  </span>
                  <span className="text-xs text-zinc-400">
                    {formatDate(run.startedAt)} · {run.totalItems} items
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  {run.finishedAt && (
                    <>
                      <span className="text-green-700 font-medium">{run.successfulItems} ok</span>
                      {run.noChangeItems > 0 && (
                        <span className="text-zinc-500 font-medium">{run.noChangeItems} no change</span>
                      )}
                      {run.failedItems > 0 && (
                        <span className="text-red-600 font-medium">{run.failedItems} failed</span>
                      )}
                    </>
                  )}
                  {!run.finishedAt && <span className="text-zinc-400">in progress</span>}
                  <span className="text-zinc-300">{isExpanded ? '▲' : '▼'}</span>
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-zinc-100 px-3 py-3">
                  {/* Filter + retry toolbar */}
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex gap-1">
                      {(['all', 'success', 'no_change', 'failure'] as StatusFilter[]).map((s) => (
                        <button
                          key={s}
                          onClick={() => setStatusFilter(s)}
                          className={[
                            'rounded px-2 py-0.5 text-xs font-medium transition-colors',
                            statusFilter === s
                              ? 'bg-zinc-900 text-white'
                              : 'text-zinc-500 hover:bg-zinc-100',
                          ].join(' ')}
                        >
                          {s === 'no_change' ? 'no change' : s}
                        </button>
                      ))}
                    </div>
                    {failedIdentifiers.length > 0 && (
                      <button
                        onClick={() => selectAll(failedIdentifiers)}
                        className="text-xs text-red-600 hover:text-red-800"
                      >
                        Re-select {failedIdentifiers.length} failed
                      </button>
                    )}
                  </div>

                  {/* Entry list */}
                  <ul className="max-h-56 overflow-y-auto space-y-0.5">
                    {entries.map((entry) => (
                      <li key={entry.id} className="flex items-start gap-2 py-0.5 text-xs">
                        <EntryStatusBadge status={entry.status} />
                        <span className="font-mono text-zinc-700 truncate">{entry.identifier}</span>
                        {entry.errorMessage && (
                          <span className="text-red-600 truncate">{entry.errorMessage}</span>
                        )}
                        {entry.message && !entry.errorMessage && (
                          <span className="text-zinc-400">{entry.message}</span>
                        )}
                      </li>
                    ))}
                    {entries.length === 0 && entriesData && (
                      <li className="text-zinc-400 py-1">No entries match this filter</li>
                    )}
                  </ul>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function EntryStatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; cls: string }> = {
    success: { label: 'ok', cls: 'bg-green-100 text-green-700' },
    failure: { label: 'fail', cls: 'bg-red-100 text-red-700' },
    no_change: { label: '—', cls: 'bg-zinc-100 text-zinc-500' },
    skipped: { label: 'skip', cls: 'bg-zinc-100 text-zinc-500' },
  };
  const { label, cls } = config[status] ?? { label: status, cls: 'bg-zinc-100 text-zinc-500' };
  return (
    <span className={`shrink-0 rounded px-1 py-0.5 font-medium ${cls}`}>{label}</span>
  );
}

function formatOperationType(type: string): string {
  return {
    metadata_update: 'Metadata Update',
    flyer_fanout: 'Flyer Fanout',
    youtube_recording_date: 'YouTube Recording Date',
    youtube_tags: 'YouTube Tags',
    youtube_description: 'YouTube Description',
  }[type] ?? type;
}

function formatDate(d: Date | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
