'use client';

import { useState, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useUIStore } from '@/stores/ui';
import { useLogStore } from '@/stores/log';
import { useSSEStream } from '@/hooks/useSSEStream';
import type { SSEEvent, SSECompleteEvent } from '@/lib/sse';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif'];
const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif'];
const MAX_BYTES = 10 * 1024 * 1024;

function isAllowedFile(f: File): boolean {
  if (ALLOWED_TYPES.includes(f.type)) return true;
  // HEIC files may be reported with an empty or generic MIME type in some browsers
  const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
  return ALLOWED_EXTENSIONS.includes(ext);
}

type ItemProgress = { status: 'pending' | 'processing' | 'completed' | 'error'; error?: string };

function isSSECompleteEvent(e: SSEEvent): e is SSECompleteEvent {
  return e.type === 'complete';
}

export function BatchImageUpload() {
  const { selectedIdentifiers, itemsCache } = useUIStore();
  const queryClient = useQueryClient();
  const addLine = useLogStore((s) => s.addLine);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, ItemProgress>>({});
  const [summary, setSummary] = useState<SSECompleteEvent | null>(null);

  const selectedList = Array.from(selectedIdentifiers);

  const handleEvent = useCallback(
    (event: SSEEvent) => {
      if (event.type === 'progress') {
        setProgress((prev) => ({
          ...prev,
          [event.identifier]: { status: event.status as ItemProgress['status'], error: event.error },
        }));
        if (event.status === 'completed') {
          addLine({ type: 'success', message: 'Flyer uploaded', identifier: event.identifier });
        } else if (event.status === 'error') {
          addLine({ type: 'error', message: event.error ?? 'Upload failed', identifier: event.identifier });
        }
      } else if (isSSECompleteEvent(event)) {
        setSummary(event);
        addLine({
          type: 'info',
          message: `Flyer fanout complete — ${event.successful} uploaded, ${event.failed} failed`,
        });
        void queryClient.invalidateQueries({ queryKey: ['activity-log'] });
      } else if (event.type === 'start') {
        addLine({ type: 'info', message: `Starting flyer fanout to ${event.total} item${event.total !== 1 ? 's' : ''}…` });
      }
    },
    [queryClient, addLine]
  );

  const { status, startStream, cancel } = useSSEStream(handleEvent);
  const isRunning = status === 'streaming';

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFileError(null);
    setFile(null);
    if (!f) return;
    if (!isAllowedFile(f)) {
      setFileError('Only JPEG, PNG, GIF, WebP, and HEIC images are supported.');
      return;
    }
    if (f.size > MAX_BYTES) {
      setFileError(`File is too large (${(f.size / 1024 / 1024).toFixed(1)} MB). Maximum is 10 MB.`);
      return;
    }
    setFile(f);
  }

  function handleStart() {
    if (!file || selectedList.length === 0 || isRunning) return;
    setProgress({});
    setSummary(null);

    const fd = new FormData();
    fd.append('file', file);
    const items = selectedList.map((id) => {
      const meta = itemsCache.get(id);
      return { identifier: id, title: meta?.title, date: typeof meta?.date === 'string' ? meta.date : undefined };
    });
    fd.append('items', JSON.stringify(items));
    startStream('/api/upload/flyer-fanout', fd);
  }

  const progressEntries = Object.entries(progress);

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-zinc-800 bg-zinc-900 p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-zinc-100">Upload Flyer</h2>
      <p className="text-xs text-zinc-400">
        Upload one image — it will be set as the cover/thumbnail on all {selectedList.length} selected item{selectedList.length !== 1 ? 's' : ''}.
      </p>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-zinc-400">Image file</label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isRunning}
              className="rounded-md border border-zinc-700 px-3 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-950 disabled:opacity-50"
            >
              {file ? 'Change file' : 'Choose file…'}
            </button>
            {file && (
              <span className="text-sm text-zinc-400 truncate max-w-xs">
                {file.name} <span className="text-zinc-500">({(file.size / 1024).toFixed(0)} KB)</span>
              </span>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif,.heic,.heif"
            onChange={handleFileChange}
            className="sr-only"
          />
          {fileError && <p className="text-xs text-red-400">{fileError}</p>}
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleStart}
            disabled={!file || isRunning || selectedList.length === 0}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isRunning
              ? 'Uploading…'
              : `Fan out to ${selectedList.length} item${selectedList.length !== 1 ? 's' : ''}`}
          </button>
          {isRunning && (
            <button
              onClick={cancel}
              className="rounded-md border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-950"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {progressEntries.length > 0 && (
        <div className="flex flex-col gap-1 rounded-md border border-zinc-800 bg-zinc-950 p-3">
          <div className="mb-1 text-xs font-medium text-zinc-400">
            {progressEntries.length} / {selectedList.length} processed
          </div>
          <ul className="max-h-48 overflow-y-auto space-y-0.5">
            {progressEntries.map(([id, p]) => (
              <li key={id} className="flex items-center gap-2 text-xs">
                <ProgressDot status={p.status} />
                <span className="truncate font-mono text-zinc-300">{id}</span>
                {p.error && <span className="text-red-400 truncate">{p.error}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {summary && (
        <div className="rounded-md border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm">
          <span className="font-medium text-zinc-100">Done: </span>
          <span className="text-green-300">{summary.successful} uploaded</span>
          {summary.failed > 0 && (
            <span className="text-red-400"> · {summary.failed} failed</span>
          )}
        </div>
      )}
    </div>
  );
}

function ProgressDot({ status }: { status: ItemProgress['status'] }) {
  const cls = {
    pending: 'bg-zinc-300',
    processing: 'bg-blue-400 animate-pulse',
    completed: 'bg-green-500',
    error: 'bg-red-500',
  }[status];
  return <span className={`h-2 w-2 shrink-0 rounded-full ${cls}`} />;
}
