'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useUIStore } from '@/stores/ui';
import type { operationRuns, activityLogEntries } from '@/db/schema';

type OperationRun = typeof operationRuns.$inferSelect;
type ActivityLogEntry = typeof activityLogEntries.$inferSelect;

type StatusFilter = 'all' | 'failure' | 'success' | 'no_change';
type OpTypeFilter = 'all' | 'metadata_update' | 'flyer_fanout' | 'youtube_recording_date' | 'youtube_tags' | 'youtube_description';
type DateFilter = 'all' | 'today' | 'week';

function sinceFromDateFilter(f: DateFilter): string | undefined {
  if (f === 'today') {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }
  if (f === 'week') {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString();
  }
  return undefined;
}

async function fetchRuns(opType: OpTypeFilter, dateFilter: DateFilter): Promise<{ runs: OperationRun[] }> {
  const params = new URLSearchParams({ limit: '50' });
  if (opType !== 'all') params.set('operationType', opType);
  const since = sinceFromDateFilter(dateFilter);
  if (since) params.set('since', since);
  const res = await fetch(`/api/activity-log?${params.toString()}`);
  if (!res.ok) throw new Error('Failed to load activity log');
  return res.json() as Promise<{ runs: OperationRun[] }>;
}

async function fetchEntries(runId: string): Promise<{ entries: ActivityLogEntry[] }> {
  const res = await fetch(`/api/activity-log?runId=${encodeURIComponent(runId)}`);
  if (!res.ok) throw new Error('Failed to load run entries');
  return res.json() as Promise<{ entries: ActivityLogEntry[] }>;
}

