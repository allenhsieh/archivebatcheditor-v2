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
  const { selectedIdentifiers, itemsCache, selectAll, clearSelection } = useUIStore((s) => ({
    selectedIdentifiers: s.selectedIdentifiers,
    itemsCache: s.itemsCache,
    selectAll: s.selectAll,
    clearSelection: s.clearSelection,
  }));
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
    <div className="min-h-screen bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white px-6 py-4 shadow-sm">
        <h1 className="text-lg font-semibold text-zinc-900">
          Archive.org Batch Editor
        </h1>
      </header>

      <main className="mx-auto max-w-6xl space-y-4 px-6 py-6">
        <SearchSection
          mode={mode}
          onModeChange={setMode}
          isLoading={isLoading}
        />

        {mode.type !== 'idle' && (
          <ItemSelector mode={mode} onLoadingChange={setIsLoading} />
        )}

        {selectedCount > 0 && <MetadataEditor />}
        {selectedCount > 0 && <BatchImageUpload />}
        {selectedCount > 0 && <YouTubeMatcher />}
        {selectedCount > 0 && <YouTubeRecordingDateEditor />}
        {selectedCount > 0 && <YouTubeTagsSync />}
        {selectedCount > 0 && <YouTubeDescriptionSync />}

        <YouTubeSection />
        <LiveLog />
        <LogViewer />
      </main>
      <ToastContainer />
    </div>
  );
}
