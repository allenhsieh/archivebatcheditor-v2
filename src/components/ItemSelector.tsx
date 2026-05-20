'use client';

import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ArchiveItem } from '@/types';
import type { FetchMode } from './MainView';
import { useUIStore } from '@/stores/ui';

interface ItemSelectorProps {
  mode: FetchMode;
  onLoadingChange: (loading: boolean) => void;
}

interface ItemsResponse {
  items: ArchiveItem[];
  total: number;
}

async function fetchItems(mode: FetchMode): Promise<ItemsResponse> {
  let url: string;
  if (mode.type === 'user-items') {
    url = '/api/archive/user-items';
  } else if (mode.type === 'search') {
    url = `/api/archive/search?q=${encodeURIComponent(mode.q)}`;
  } else {
    return { items: [], total: 0 };
  }

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<ItemsResponse>;
}

export function ItemSelector({ mode, onLoadingChange }: ItemSelectorProps) {
  const { selectedIdentifiers, toggleSelection, selectAll, clearSelection, setItemsCache } =
    useUIStore();

  const queryKey =
    mode.type === 'user-items'
      ? (['archive', 'user-items'] as const)
      : (['archive', 'search', mode.type === 'search' ? mode.q : ''] as const);

  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: () => fetchItems(mode),
  });

  useEffect(() => {
    onLoadingChange(isLoading);
  }, [isLoading, onLoadingChange]);

  const items = useMemo(() => data?.items ?? [], [data]);
  const selectedCount = selectedIdentifiers.size;

  useEffect(() => {
    if (items.length > 0) setItemsCache(items);
  }, [items, setItemsCache]);

  if (isLoading) {
    return (
      <div className="flex h-48 items-center justify-center rounded-lg border border-zinc-200 bg-white">
        <p className="text-sm text-zinc-500">Loading items…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <p className="text-sm font-medium text-red-700">
          {error instanceof Error ? error.message : 'Failed to load items'}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Selection toolbar */}
      <div className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-2 shadow-sm">
        <span className="text-sm text-zinc-600">
          <span className="font-medium text-zinc-900">{items.length}</span> items
          {selectedCount > 0 && (
            <>
              {' — '}
              <span className="font-medium text-blue-600">{selectedCount} selected</span>
            </>
          )}
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => selectAll(items.map((i) => i.identifier))}
            disabled={items.length === 0}
            className="text-xs text-zinc-500 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Select all
          </button>
          {selectedCount > 0 && (
            <button
              onClick={clearSelection}
              className="text-xs text-zinc-500 hover:text-zinc-900"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Item grid */}
      {items.length === 0 ? (
        <div className="flex h-48 items-center justify-center rounded-lg border border-zinc-200 bg-white">
          <p className="text-sm text-zinc-400">No items found</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((item) => (
            <ItemCard
              key={item.identifier}
              item={item}
              selected={selectedIdentifiers.has(item.identifier)}
              onToggle={() => toggleSelection(item.identifier)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface ItemCardProps {
  item: ArchiveItem;
  selected: boolean;
  onToggle: () => void;
}

function ItemCard({ item, selected, onToggle }: ItemCardProps) {
  const date =
    typeof item.date === 'string' ? item.date.slice(0, 10) : null;

  return (
    <button
      onClick={onToggle}
      className={[
        'flex flex-col gap-1 rounded-lg border bg-white p-3 text-left shadow-sm transition-all',
        'hover:shadow-md',
        selected
          ? 'border-blue-500 ring-2 ring-blue-500'
          : 'border-zinc-200 hover:border-zinc-300',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-1">
        <span className="line-clamp-2 text-sm font-medium leading-snug text-zinc-900">
          {item.title || item.identifier}
        </span>
        <span
          className={[
            'mt-0.5 h-4 w-4 shrink-0 rounded border',
            selected ? 'border-blue-500 bg-blue-500' : 'border-zinc-300 bg-white',
          ].join(' ')}
          aria-hidden
        >
          {selected && (
            <svg viewBox="0 0 16 16" fill="white" className="h-4 w-4">
              <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
            </svg>
          )}
        </span>
      </div>

      <span className="truncate text-xs text-zinc-400">{item.identifier}</span>

      {date && (
        <span className="mt-1 w-fit rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500">
          {date}
        </span>
      )}
    </button>
  );
}
