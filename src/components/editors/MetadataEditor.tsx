'use client';

import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useUIStore } from '@/stores/ui';
import { useLogStore } from '@/stores/log';
import { useSSEStream } from '@/hooks/useSSEStream';
import type { SSEEvent, SSEProgressEvent, SSECompleteEvent } from '@/lib/sse';

const COMMON_FIELDS = [
  { value: 'subject', label: 'Subject / Tag', defaultOp: 'add' as const },
  { value: 'description', label: 'Description', defaultOp: 'replace' as const },
  { value: 'creator', label: 'Creator', defaultOp: 'replace' as const },
  { value: 'date', label: 'Date', defaultOp: 'replace' as const },
  { value: 'title', label: 'Title', defaultOp: 'replace' as const },
  { value: 'band', label: 'Band', defaultOp: 'replace' as const },
  { value: 'venue', label: 'Venue', defaultOp: 'replace' as const },
  { value: 'bandcamp', label: 'Bandcamp URL', defaultOp: 'replace' as const },
  { value: 'licenseurl', label: 'License URL', defaultOp: 'replace' as const },
  { value: 'language', label: 'Language', defaultOp: 'replace' as const },
  { value: 'youtube', label: 'YouTube URL', defaultOp: 'replace' as const },
];

type Operation = 'add' | 'replace' | 'remove';

interface ItemProgress {
  status: 'pending' | 'processing' | 'completed' | 'error' | 'no_change';
  error?: string;
}

function isSSEProgressEvent(e: SSEEvent): e is SSEProgressEvent {
  return e.type === 'progress';
}

function isSSECompleteEvent(e: SSEEvent): e is SSECompleteEvent {
  return e.type === 'complete';
}

