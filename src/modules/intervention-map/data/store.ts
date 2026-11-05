import type { MapData } from './types';

// All reads go through this, so screens don't change when the app moves from local data to
// Supabase. Phase 3 adds create, update, delete, status changes and subscribe.
export interface DataStore {
  load(): Promise<MapData>;
}
