import { createContext, useContext } from 'react';
import type { DataStore } from '../data/store';
import { permissionsFor, type Permissions } from '../lib/permissions';
import type { PlaceIndex } from '../lib/qa';

export interface StoreContextValue {
  store: DataStore;
  places: PlaceIndex;
}

export const StoreContext = createContext<StoreContextValue | null>(null);

export function useStore(): StoreContextValue {
  const value = useContext(StoreContext);
  if (!value) throw new Error('useStore needs a StoreContext');
  return value;
}

export function usePermissions(): Permissions {
  return permissionsFor(useStore().store.user.role);
}
