import { createLocalStore, type LocalStoreOptions } from './local-store';
import type { DataStore } from './store';

// The one place that chooses where data lives. Phase 4 adds a Supabase store here, implementing the
// same DataStore interface, and no screen changes.
export function createStore(options: LocalStoreOptions): Promise<DataStore> {
  return createLocalStore(options);
}
