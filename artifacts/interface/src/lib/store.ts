import { create } from 'zustand';

export interface FeedEntry {
  id: string;
  time: string;
  message: string;
  status: 'success' | 'pending' | 'error' | 'info';
}

interface AppState {
  chatInput: string;
  setChatInput: (val: string) => void;
  feed: FeedEntry[];
  addFeedEntry: (entry: Omit<FeedEntry, 'id' | 'time'>) => void;
}

export const useAppStore = create<AppState>((set) => ({
  chatInput: '',
  setChatInput: (chatInput) => set({ chatInput }),
  feed: [],
  addFeedEntry: (entry) => set((state) => {
    const newEntry: FeedEntry = {
      ...entry,
      id: Math.random().toString(36).substring(7),
      time: new Date().toTimeString().split(' ')[0],
    };
    const newFeed = [...state.feed, newEntry];
    if (newFeed.length > 100) newFeed.shift();
    return { feed: newFeed };
  }),
}));