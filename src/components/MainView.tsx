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

        {/* Editor tools render above the items grid once a selection exists,
            so you don't have to scroll past 500+ items to reach them. */}
        {selectedCount > 0 && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
            <MetadataEditor />
            <BatchImageUpload />
            <YouTubeMatcher />
            <YouTubeRecordingDateEditor />
            <YouTubeTagsSync />
            <YouTubeDescriptionSync />
          </div>
        )}

        {mode.type !== 'idle' && (
          <ItemSelector mode={mode} onLoadingChange={setIsLoading} />
        )}

        <YouTubeSection />
        <LiveLog />
        <LogViewer />
      </main>
      <ToastContainer />
    </div>
  );
}
