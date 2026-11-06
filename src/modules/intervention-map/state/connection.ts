import { create } from 'zustand';

interface ConnectionState {
  live: boolean;
  setLive(live: boolean): void;
}

// Whether updates from other devices are arriving. Local mode has no such connection, so it stays true.
export const useConnection = create<ConnectionState>((set) => ({
  live: true,
  setLive: (live) => set({ live }),
}));
