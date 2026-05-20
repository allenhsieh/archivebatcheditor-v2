'use client';

import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useUIStore } from '@/stores/ui';
import { useLogStore } from '@/stores/log';
import { useSSEStream } from '@/hooks/useSSEStream';
import type { SSEEvent, SSECompleteEvent } from '@/lib/sse';

function isSSECompleteEvent(e: SSEEvent): e is SSECompleteEvent {
  return e.type === 'complete';
}

export function YouTubeDescriptionSync() {
  const { selectedIdentifiers, itemsCache, youtubeMatches } = useUIStore();
  const queryClient = useQueryClient();
  const addLine = useLogStore((s) => s.addLine);

  const updatable = Array.from(selectedIdentifiers)
    .filter((id) => youtubeMatches.has(id))
    .map((id) => {
      const meta = itemsCache.get(id);
      const videoId = youtubeMatches.get(id)!;
      const description = typeof meta?.description === 'string' ? meta.description : undefined;
      return { identifier: id, videoId, description };
    })
    .filter((u): u is { identifier: string; videoId: string; description: string } =>
      typeof u.description === 'string' && u.description.trim().length > 0
    );

  const handleEvent = useCallback(
    (event: SSEEvent) => {
      if (event.type === 'progress') {
        if (event.status === 'completed') {
          addLine({ type: 'success', message: 'Description pushed to YouTube', identifier: event.identifier });
        } else if (event.status === 'error') {
          addLine({ type: 'error', message: event.error ?? 'Failed to push description', identifier: event.identifier });
        }
      } else if (isSSECompleteEvent(event)) {
        addLine({
          type: 'info',
          message: `Descriptions done — ${event.successful} pushed, ${event.failed} failed`,
        });
        void queryClient.invalidateQueries({ queryKey: ['activity-log'] });
      } else if (event.type === 'start') {
        addLine({ type: 'info', message: `Pushing descriptions to ${event.total} YouTube video${event.total !== 1 ? 's' : ''}…` });
      } else if (event.type === 'error') {
        addLine({ type: 'error', message: `Description push failed: ${event.error}` });
      }
    },
    [queryClient, addLine]
  );

  const { status, startStream } = useSSEStream(handleEvent);
  const isRunning = status === 'streaming';

  if (updatable.length === 0) return null;

  function apply() {
    startStream('/api/youtube/descriptions', {
      updates: updatable.map((u) => ({
        identifier: u.identifier,
        videoId: u.videoId,
        description: u.description,
      })),
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-900">YouTube Description Sync</h2>
        <p className="text-xs text-zinc-400">Pushes Archive.org description → YouTube video description</p>
      </div>

      <div className="text-xs text-zinc-500">
        {updatable.length} matched item{updatable.length !== 1 ? 's' : ''} with descriptions ready to push
      </div>

      <button
        onClick={apply}
        disabled={isRunning}
        className="w-fit rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isRunning ? 'Pushing…' : `Push descriptions to ${updatable.length} video${updatable.length !== 1 ? 's' : ''}`}
      </button>
    </div>
  );
}
