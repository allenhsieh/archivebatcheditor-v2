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
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-900 p-3 shadow-sm">
      <h2 className="text-base font-semibold text-zinc-100">Edit Metadata</h2>

      {/* Field + operation: two side-by-side selects */}
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-zinc-400">Field</label>
          <select
            value={field}
            onChange={(e) => handleFieldChange(e.target.value)}
            disabled={isRunning}
            className="rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-400 disabled:opacity-50"
          >
            {COMMON_FIELDS.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
            <option value="__custom__">Custom…</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-zinc-400">Operation</label>
          <select
            value={operation}
            onChange={(e) => setOperation(e.target.value as Operation)}
            disabled={isRunning}
            className="rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-400 disabled:opacity-50"
          >
            <option value="add">Add</option>
            <option value="replace">Replace</option>
            <option value="remove">Remove</option>
          </select>
        </div>
      </div>

      {isCustomField && (
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-zinc-400">Field name</label>
          <input
            type="text"
            value={customField}
            onChange={(e) => setCustomField(e.target.value)}
            placeholder="e.g. coverage"
            disabled={isRunning}
            className="rounded-md border border-zinc-700 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-400 disabled:opacity-50"
          />
        </div>
      )}

      {operation !== 'remove' && (
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-zinc-400">Value</label>
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Enter value…"
            disabled={isRunning}
            className="w-full rounded-md border border-zinc-700 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-400 disabled:opacity-50"
          />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={dryRun}
            onChange={(e) => setDryRun(e.target.checked)}
            disabled={isRunning}
            className="h-3.5 w-3.5 rounded border-zinc-700 accent-blue-500"
          />
          <span className="text-sm text-zinc-400">Dry run</span>
        </label>
        <div className="flex items-center gap-2">
          {isRunning && (
            <button
              onClick={cancel}
              className="rounded-md border border-zinc-700 px-3 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-950"
            >
              Cancel
            </button>
          )}
          <button
            onClick={handleStart}
            disabled={!canStart}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isRunning
              ? dryRun ? 'Previewing…' : 'Running…'
              : dryRun
                ? `Preview ${selectedList.length} item${selectedList.length !== 1 ? 's' : ''}`
                : `Update ${selectedList.length} item${selectedList.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>

      {/* Progress list */}
      {progressEntries.length > 0 && (
        <div className="flex flex-col gap-1 rounded-md border border-zinc-800 bg-zinc-950 p-3">
          <div className="mb-1 text-sm font-medium text-zinc-400">
            {progressEntries.length} / {selectedList.length} processed
          </div>
          <ul className="max-h-48 overflow-y-auto space-y-0.5">
            {progressEntries.map(([id, p]) => (
              <li key={id} className="flex items-start gap-2 text-sm">
                <StatusDot status={p.status} dryRun={dryRun} />
                <span className="truncate font-mono text-zinc-300">{id}</span>
                {p.error && <span className="text-red-400 truncate">{p.error}</span>}
                {!p.error && p.message && p.status === 'completed' && (
                  <span className="text-zinc-500 truncate">{p.message}</span>
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
          summary.dryRun ? 'border-blue-900 bg-blue-950/40' : 'border-zinc-800 bg-zinc-950',
        ].join(' ')}>
          <span className="font-medium text-zinc-100">{summary.dryRun ? 'Preview: ' : 'Done: '}</span>
          <span className={summary.dryRun ? 'text-blue-300' : 'text-green-300'}>
            {summary.successful} {summary.dryRun ? 'would update' : 'updated'}
          </span>
          {summary.noChange > 0 && (
            <span className="text-zinc-400"> · {summary.noChange} no change</span>
          )}
          {summary.failed > 0 && (
            <span className="text-red-400"> · {summary.failed} failed</span>
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
