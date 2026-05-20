import { create } from 'zustand';

export interface LogLine {
  id: number;
  type: 'success' | 'error' | 'info' | 'skipped' | 'no_change';
  message: string;
  identifier?: string;
  timestamp: Date;
}

interface LogStore {
  lines: LogLine[];
  addLine: (entry: Omit<LogLine, 'id' | 'timestamp'>) => void;
  clear: () => void;
}

let nextId = 0;

export const useLogStore = create<LogStore>((set) => ({
  lines: [],

  addLine: (entry) =>
    set((state) => ({
      lines: [
        ...state.lines,
        { ...entry, id: ++nextId, timestamp: new Date() },
      ],
    })),

  clear: () => set({ lines: [] }),
}));