export function MetadataEditor() {
  const { selectedIdentifiers } = useUIStore();
  const queryClient = useQueryClient();
  const addLine = useLogStore((s) => s.addLine);

  const [field, setField] = useState(COMMON_FIELDS[0].value);
  const [customField, setCustomField] = useState('');
  const [value, setValue] = useState('');
  const [operation, setOperation] = useState<Operation>('add');
  const [dryRun, setDryRun] = useState(false);
  const [progress, setProgress] = useState<Record<string, ItemProgress & { message?: string }>>({});
  const [summary, setSummary] = useState<SSECompleteEvent | null>(null);

  const selectedList = Array.from(selectedIdentifiers);
  const isCustomField = field === '__custom__';
  const activeField = isCustomField ? customField.trim() : field;

  const handleEvent = useCallback((event: SSEEvent) => {
    if (isSSEProgressEvent(event)) {
      setProgress((prev) => ({
        ...prev,
        [event.identifier]: { status: event.status, error: event.error, message: event.message },
      }));
      if (event.status === 'completed') {
        addLine({ type: 'success', message: event.message ?? 'Metadata updated', identifier: event.identifier });
      } else if (event.status === 'error') {
        addLine({ type: 'error', message: event.error ?? 'Update failed', identifier: event.identifier });
      } else if (event.status === 'no_change') {
        addLine({ type: 'no_change', message: 'Already up to date', identifier: event.identifier });
      }
    } else if (isSSECompleteEvent(event)) {
      setSummary(event);
      const verb = event.dryRun ? 'would update' : 'updated';
      addLine({
        type: 'info',
        message: `${event.dryRun ? 'Dry-run preview' : 'Metadata update'} complete — ${event.successful} ${verb}, ${event.failed} failed${event.noChange > 0 ? `, ${event.noChange} no change` : ''}`,
      });
      if (!event.dryRun) void queryClient.invalidateQueries({ queryKey: ['activity-log'] });
    } else if (event.type === 'start') {
      addLine({ type: 'info', message: `${dryRun ? 'Previewing changes for' : 'Starting metadata update for'} ${event.total} item${event.total !== 1 ? 's' : ''}…` });
    }
  }, [queryClient, addLine, dryRun]);

  const { status, startStream, cancel } = useSSEStream(handleEvent);
  const isRunning = status === 'streaming';

  function handleFieldChange(v: string) {
    setField(v);
    if (v !== '__custom__') {
      const fieldDef = COMMON_FIELDS.find((f) => f.value === v);
      if (fieldDef) setOperation(fieldDef.defaultOp);
    }
  }

  function handleStart() {
    if (!activeField || (!value && operation !== 'remove') || selectedList.length === 0) return;
    setProgress({});
    setSummary(null);
    startStream('/api/archive/update-metadata', {
      items: selectedList,
      updates: [{ field: activeField, value, operation }],
      dryRun,
    });
  }

  const canStart =
    !isRunning &&
    selectedList.length > 0 &&
    activeField.length > 0 &&
    (value.length > 0 || operation === 'remove');

  const progressEntries = Object.entries(progress);

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-zinc-900">Edit Metadata</h2>

      {/* Field + operation + value row */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-zinc-600">Field</label>
          <select
            value={field}
            onChange={(e) => handleFieldChange(e.target.value)}
            disabled={isRunning}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 disabled:opacity-50"
          >
            {COMMON_FIELDS.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
            <option value="__custom__">Custom…</option>
          </select>
        </div>

        {isCustomField && (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-zinc-600">Field name</label>
            <input
              type="text"
              value={customField}
              onChange={(e) => setCustomField(e.target.value)}
              placeholder="e.g. coverage"
              disabled={isRunning}
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 disabled:opacity-50"
            />
          </div>
        )}

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-zinc-600">Operation</label>
          <select
            value={operation}
            onChange={(e) => setOperation(e.target.value as Operation)}
            disabled={isRunning}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 disabled:opacity-50"
          >
            <option value="add">Add</option>
            <option value="replace">Replace</option>
            <option value="remove">Remove</option>
          </select>
        </div>

        {operation !== 'remove' && (
          <div className="flex flex-1 flex-col gap-1">
            <label className="text-xs font-medium text-zinc-600">Value</label>
            <input
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Enter value…"
              disabled={isRunning}
              className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 disabled:opacity-50"
            />
          </div>
        )}

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
              disabled={isRunning}
              className="h-3.5 w-3.5 rounded border-zinc-300 accent-zinc-900"
            />
            <span className="text-xs text-zinc-500">Dry run</span>
          </label>
          <button
            onClick={handleStart}
            disabled={!canStart}
            className={[
              'rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
              dryRun
                ? 'bg-blue-600 text-white hover:bg-blue-500'
                : 'bg-zinc-900 text-white hover:bg-zinc-700',
            ].join(' ')}
          >
            {isRunning
              ? dryRun ? 'Previewing…' : 'Running…'
              : dryRun
                ? `Preview ${selectedList.length} item${selectedList.length !== 1 ? 's' : ''}`
                : `Update ${selectedList.length} item${selectedList.length !== 1 ? 's' : ''}`}
          </button>
          {isRunning && (
            <button
              onClick={cancel}
              className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* Progress list */}
      {progressEntries.length > 0 && (
        <div className="flex flex-col gap-1 rounded-md border border-zinc-100 bg-zinc-50 p-3">
          <div className="mb-1 text-xs font-medium text-zinc-500">
            {progressEntries.length} / {selectedList.length} processed
          </div>
          <ul className="max-h-48 overflow-y-auto space-y-0.5">
            {progressEntries.map(([id, p]) => (
              <li key={id} className="flex items-start gap-2 text-xs">
                <StatusDot status={p.status} dryRun={dryRun} />
                <span className="truncate font-mono text-zinc-700">{id}</span>
                {p.error && <span className="text-red-600 truncate">{p.error}</span>}
                {!p.error && p.message && p.status === 'completed' && (
                  <span className="text-zinc-400 truncate">{p.message}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Summary */}
      {summary && (
        <div className={[
          'rounded-md border px-4 py-3 text-sm',
          summary.dryRun ? 'border-blue-200 bg-blue-50' : 'border-zinc-200 bg-zinc-50',
        ].join(' ')}>
          <span className="font-medium text-zinc-900">{summary.dryRun ? 'Preview: ' : 'Done: '}</span>
          <span className={summary.dryRun ? 'text-blue-700' : 'text-green-700'}>
            {summary.successful} {summary.dryRun ? 'would update' : 'updated'}
          </span>
          {summary.noChange > 0 && (
            <span className="text-zinc-500"> · {summary.noChange} no change</span>
          )}
          {summary.failed > 0 && (
            <span className="text-red-600"> · {summary.failed} failed</span>
          )}
        </div>
      )}
    </div>
  );
}

function StatusDot({ status, dryRun }: { status: ItemProgress['status']; dryRun?: boolean }) {
  const cls = {
    pending: 'bg-zinc-300',
    processing: 'bg-blue-400 animate-pulse',
    completed: dryRun ? 'bg-blue-500' : 'bg-green-500',
    no_change: 'bg-zinc-400',
    error: 'bg-red-500',
  }[status];
  return <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${cls}`} />;
}
