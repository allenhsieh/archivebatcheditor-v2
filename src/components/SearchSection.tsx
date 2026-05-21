'use client';

import { useState } from 'react';
import type { FetchMode } from './MainView';
import { useUIStore } from '@/stores/ui';

interface SearchSectionProps {
  mode: FetchMode;
  onModeChange: (mode: FetchMode) => void;
  isLoading: boolean;
}

export function SearchSection({ mode, onModeChange, isLoading }: SearchSectionProps) {
  const [searchInput, setSearchInput] = useState('');
  const clearSelection = useUIStore((s) => s.clearSelection);

  function loadMyItems() {
    clearSelection();
    onModeChange({ type: 'user-items' });
  }

  function runSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = searchInput.trim();
    if (!q) return;
    clearSelection();
    onModeChange({ type: 'search', q });
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-900 p-3 shadow-sm">
      <div className="flex items-center gap-2">
        <button
          onClick={loadMyItems}
          disabled={isLoading}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isLoading && mode.type === 'user-items' ? 'Loading…' : 'Load my items'}
        </button>

        <span className="text-zinc-500">or</span>

        <form onSubmit={runSearch} className="flex flex-1 gap-2">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search your items (e.g. title, identifier, collection)"
            className="flex-1 rounded-md border border-zinc-700 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-400"
          />
          <button
            type="submit"
            disabled={!searchInput.trim() || isLoading}
            className="rounded-md border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-950 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading && mode.type === 'search' ? 'Searching…' : 'Search'}
          </button>
        </form>
      </div>
    </div>
  );
}
