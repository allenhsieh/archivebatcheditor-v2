'use client';

import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useUIStore } from '@/stores/ui';
import { useLogStore } from '@/stores/log';
import { useSSEStream } from '@/hooks/useSSEStream';
import { extractVideoIdFromUrl } from '@/lib/youtube/urls';
import type { SSEEvent, SSECompleteEvent } from '@/lib/sse';

function isSSECompleteEvent(e: SSEEvent): e is SSECompleteEvent {
  return e.type === 'complete';
}

// Converts "YYYY-MM-DD" to "YYYY-MM-DDT00:00:00.000Z" required by YouTube
function toISODateTime(date: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return `${date}T00:00:00.000Z`;
  return date;
}

export function YouTubeRecordingDateEditor() {
  const { selectedIdentifiers, itemsCache, youtubeMatches } = useUIStore();
  const queryClient = useQueryClient();
  const addLine = useLogStore((s) => s.addLine);

  const updatable = Array.from(selectedIdentifiers)
    .map((id) => {
      const meta = itemsCache.get(id);
      // Prefer the in-session match; fall back to the youtube field already on the item
      const videoId =
        youtubeMatches.get(id) ??
        (typeof meta?.youtube === 'string' ? extractVideoIdFromUrl(meta.youtube) : null);
      const date = typeof meta?.date === 'string' ? meta.date : undefined;
      return { identifier: id, videoId, date };
    })
    .filter((u): u is { identifier: string; videoId: string; date: string } =>
      u.videoId !== null && Boolean(u.date)
    );

  const handleEvent = useCallback(
    (event: SSEEvent) => {
      if (event.type === 'progress') {
        if (event.status === 'completed') {
          addLine({ type: 'success', message: 'Recording date set on YouTube', identifier: event.identifier });
        } else if (event.status === 'error') {
          addLine({ type: 'error', message: event.error ?? 'Failed to set recording date', identifier: event.identifier });
        }
      } else if (isSSECompleteEvent(event)) {
        addLine({
          type: 'info',
          message: `Recording dates done — ${event.successful} set, ${event.failed} failed`,
        });
        void queryClient.invalidateQueries({ queryKey: ['activity-log'] });
      } else if (event.type === 'start') {
        addLine({ type: 'info', message: `Setting recording dates on ${event.total} YouTube video${event.total !== 1 ? 's' : ''}…` });
      } else if (event.type === 'error') {
        addLine({ type: 'error', message: `Recording date update failed: ${event.error}` });
      }
    },
    [queryClient, addLine]
  );

  const { status, startStream } = useSSEStream(handleEvent);
  const isRunning = status === 'streaming';

  if (updatable.length === 0) return null;

  function apply() {
    startStream('/api/youtube/recording-dates', {
      updates: updatable.map((u) => ({
        identifier: u.identifier,
        videoId: u.videoId,
        recordingDate: toISODateTime(u.date),
      })),
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-900 p-3 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-zinc-100">YouTube Recording Dates</h2>
        <p className="text-sm text-zinc-500">Pushes Archive.org date → YouTube recording date</p>
      </div>

      <div className="text-sm text-zinc-400">
        {updatable.length} matched item{updatable.length !== 1 ? 's' : ''} with dates ready to push
      </div>

      <button
        onClick={apply}
        disabled={isRunning}
        className="w-fit rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isRunning ? 'Pushing…' : `Push recording dates to ${updatable.length} video${updatable.length !== 1 ? 's' : ''}`}
      </button>
    </div>
  );
}
