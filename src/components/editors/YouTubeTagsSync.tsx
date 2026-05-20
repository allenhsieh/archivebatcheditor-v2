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

function normalizeSubjects(subject: unknown): string[] {
  if (typeof subject === 'string')
    return subject
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
  if (Array.isArray(subject))
    return subject.filter((s): s is string => typeof s === 'string').map((s) => s.trim()).filter(Boolean);
  return [];
}

export function YouTubeTagsSync() {
  const { selectedIdentifiers, itemsCache, youtubeMatches } = useUIStore();
  const queryClient = useQueryClient();
  const addLine = useLogStore((s) => s.addLine);

  const updatable = Array.from(selectedIdentifiers)
    .map((id) => {
      const meta = itemsCache.get(id);
      const videoId =
        youtubeMatches.get(id) ??
        (typeof meta?.youtube === 'string' ? extractVideoIdFromUrl(meta.youtube) : null);
      const tags = normalizeSubjects(meta?.subject);
      return { identifier: id, videoId, tags };
    })
    .filter((u): u is { identifier: string; videoId: string; tags: string[] } =>
      u.videoId !== null && u.tags.length > 0
    );

  const handleEvent = useCallback(
    (event: SSEEvent) => {
      if (event.type === 'progress') {
        if (event.status === 'completed') {
          addLine({ type: 'success', message: 'Tags synced to YouTube', identifier: event.identifier });
        } else if (event.status === 'error') {
          addLine({ type: 'error', message: event.error ?? 'Failed to sync tags', identifier: event.identifier });
        }
      } else if (isSSECompleteEvent(event)) {
        addLine({
          type: 'info',
          message: `Tags sync done — ${event.successful} updated, ${event.failed} failed`,
        });
        void queryClient.invalidateQueries({ queryKey: ['activity-log'] });
      } else if (event.type === 'start') {
        addLine({ type: 'info', message: `Syncing tags to ${event.total} YouTube video${event.total !== 1 ? 's' : ''}…` });
      } else if (event.type === 'error') {
        addLine({ type: 'error', message: `Tags sync failed: ${event.error}` });
      }
    },
    [queryClient, addLine]
  );

  const { status, startStream } = useSSEStream(handleEvent);
  const isRunning = status === 'streaming';

  if (updatable.length === 0) return null;

  function apply() {
    startStream('/api/youtube/tags', {
      updates: updatable.map((u) => ({
        identifier: u.identifier,
        videoId: u.videoId,
        tags: u.tags,
      })),
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-900">YouTube Tags Sync</h2>
        <p className="text-xs text-zinc-400">Merges Archive.org subjects → YouTube tags</p>
      </div>

      <div className="text-xs text-zinc-500">
        {updatable.length} matched item{updatable.length !== 1 ? 's' : ''} with subjects ready to sync
      </div>

      <button
        onClick={apply}
        disabled={isRunning}
        className="w-fit rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isRunning ? 'Syncing…' : `Sync tags to ${updatable.length} video${updatable.length !== 1 ? 's' : ''}`}
      </button>
    </div>
  );
}
