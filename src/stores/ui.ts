import { create } from 'zustand';
import type { ArchiveItem } from '@/types';

interface UIStore {
  selectedIdentifiers: Set<string>;
  itemsCache: Map<string, ArchiveItem>;
  youtubeMatches: Map<string, string>; // identifier → youtube videoId
  toggleSelection: (id: string) => void;
  // Adds the inclusive [from..to] slice of `orderedIds` to the current selection.
  // Used by shift-click range select; preserves prior selections.
  selectRange: (orderedIds: string[], fromId: string, toId: string) => void;
  selectAll: (ids: string[]) => void;
  clearSelection: () => void;
  setItemsCache: (items: ArchiveItem[]) => void;
  setYoutubeMatches: (matches: Map<string, string>) => void;
}

export const useUIStore = create<UIStore>((set) => ({
  selectedIdentifiers: new Set(),
  itemsCache: new Map(),
  youtubeMatches: new Map(),

  toggleSelection: (id) =>
    set((state) => {
      const next = new Set(state.selectedIdentifiers);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return { selectedIdentifiers: next };
    }),

  selectRange: (orderedIds, fromId, toId) =>
    set((state) => {
      const fromIdx = orderedIds.indexOf(fromId);
      const toIdx = orderedIds.indexOf(toId);
      if (fromIdx === -1 || toIdx === -1) return state;
      const [start, end] = fromIdx <= toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
      const next = new Set(state.selectedIdentifiers);
      for (let i = start; i <= end; i++) next.add(orderedIds[i]);
      return { selectedIdentifiers: next };
    }),

  selectAll: (ids) => set({ selectedIdentifiers: new Set(ids) }),

  clearSelection: () => set({ selectedIdentifiers: new Set() }),

  setItemsCache: (items) =>
    set({ itemsCache: new Map(items.map((i) => [i.identifier, i])) }),

  setYoutubeMatches: (matches) => set({ youtubeMatches: new Map(matches) }),
}));
