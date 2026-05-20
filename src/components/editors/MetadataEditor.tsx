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
  const [progress, setProgress] = useState<Record<string, ItemProgress>>({});
  const [summary, setSummary] = useState<SSECompleteEvent | null>(null);

  const selectedList = Array.from(selectedIdentifiers);
  const isCustomField = field === '__custom__';
  const activeField = isCustomField ? customField.trim() : field;

  const handleEvent = useCallback((event: SSEEvent) => {
    if (isSSEProgressEvent(event)) {
      setProgress((prev) => ({
        ...prev,
        [event.identifier]: { status: event.status, error: event.error },
      }));
      if (event.status === 'completed') {
        addLine({ type: 'success', message: `Metadata updated`, identifier: event.identifier });
      } else if (event.status === 'error') {
        addLine({ type: 'error', message: event.error ?? 'Update failed', identifier: event.identifier });
      } else if (event.status === 'no_change') {
        addLine({ type: 'no_change', message: 'Already up to date', identifier: event.identifier });
      }
    } else if (isSSECompleteEvent(event)) {
      setSummary(event);
      addLine({
        type: 'info',
        message: `Metadata update complete — ${event.successful} updated, ${event.failed} failed${event.noChange > 0 ? `, ${event.noChange} no change` : ''}`,
      });
      void queryClient.invalidateQueries({ queryKey: ['activity-log'] });
    } else if (event.type === 'start') {
      addLine({ type: 'info', message: `Starting metadata update for ${event.total} item${event.total !== 1 ? 's' : ''}…` });
    }
  }, [queryClient, addLine]);

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

        <div className="flex gap-2">
          <button
            onClick={handleStart}
            disabled={!canStart}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isRunning ? 'Running…' : `Update ${selectedList.length} item${selectedList.length !== 1 ? 's' : ''}`}
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
              <li key={id} className="flex items-center gap-2 text-xs">
                <StatusDot status={p.status} />
                <span className="truncate font-mono text-zinc-700">{id}</span>
                {p.error && <span className="text-red-600 truncate">{p.error}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Summary */}
      {summary && (
        <div className="rounded-md border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm">
          <span className="font-medium text-zinc-900">Done: </span>
          <span className="text-green-700">{summary.successful} updated</span>
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

function StatusDot({ status }: { status: ItemProgress['status'] }) {
  const cls = {
    pending: 'bg-zinc-300',
    processing: 'bg-blue-400 animate-pulse',
    completed: 'bg-green-500',
    no_change: 'bg-zinc-400',
    error: 'bg-red-500',
  }[status];
  return <span className={`h-2 w-2 shrink-0 rounded-full ${cls}`} />;
}
