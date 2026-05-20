import { create } from 'zustand';

interface UIStore {
  selectedIdentifiers: Set<string>;
  toggleSelection: (id: string) => void;
  selectAll: (ids: string[]) => void;
  clearSelection: () => void;
}

export const useUIStore = create<UIStore>((set) => ({
  selectedIdentifiers: new Set(),

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
}));