export function LogViewer() {
  const qc = useQueryClient();
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [opTypeFilter, setOpTypeFilter] = useState<OpTypeFilter>('all');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [clearing, setClearing] = useState(false);
  const selectAll = useUIStore((s) => s.selectAll);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['activity-log', opTypeFilter, dateFilter],
    queryFn: () => fetchRuns(opTypeFilter, dateFilter),
  });

  const { data: entriesData } = useQuery({
    queryKey: ['activity-log', expandedRunId],
    queryFn: () => fetchEntries(expandedRunId!),
    enabled: expandedRunId !== null,
  });

  const runs = data?.runs ?? [];
  const rawEntries = entriesData?.entries ?? [];

  // Only worth filtering when the run actually has a mix of statuses.
  const distinctStatuses = new Set(rawEntries.map((e) => e.status));
  const showStatusFilter = rawEntries.length > 1 && distinctStatuses.size > 1;

  const entries = rawEntries.filter((e) => {
    if (!showStatusFilter || statusFilter === 'all') return true;
    return e.status === statusFilter;
  });

  const failedIdentifiers = rawEntries
    .filter((e) => e.status === 'failure')
    .map((e) => e.identifier);

  async function handleClear() {
    if (!window.confirm('Clear the entire activity log? This cannot be undone.')) return;
    setClearing(true);
    try {
      const res = await fetch('/api/activity-log', { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to clear log');
      setExpandedRunId(null);
      await qc.invalidateQueries({ queryKey: ['activity-log'] });
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-900 p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-100">Activity Log</h2>
        <div className="flex items-center gap-3">
          <button
            onClick={() => void refetch()}
            className="text-xs text-zinc-400 hover:text-zinc-100"
          >
            Refresh
          </button>
          {runs.length > 0 && (
            <button
              onClick={handleClear}
              disabled={clearing}
              className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
            >
              {clearing ? 'Clearing…' : 'Clear log'}
            </button>
          )}
        </div>
      </div>

      {/* Run-level filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-zinc-500">Type:</span>
          <select
            value={opTypeFilter}
            onChange={(e) => setOpTypeFilter(e.target.value as OpTypeFilter)}
            className="rounded border border-zinc-800 px-2 py-0.5 text-xs text-zinc-300 outline-none focus:border-zinc-500"
          >
            <option value="all">All</option>
            <option value="metadata_update">Metadata Update</option>
            <option value="flyer_fanout">Flyer Fanout</option>
            <option value="youtube_recording_date">Recording Date</option>
            <option value="youtube_tags">Tags</option>
            <option value="youtube_description">Description</option>
          </select>
        </div>
        <div className="flex gap-1">
          {(['all', 'today', 'week'] as DateFilter[]).map((d) => (
            <button
              key={d}
              onClick={() => setDateFilter(d)}
              className={[
                'rounded px-2 py-0.5 text-xs font-medium transition-colors',
                dateFilter === d
                  ? 'bg-blue-600 text-white'
                  : 'text-zinc-400 hover:bg-zinc-800',
              ].join(' ')}
            >
              {d === 'all' ? 'All time' : d === 'today' ? 'Today' : 'This week'}
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <p className="text-sm text-zinc-500">Loading…</p>
      )}

      {error && (
        <p className="text-sm text-red-400">Failed to load activity log</p>
      )}

      {!isLoading && runs.length === 0 && (
        <p className="text-sm text-zinc-500">No operations yet</p>
      )}

      <ul className="flex flex-col gap-2">
        {runs.map((run) => {
          const isExpanded = expandedRunId === run.id;
          return (
            <li key={run.id} className="rounded-md border border-zinc-800">
              <button
                onClick={() => setExpandedRunId(isExpanded ? null : run.id)}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-zinc-950"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-zinc-100">
                    {formatOperationType(run.operationType)}
                  </span>
                  <span className="text-xs text-zinc-500">
                    {formatDate(run.startedAt)} · {run.totalItems} items
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  {run.finishedAt && (
                    <>
                      <span className="text-green-300 font-medium">{run.successfulItems} ok</span>
                      {run.noChangeItems > 0 && (
                        <span className="text-zinc-400 font-medium">{run.noChangeItems} no change</span>
                      )}
                      {run.failedItems > 0 && (
                        <span className="text-red-400 font-medium">{run.failedItems} failed</span>
                      )}
                    </>
                  )}
                  {!run.finishedAt && <span className="text-zinc-500">in progress</span>}
                  <span className="text-zinc-600">{isExpanded ? '▲' : '▼'}</span>
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-zinc-800 px-3 py-3">
                  {/* Filter + retry toolbar — filter only shown for mixed-status runs */}
                  {(showStatusFilter || failedIdentifiers.length > 0) && (
                    <div className="mb-2 flex items-center justify-between gap-2">
                      {showStatusFilter ? (
                        <div className="flex gap-1">
                          {(['all', 'success', 'no_change', 'failure'] as StatusFilter[]).map((s) => (
                            <button
                              key={s}
                              onClick={() => setStatusFilter(s)}
                              className={[
                                'rounded px-2 py-0.5 text-xs font-medium transition-colors',
                                statusFilter === s
                                  ? 'bg-blue-600 text-white'
                                  : 'text-zinc-400 hover:bg-zinc-800',
                              ].join(' ')}
                            >
                              {s === 'no_change' ? 'no change' : s}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <span />
                      )}
                      {failedIdentifiers.length > 0 && (
                        <button
                          onClick={() => selectAll(failedIdentifiers)}
                          className="text-xs text-red-400 hover:text-red-300"
                        >
                          Re-select {failedIdentifiers.length} failed
                        </button>
                      )}
                    </div>
                  )}

                  {/* Entry list */}
                  <ul className="max-h-56 overflow-y-auto space-y-0.5">
                    {entries.map((entry) => (
                      <li key={entry.id} className="flex flex-col gap-0.5 py-0.5 text-xs">
                        <div className="flex items-center gap-2">
                          <EntryStatusBadge status={entry.status} />
                          <span className="font-mono text-zinc-300 truncate">{entry.identifier}</span>
                        </div>
                        {entry.errorMessage && (
                          <span className="pl-7 text-red-400">{entry.errorMessage}</span>
                        )}
                        {entry.message && !entry.errorMessage && (
                          <span className="pl-7 text-zinc-500">{entry.message}</span>
                        )}
                      </li>
                    ))}
                    {entries.length === 0 && entriesData && (
                      <li className="text-zinc-500 py-1">No entries match this filter</li>
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
    success: { label: 'ok', cls: 'bg-green-900/40 text-green-300' },
    failure: { label: 'fail', cls: 'bg-red-900/40 text-red-300' },
    no_change: { label: '—', cls: 'bg-zinc-800 text-zinc-400' },
    skipped: { label: 'skip', cls: 'bg-zinc-800 text-zinc-400' },
  };
  const { label, cls } = config[status] ?? { label: status, cls: 'bg-zinc-800 text-zinc-400' };
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
