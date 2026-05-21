'use client';

import { useState, useEffect } from 'react';
import { SearchSection } from './SearchSection';
import { ItemSelector } from './ItemSelector';
import { MetadataEditor } from './editors/MetadataEditor';
import { BatchImageUpload } from './editors/BatchImageUpload';
import { YouTubeMatcher } from './editors/YouTubeMatcher';
import { YouTubeRecordingDateEditor } from './editors/YouTubeRecordingDateEditor';
import { YouTubeTagsSync } from './editors/YouTubeTagsSync';
import { YouTubeDescriptionSync } from './editors/YouTubeDescriptionSync';
import { LogViewer } from './LogViewer';
import { LiveLog } from './LiveLog';
import { YouTubeSection } from './YouTubeSection';
import { RetryQueueSection } from './RetryQueueSection';
import { YouTubeDescriptionCleanup } from './editors/YouTubeDescriptionCleanup';
import { ToastContainer } from './ToastContainer';
import { useUIStore } from '@/stores/ui';

export type FetchMode =
  | { type: 'idle' }
  | { type: 'user-items' }
  | { type: 'search'; q: string };

export function MainView() {
  const [mode, setMode] = useState<FetchMode>({ type: 'idle' });
  const [isLoading, setIsLoading] = useState(false);
  const selectedIdentifiers = useUIStore((s) => s.selectedIdentifiers);
  const itemsCache = useUIStore((s) => s.itemsCache);
  const selectAll = useUIStore((s) => s.selectAll);
  const clearSelection = useUIStore((s) => s.clearSelection);
  const selectedCount = selectedIdentifiers.size;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.target as HTMLElement).isContentEditable) return;

      if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        const ids = Array.from(itemsCache.keys());
        if (ids.length > 0) {
          e.preventDefault();
          selectAll(ids);
        }
      }

      if (e.key === 'Escape') {
        clearSelection();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [itemsCache, selectAll, clearSelection]);

  return (
    <div className="min-h-screen bg-zinc-950">
      <header className="border-b border-zinc-800 bg-zinc-900 px-6 py-4 shadow-sm">
        <h1 className="text-lg font-semibold text-zinc-100">
          Archive.org Batch Editor
        </h1>
      </header>

      <main className="mx-auto max-w-7xl space-y-4 px-6 py-6">
        <SearchSection
          mode={mode}
          onModeChange={setMode}
          isLoading={isLoading}
        />

        {/* The items + tools layout is always two columns once items are loaded.
            Items column has a fixed proportional width so it never resizes when
            the tools slide in — only the right-hand sidebar contents change. */}
        {mode.type !== 'idle' && (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(380px,38%)]">
            <ItemSelector mode={mode} onLoadingChange={setIsLoading} />

            <aside className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto lg:pr-1">
              {selectedCount > 0 ? (
                <>
                  <MetadataEditor />
                  <BatchImageUpload />
                  <YouTubeMatcher />
                  <YouTubeRecordingDateEditor />
                  <YouTubeTagsSync />
                  <YouTubeDescriptionSync />
                </>
              ) : (
                <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-900/50 p-6 text-sm text-zinc-500">
                  <p className="font-medium text-zinc-300">No items selected</p>
                  <p className="mt-1">
                    Click an item card to select it. Editor tools (metadata, flyer
                    upload, YouTube sync) will appear here.
                  </p>
                  <p className="mt-2 text-xs text-zinc-500">
                    Shortcuts: ⌘A select all · Esc clear
                  </p>
                </div>
              )}
            </aside>
          </div>
        )}

        <YouTubeSection />
        <RetryQueueSection />
        <YouTubeDescriptionCleanup />
        <LiveLog />
        <LogViewer />
      </main>
      <ToastContainer />
    </div>
  );
}
