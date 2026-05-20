import { create } from 'zustand';
import type { ArchiveItem } from '@/types';

interface UIStore {
  selectedIdentifiers: Set<string>;
  itemsCache: Map<string, ArchiveItem>;
  toggleSelection: (id: string) => void;
  selectAll: (ids: string[]) => void;
  clearSelection: () => void;
  setItemsCache: (items: ArchiveItem[]) => void;
}

export const useUIStore = create<UIStore>((set) => ({
  selectedIdentifiers: new Set(),
  itemsCache: new Map(),

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

  selectAll: (ids) => set({ selectedIdentifiers: new Set(ids) }),

  clearSelection: () => set({ selectedIdentifiers: new Set() }),

  setItemsCache: (items) =>
    set({ itemsCache: new Map(items.map((i) => [i.identifier, i])) }),
}));
