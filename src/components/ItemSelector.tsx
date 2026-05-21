'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ArchiveItem } from '@/types';
import type { FetchMode } from './MainView';
import { useUIStore } from '@/stores/ui';
import { useToastStore } from '@/stores/toast';

function hasYoutubeLink(item: ArchiveItem): boolean {
  const v = item.youtube;
  return typeof v === 'string' && v.length > 0;
}

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
  const { selectedIdentifiers, toggleSelection, selectRange, selectAll, clearSelection, setItemsCache } =
    useUIStore();
  const addToast = useToastStore((s) => s.addToast);
  // Anchor for shift-click range selection. Set on every plain (no-shift) click.
  const anchorRef = useRef<string | null>(null);
  // Filter: when on, only items without a youtube link are displayed.
  const [missingYoutubeOnly, setMissingYoutubeOnly] = useState(false);

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

  useEffect(() => {
    if (error) {
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to load items',
      });
    }
  }, [error, addToast]);

  const items = useMemo(() => data?.items ?? [], [data]);
  const missingYoutubeCount = useMemo(
    () => items.filter((i) => !hasYoutubeLink(i)).length,
    [items],
  );
  const visibleItems = useMemo(
    () => (missingYoutubeOnly ? items.filter((i) => !hasYoutubeLink(i)) : items),
    [items, missingYoutubeOnly],
  );
  const selectedCount = selectedIdentifiers.size;

  useEffect(() => {
    if (items.length > 0) setItemsCache(items);
  }, [items, setItemsCache]);

  if (isLoading) {
    return (
      <div className="flex h-48 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900">
        <p className="text-sm text-zinc-400">Loading items…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-900 bg-red-950/40 p-4">
        <p className="text-sm font-medium text-red-300">
          {error instanceof Error ? error.message : 'Failed to load items'}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Selection toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-2 shadow-sm">
        <span className="text-sm text-zinc-400">
          <span className="font-medium text-zinc-100">{visibleItems.length}</span>
          {missingYoutubeOnly ? ` of ${items.length} items (missing youtube)` : ' items'}
          {selectedCount > 0 && (
            <>
              {' — '}
              <span className="font-medium text-blue-400">{selectedCount} selected</span>
            </>
          )}
        </span>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-zinc-500 sm:inline">Shift+Click for range</span>
          <button
            onClick={() => setMissingYoutubeOnly((v) => !v)}
            disabled={missingYoutubeCount === 0}
            className={[
              'rounded-md px-2 py-1 text-xs font-medium transition-colors',
              missingYoutubeOnly
                ? 'bg-blue-600 text-white hover:bg-blue-500'
                : 'border border-zinc-700 text-zinc-300 hover:bg-zinc-950',
              missingYoutubeCount === 0 ? 'cursor-not-allowed opacity-40' : '',
            ].join(' ')}
            title={missingYoutubeCount === 0 ? 'All items have youtube links' : 'Filter to items missing a youtube link'}
          >
            {missingYoutubeOnly
              ? `✓ Missing youtube (${missingYoutubeCount})`
              : `Missing youtube (${missingYoutubeCount})`}
          </button>
          <button
            onClick={() => selectAll(visibleItems.map((i) => i.identifier))}
            disabled={visibleItems.length === 0}
            className="text-xs text-zinc-400 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Select {missingYoutubeOnly && missingYoutubeCount > 0 ? 'these' : 'all'}
          </button>
          {selectedCount > 0 && (
            <button
              onClick={clearSelection}
              className="text-xs text-zinc-400 hover:text-zinc-100"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Item grid — capped at ~half viewport so editor tools stay reachable */}
      {visibleItems.length === 0 ? (
        <div className="flex h-48 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900">
          <p className="text-sm text-zinc-500">
            {items.length === 0
              ? 'No items found'
              : 'No items match the current filter'}
          </p>
        </div>
      ) : (
        <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950/40 p-2">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {visibleItems.map((item) => (
              <ItemCard
                key={item.identifier}
                item={item}
                selected={selectedIdentifiers.has(item.identifier)}
                onSelect={(shiftKey) => {
                  if (shiftKey && anchorRef.current && anchorRef.current !== item.identifier) {
                    selectRange(visibleItems.map((i) => i.identifier), anchorRef.current, item.identifier);
                  } else {
                    toggleSelection(item.identifier);
                    anchorRef.current = item.identifier;
                  }
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface ItemCardProps {
  item: ArchiveItem;
  selected: boolean;
  onSelect: (shiftKey: boolean) => void;
}

function ItemCard({ item, selected, onSelect }: ItemCardProps) {
  // Use a div (not a button) so we can nest an <a> link inside — HTML doesn't
  // allow interactive elements inside <button>. The link calls stopPropagation
  // so opening archive.org doesn't also toggle the selection.
  function onKey(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      onSelect(e.shiftKey);
    }
  }

  function onClick(e: React.MouseEvent<HTMLDivElement>) {
    // Shift-click in a browser also creates a text selection — clear it so the
    // user doesn't see a flash of highlighted text across the range.
    if (e.shiftKey) window.getSelection()?.removeAllRanges();
    onSelect(e.shiftKey);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={onKey}
      aria-pressed={selected}
      title="Click to select · Shift+Click to select a range"
      className={[
        'flex cursor-pointer flex-col gap-1 rounded-lg border bg-zinc-900 p-3 text-left shadow-sm transition-all select-none',
        'hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-400',
        selected
          ? 'border-blue-500 ring-2 ring-blue-500'
          : 'border-zinc-800 hover:border-zinc-700',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-1">
        <span className="line-clamp-2 text-sm font-medium leading-snug text-zinc-100">
          {item.title || item.identifier}
        </span>
        <span
          className={[
            'mt-0.5 h-4 w-4 shrink-0 rounded border',
            selected ? 'border-blue-500 bg-blue-500' : 'border-zinc-700 bg-zinc-900',
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

      <a
        href={`https://archive.org/details/${item.identifier}`}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="truncate text-xs text-blue-400 hover:text-blue-300 hover:underline"
        title="Open on archive.org"
      >
        {item.identifier}
      </a>
    </div>
  );
}
