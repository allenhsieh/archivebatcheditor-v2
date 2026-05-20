'use client';

import { useState } from 'react';
import { SearchSection } from './SearchSection';
import { ItemSelector } from './ItemSelector';

export type FetchMode =
  | { type: 'idle' }
  | { type: 'user-items' }
  | { type: 'search'; q: string };

export function MainView() {
  const [mode, setMode] = useState<FetchMode>({ type: 'idle' });
  const [isLoading, setIsLoading] = useState(false);

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
      </main>
    </div>
  );
}
